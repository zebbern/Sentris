import { Inject, Injectable, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, ilike, or, count, asc, desc } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  registryCatalog,
  registrySyncState,
  type RegistryCatalogRecord,
  type NewRegistryCatalogRecord,
  type RegistrySyncStateRecord,
} from '../database/schema';
import type { RegistryCatalogQuery } from '@sentris/shared';

export interface CatalogQueryResult {
  data: RegistryCatalogRecord[];
  total: number;
  categories: string[];
}

@Injectable()
export class McpRegistryRepository {
  private readonly logger = new Logger(McpRegistryRepository.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Upsert catalog entries using batch inserts (chunks of 50).
   */
  async upsertCatalogEntries(
    entries: Omit<NewRegistryCatalogRecord, 'id' | 'createdAt' | 'updatedAt' | 'syncedAt'>[],
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const UPSERT_BATCH_SIZE = 50;
    const valuesToInsert = entries.map((entry) => ({
      ...entry,
      syncedAt: sql`now()`,
    }));

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < valuesToInsert.length; i += UPSERT_BATCH_SIZE) {
        const chunk = valuesToInsert.slice(i, i + UPSERT_BATCH_SIZE);
        await tx
          .insert(registryCatalog)
          .values(chunk)
          .onConflictDoUpdate({
            target: registryCatalog.name,
            set: {
              displayName: sql`excluded.display_name`,
              description: sql`excluded.description`,
              serverType: sql`excluded.server_type`,
              category: sql`excluded.category`,
              tags: sql`excluded.tags`,
              iconUrl: sql`excluded.icon_url`,
              sourceUrl: sql`excluded.source_url`,
              dockerImage: sql`excluded.docker_image`,
              remoteConfig: sql`excluded.remote_config`,
              configSchema: sql`excluded.config_schema`,
              runConfig: sql`excluded.run_config`,
              oauthConfig: sql`excluded.oauth_config`,
              isFeatured: sql`excluded.is_featured`,
              registryCommitSha: sql`excluded.registry_commit_sha`,
              syncedAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          });
      }
    });

    return entries.length;
  }

  /**
   * Delete catalog entries by name(s).
   */
  async deleteCatalogEntries(names: string[]): Promise<number> {
    if (names.length === 0) return 0;

    const deleted = await this.db
      .delete(registryCatalog)
      .where(
        sql`${registryCatalog.name} IN (${sql.join(
          names.map((n) => sql`${n}`),
          sql`, `,
        )})`,
      )
      .returning({ name: registryCatalog.name });

    return deleted.length;
  }

  /**
   * Find catalog entries with pagination, search, and filters.
   */
  async findCatalogEntries(query: RegistryCatalogQuery): Promise<CatalogQueryResult> {
    const conditions = [];

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      conditions.push(
        or(
          ilike(registryCatalog.displayName, searchPattern),
          ilike(registryCatalog.description, searchPattern),
        ),
      );
    }

    if (query.category) {
      conditions.push(eq(registryCatalog.category, query.category));
    }

    if (query.serverType) {
      conditions.push(eq(registryCatalog.serverType, query.serverType));
    }

    if (query.featured) {
      conditions.push(eq(registryCatalog.isFeatured, true));
    }

    const whereClause =
      conditions.length > 0
        ? and(...conditions.filter((c): c is NonNullable<typeof c> => c !== undefined))
        : undefined;

    // Fetch total count and data in parallel
    const [countResult, data, categoryResult] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(registryCatalog)
        .where(whereClause)
        .then((rows) => rows[0]?.total ?? 0),

      this.db
        .select()
        .from(registryCatalog)
        .where(whereClause)
        .orderBy(desc(registryCatalog.isFeatured), asc(registryCatalog.displayName))
        .limit(query.limit)
        .offset(query.offset),

      this.db
        .selectDistinct({ category: registryCatalog.category })
        .from(registryCatalog)
        .where(sql`${registryCatalog.category} IS NOT NULL`)
        .then((rows) => rows.map((r) => r.category).filter((c): c is string => c !== null)),
    ]);

    return {
      data,
      total: countResult,
      categories: categoryResult,
    };
  }

  /**
   * Find a single catalog entry by name.
   */
  async findCatalogEntryByName(name: string): Promise<RegistryCatalogRecord | null> {
    const rows = await this.db
      .select()
      .from(registryCatalog)
      .where(eq(registryCatalog.name, name))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get all catalog entry names (used for deletion detection).
   */
  async getAllCatalogNames(): Promise<string[]> {
    const rows = await this.db.select({ name: registryCatalog.name }).from(registryCatalog);

    return rows.map((r) => r.name);
  }

  /**
   * Get the current sync state.
   */
  async getSyncState(): Promise<RegistrySyncStateRecord | null> {
    const rows = await this.db
      .select()
      .from(registrySyncState)
      .where(eq(registrySyncState.id, 'default'))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Update the sync state (upsert).
   */
  async updateSyncState(
    state: Partial<Omit<RegistrySyncStateRecord, 'id' | 'createdAt'>>,
  ): Promise<void> {
    await this.db
      .insert(registrySyncState)
      .values({
        id: 'default',
        ...state,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: registrySyncState.id,
        set: {
          ...state,
          updatedAt: sql`now()`,
        },
      });
  }

  /**
   * Apply featured badges based on a set of server names.
   */
  async applyFeaturedBadges(featuredNames: Set<string>): Promise<void> {
    if (featuredNames.size === 0) return;

    await this.db.transaction(async (tx) => {
      // Reset all featured flags
      await tx
        .update(registryCatalog)
        .set({ isFeatured: false })
        .where(eq(registryCatalog.isFeatured, true));

      // Set featured for matching names
      const nameList = [...featuredNames];
      await tx
        .update(registryCatalog)
        .set({ isFeatured: true })
        .where(
          sql`${registryCatalog.name} IN (${sql.join(
            nameList.map((n) => sql`${n}`),
            sql`, `,
          )})`,
        );
    });
  }
}
