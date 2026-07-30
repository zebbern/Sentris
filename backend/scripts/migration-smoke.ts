/* eslint-disable no-console -- Live smoke commands must report their resolved target. */
import { resolve } from 'path';
import { Pool } from 'pg';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
} from '../../scripts/lib/local-script-runtime';
import {
  compareSchemaFingerprint,
  isSchemaFingerprintEmpty,
  loadMigrationPlan,
  runCheckedMigrations,
  validateLedgerPrefix,
  type CheckedMigrationDatabase,
  type MigrationPlan,
  type RunCheckedMigrationsResult,
} from '../src/database/migrations/checked-migrations';
import { PostgresMigrationDatabase } from '../src/database/migrations/postgres-migration-database';

type SingleMigrationSmokeMode = 'fresh' | 'upgrade' | 'parity';
export type MigrationSmokeMode = SingleMigrationSmokeMode | 'concurrent';
type SmokeEnvironment = Record<string, string | undefined>;

const SMOKE_USAGE = 'Usage: bun run migration:smoke:<fresh|upgrade|parity|concurrent>';

export function parseMigrationSmokeMode(args: readonly string[]): MigrationSmokeMode {
  if (
    args.length === 1 &&
    (args[0] === 'fresh' ||
      args[0] === 'upgrade' ||
      args[0] === 'parity' ||
      args[0] === 'concurrent')
  ) {
    return args[0];
  }
  throw new Error(SMOKE_USAGE);
}

export function assertExplicitMigrationSmokeTarget(env: SmokeEnvironment): void {
  if (!env.SENTRIS_INSTANCE?.trim() && !env.MIGRATION_SMOKE_DATABASE_URL?.trim()) {
    throw new Error(
      'Set SENTRIS_INSTANCE or MIGRATION_SMOKE_DATABASE_URL explicitly before running a live migration smoke test.',
    );
  }
}

async function assertCurrentParity(
  database: CheckedMigrationDatabase,
  plan: MigrationPlan,
): Promise<void> {
  if (!(await database.hasLedger())) {
    throw new Error('Migration parity check failed: checked migration ledger is missing');
  }
  const appliedCount = validateLedgerPrefix(plan, await database.readLedger());
  if (appliedCount !== plan.migrations.length) {
    throw new Error(
      `Migration parity check failed: ${appliedCount} of ${plan.migrations.length} migrations applied`,
    );
  }

  const currentSchema = plan.migrations.at(-1)!.schema;
  const differences = compareSchemaFingerprint(
    currentSchema,
    await database.inspectPublicSchema(currentSchema),
  );
  if (differences.length > 0) {
    throw new Error(`Migration parity check failed: ${differences.slice(0, 10).join('; ')}`);
  }
}

async function seedBaselineWithoutLedger(
  database: CheckedMigrationDatabase,
  plan: MigrationPlan,
): Promise<void> {
  let lockAcquired = false;
  let transactionOpen = false;
  try {
    await database.acquireLock();
    lockAcquired = true;

    const ledgerExists = await database.hasLedger();
    const baselineSchema = plan.migrations[0]!.schema;
    const schema = await database.inspectPublicSchema(baselineSchema);
    if (ledgerExists || !isSchemaFingerprintEmpty(schema)) {
      throw new Error('Upgrade migration smoke requires an empty public schema with no ledger');
    }

    await database.begin();
    transactionOpen = true;
    for (const statement of plan.migrations[0]!.statements) {
      await database.executeStatement(statement);
    }
    await database.commit();
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await database.rollback();
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await database.releaseLock();
    }
  }
}

export async function runMigrationSmoke({
  mode,
  database,
  plan,
  onStatus,
}: {
  mode: SingleMigrationSmokeMode;
  database: CheckedMigrationDatabase;
  plan: MigrationPlan;
  onStatus?: (message: string) => void;
}): Promise<void> {
  if (mode === 'parity') {
    await assertCurrentParity(database, plan);
    onStatus?.('Current database schema matches the authoritative migration snapshot.');
    return;
  }

  const ledgerExists = await database.hasLedger();
  const baselineSchema = plan.migrations[0]!.schema;
  const schema = await database.inspectPublicSchema(baselineSchema);
  if (ledgerExists || !isSchemaFingerprintEmpty(schema)) {
    throw new Error(
      `${
        mode === 'fresh' ? 'Fresh' : 'Upgrade'
      } migration smoke requires an empty public schema with no ledger`,
    );
  }

  if (mode === 'upgrade') {
    onStatus?.('Seeding the generated v1.0.0 baseline without a ledger.');
    await seedBaselineWithoutLedger(database, plan);
    await runCheckedMigrations({
      database,
      plan,
      adoptVersion: 'v1.0.0',
      onStatus,
    });
  } else {
    await runCheckedMigrations({ database, plan, onStatus });
  }

  await assertCurrentParity(database, plan);
  onStatus?.(`${mode} migration smoke passed with exact current-schema parity.`);
}

export async function runConcurrentMigrationSmoke({
  databases,
  plan,
  onStatus,
}: {
  databases: readonly [CheckedMigrationDatabase, CheckedMigrationDatabase];
  plan: MigrationPlan;
  onStatus?: (message: string) => void;
}): Promise<[RunCheckedMigrationsResult, RunCheckedMigrationsResult]> {
  const ledgerExists = await databases[0].hasLedger();
  const baselineSchema = plan.migrations[0]!.schema;
  const schema = await databases[0].inspectPublicSchema(baselineSchema);
  if (ledgerExists || !isSchemaFingerprintEmpty(schema)) {
    throw new Error('Concurrent migration smoke requires an empty public schema with no ledger');
  }

  const results = (await Promise.all(
    databases.map((database, index) =>
      runCheckedMigrations({
        database,
        plan,
        onStatus: (message) => onStatus?.(`runner-${index + 1}: ${message}`),
      }),
    ),
  )) as [RunCheckedMigrationsResult, RunCheckedMigrationsResult];

  const appliedCounts = results.map(({ applied }) => applied.length).sort((a, b) => a - b);
  if (appliedCounts[0] !== 0 || appliedCounts[1] !== plan.migrations.length) {
    throw new Error(
      `Concurrent migration smoke expected one complete runner and one no-op; observed ${appliedCounts.join(
        ' and ',
      )} applied migrations`,
    );
  }

  await Promise.all(databases.map((database) => assertCurrentParity(database, plan)));
  onStatus?.('Concurrent migration startup serialized and reached exact current-schema parity.');
  return results;
}

async function main(): Promise<void> {
  const env = process.env;
  const mode = parseMigrationSmokeMode(process.argv.slice(2));
  assertExplicitMigrationSmokeTarget(env);

  const plan = loadMigrationPlan(resolve(__dirname, '../migrations'));
  const target = getScriptDatabaseTarget({
    env,
    overrideEnvVar: 'MIGRATION_SMOKE_DATABASE_URL',
  });

  console.log(formatDatabaseTarget(target));
  console.log(`Connection: ${target.redactedConnectionString}`);
  console.log(`Running ${mode} checked-migration smoke test.`);

  const pool = new Pool({
    connectionString: target.connectionString,
    max: mode === 'concurrent' ? 2 : 1,
  });
  try {
    if (mode === 'concurrent') {
      const clients = await Promise.all([pool.connect(), pool.connect()]);
      try {
        await runConcurrentMigrationSmoke({
          databases: [
            new PostgresMigrationDatabase(clients[0]),
            new PostgresMigrationDatabase(clients[1]),
          ],
          plan,
          onStatus: console.log,
        });
      } finally {
        clients.forEach((client) => client.release());
      }
      return;
    }

    const client = await pool.connect();
    try {
      await runMigrationSmoke({
        mode,
        database: new PostgresMigrationDatabase(client),
        plan,
        onStatus: console.log,
      });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
