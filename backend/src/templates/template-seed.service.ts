import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { templatesTable, type TemplateManifest } from '../database/schema/templates';
import type { AppConfig, IngestConfig } from '../config';

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
 * Seeds the templates table from local JSON files when the database is empty.
 * Runs once on startup. Idempotent — skips if templates already exist.
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
      await this.seedIfEmpty();
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

  private async seedIfEmpty(): Promise<void> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(templatesTable)
      .execute();

    const count = Number(result[0]?.count ?? 0);
    if (count > 0) {
      this.logger.log(`Templates table has ${count} rows — skipping seed`);
      return;
    }

    this.logger.log('Templates table is empty — seeding from local files...');

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
    for (const file of files) {
      try {
        const content = readFileSync(join(seedDir, file), 'utf-8');
        const tpl: SeedTemplateJson = JSON.parse(content);

        await this.db
          .insert(templatesTable)
          .values({
            name: tpl._metadata.name,
            description: tpl._metadata.description ?? '',
            category: tpl._metadata.category,
            tags: tpl._metadata.tags,
            author: tpl._metadata.author,
            repository: 'sentris/templates',
            path: `templates/${file}`,
            branch: 'main',
            version: tpl._metadata.version,
            manifest: tpl.manifest as unknown as TemplateManifest,
            graph: tpl.graph as unknown as Record<string, unknown>,
            requiredSecrets: tpl.requiredSecrets,
            popularity: 0,
            isOfficial: true,
            isVerified: true,
            isActive: true,
          })
          .execute();

        inserted++;
      } catch (fileError: unknown) {
        this.logger.error(
          `Failed to seed template from ${file}`,
          fileError instanceof Error ? fileError.stack : String(fileError),
        );
      }
    }

    this.logger.log(`Auto-seed complete: ${inserted}/${files.length} templates inserted`);
  }
}
