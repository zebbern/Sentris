import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { Pool } from 'pg';
import type { AppConfig } from '../config';
import {
  compareSchemaFingerprint,
  loadMigrationPlan,
  validateLedgerPrefix,
  type AppliedMigration,
  type MigrationPlan,
  type SchemaFingerprint,
} from './migrations/checked-migrations';
import { PostgresMigrationDatabase } from './migrations/postgres-migration-database';

export interface MigrationLedgerReader {
  hasLedger(): Promise<boolean>;
  readLedger(): Promise<AppliedMigration[]>;
  inspectPublicSchema(expected?: SchemaFingerprint): Promise<SchemaFingerprint>;
}

export async function assertDatabaseMigrationsCurrent(
  database: MigrationLedgerReader,
  plan: MigrationPlan,
): Promise<number> {
  if (!(await database.hasLedger())) {
    throw new Error('Database has no checked migration ledger. Run `bun run migrate`.');
  }

  const appliedCount = validateLedgerPrefix(plan, await database.readLedger());
  if (appliedCount !== plan.migrations.length) {
    throw new Error(
      `Database migration ledger is behind: ${appliedCount} of ${plan.migrations.length} migrations applied. Run \`bun run migrate\`.`,
    );
  }

  const expectedSchema = plan.migrations.at(-1)!.schema;
  const actualSchema = await database.inspectPublicSchema(expectedSchema);
  const differences = compareSchemaFingerprint(expectedSchema, actualSchema);
  if (differences.length > 0) {
    throw new Error(`Database schema drift detected: ${differences.slice(0, 10).join('; ')}`);
  }
  return appliedCount;
}

@Injectable()
export class MigrationGuard implements OnModuleInit {
  private readonly logger = new Logger(MigrationGuard.name);

  constructor(
    @Inject(Pool) private readonly pool: Pool,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const appCfg = this.configService.get<AppConfig>('app')!;
    if (appCfg.skipMigrationCheck) {
      this.logger.warn('Skipping migration check because SENTRIS_SKIP_MIGRATION_CHECK=true.');
      return;
    }

    const client = await this.pool.connect();

    try {
      const plan = loadMigrationPlan(resolve(process.cwd(), 'migrations'));
      const appliedCount = await assertDatabaseMigrationsCurrent(
        new PostgresMigrationDatabase(client),
        plan,
      );
      this.logger.log(
        `Database migration and schema-contract check passed – ${appliedCount} checksum-verified migration(s) applied.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to verify the checked migration ledger and live schema contract. Run `bun run migrate` before starting the backend.',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      client.release();
    }
  }
}
