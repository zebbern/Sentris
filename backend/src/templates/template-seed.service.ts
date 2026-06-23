import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { templatesTable, type TemplateManifest } from '../database/schema/templates';
import type { AppConfig, IngestConfig } from '../config';
import { REMOVED_OFFICIAL_SEED_TEMPLATES } from './retired-official-seed-templates';

interface SeedTemplateJson {
  _metadata: {
    name: string;
    description?: string;
    category: string;
    tags: string[];
    author: string;
    version: string;
  };
  manifest: Record<string, unknown>;
  graph: { nodes: unknown[]; edges: unknown[] };
  requiredSecrets: { name: string; type: string; description: string }[];
}

/**
 * Syncs official local seed templates into the templates table on startup.
 * Runs once on startup and is idempotent, so newly added seed files appear in initialized databases.
 */
@Injectable()
export class TemplateSeedService implements OnModuleInit {
  private readonly logger = new Logger(TemplateSeedService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.shouldSeed()) {
      return;
    }

    try {
      await this.syncLocalSeeds();
    } catch (error: unknown) {
      this.logger.error(
        'Failed to auto-seed templates',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private shouldSeed(): boolean {
    const appCfg = this.configService.get<AppConfig>('app')!;
    if (appCfg.nodeEnv === 'test') {
      return false;
    }

    const ingest = this.configService.get<IngestConfig>('ingest');
    if (ingest?.skipIngestServices) {
      return false;
    }

    return true;
  }

  private async syncLocalSeeds(): Promise<void> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(templatesTable)
      .execute();

    const count = Number(result[0]?.count ?? 0);
    this.logger.log(
      count > 0
        ? `Templates table has ${count} rows — syncing local seed files...`
        : 'Templates table is empty — seeding from local files...',
    );

    const seedDir = join(process.cwd(), 'scripts', 'seed-templates');
    if (!existsSync(seedDir)) {
      this.logger.warn(`Seed directory not found: ${seedDir} — skipping auto-seed`);
      return;
    }

    const files = readdirSync(seedDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      this.logger.warn('No seed template files found — skipping');
      return;
    }

    let inserted = 0;
    let updated = 0;
    for (const file of files) {
      try {
        const content = readFileSync(join(seedDir, file), 'utf-8');
        const tpl: SeedTemplateJson = JSON.parse(content);
        const path = `templates/${file}`;
        const values = {
          name: tpl._metadata.name,
          description: tpl._metadata.description ?? '',
          category: tpl._metadata.category,
          tags: tpl._metadata.tags,
          author: tpl._metadata.author,
          repository: 'sentris/templates',
          path,
          branch: 'main',
          version: tpl._metadata.version,
          manifest: tpl.manifest as unknown as TemplateManifest,
          graph: tpl.graph as unknown as Record<string, unknown>,
          requiredSecrets: tpl.requiredSecrets,
          isOfficial: true,
          isVerified: true,
          isActive: true,
        };

        const existing = await this.db
          .select({ id: templatesTable.id })
          .from(templatesTable)
          .where(
            and(eq(templatesTable.repository, 'sentris/templates'), eq(templatesTable.path, path)),
          )
          .limit(1)
          .execute();

        if (existing[0]?.id) {
          await this.db
            .update(templatesTable)
            .set({
              ...values,
              updatedAt: new Date(),
            })
            .where(eq(templatesTable.id, existing[0].id))
            .execute();

          updated++;
          continue;
        }

        await this.db.insert(templatesTable).values({ ...values, popularity: 0 }).execute();
        inserted++;
      } catch (fileError: unknown) {
        this.logger.error(
          `Failed to seed template from ${file}`,
          fileError instanceof Error ? fileError.stack : String(fileError),
        );
      }
    }

    await this.pruneRetiredOfficialSeeds();

    this.logger.log(
      `Auto-seed complete: ${inserted} inserted, ${updated} updated from ${files.length} seed files`,
    );
  }

  private async pruneRetiredOfficialSeeds(): Promise<void> {
    const names = Array.from(
      new Set(REMOVED_OFFICIAL_SEED_TEMPLATES.map((template) => template.name.trim()).filter(Boolean)),
    );
    const paths = Array.from(
      new Set(REMOVED_OFFICIAL_SEED_TEMPLATES.map((template) => template.path.trim()).filter(Boolean)),
    );

    const retiredConditions: SQL[] = [];
    if (names.length > 0) {
      retiredConditions.push(inArray(templatesTable.name, names));
    }
    if (paths.length > 0) {
      retiredConditions.push(inArray(templatesTable.path, paths));
    }

    if (retiredConditions.length === 0) {
      return;
    }

    await this.db
      .update(templatesTable)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(templatesTable.repository, 'sentris/templates'),
          eq(templatesTable.isOfficial, true),
          eq(templatesTable.isActive, true),
          retiredConditions.length === 1 ? retiredConditions[0] : or(...retiredConditions),
        ),
      )
      .execute();
  }
}
