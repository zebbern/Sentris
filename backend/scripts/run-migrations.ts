/* eslint-disable no-console -- The migration runner is a command-line startup gate. */
import 'dotenv/config';
import { resolve } from 'path';
import { Pool } from 'pg';
import {
  formatDatabaseTarget,
  getDrizzleDatabaseTarget,
  type ScriptDatabaseTarget,
} from '../../scripts/lib/local-script-runtime';
import {
  loadMigrationPlan,
  runCheckedMigrations,
  type MigrationPlan,
  type RunCheckedMigrationsResult,
} from '../src/database/migrations/checked-migrations';
import {
  PostgresMigrationDatabase,
  type MigrationQueryClient,
} from '../src/database/migrations/postgres-migration-database';

const USAGE = 'Usage: bun run migration:run [--adopt v1.0.0]';

export interface MigrationCliOptions {
  adoptVersion?: string;
}

export interface MigrationCommandConnection {
  client: MigrationQueryClient;
  close(): Promise<void>;
}

export interface ExecuteMigrationCommandOptions {
  args: string[];
  migrationsDir?: string;
  resolveTarget?: () => ScriptDatabaseTarget;
  loadPlan?: (migrationsDir: string) => MigrationPlan;
  openConnection?: (connectionString: string) => Promise<MigrationCommandConnection>;
  log?: (message: string) => void;
}

export function parseMigrationCliArgs(args: readonly string[]): MigrationCliOptions {
  if (args.length === 0) {
    return {};
  }
  if (args.length === 2 && args[0] === '--adopt' && args[1] === 'v1.0.0') {
    return { adoptVersion: args[1] };
  }
  throw new Error(USAGE);
}

async function openPostgresConnection(
  connectionString: string,
): Promise<MigrationCommandConnection> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    return {
      client,
      async close() {
        client.release();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function executeMigrationCommand({
  args,
  migrationsDir = resolve(__dirname, '../migrations'),
  resolveTarget = () => getDrizzleDatabaseTarget(),
  loadPlan: loadPlanDependency = loadMigrationPlan,
  openConnection = openPostgresConnection,
  log = console.log,
}: ExecuteMigrationCommandOptions): Promise<RunCheckedMigrationsResult> {
  const cliOptions = parseMigrationCliArgs(args);
  const plan = loadPlanDependency(migrationsDir);
  const target = resolveTarget();

  log(formatDatabaseTarget(target));
  log(`Connection: ${target.redactedConnectionString}`);

  const connection = await openConnection(target.connectionString);
  try {
    const result = await runCheckedMigrations({
      database: new PostgresMigrationDatabase(connection.client),
      plan,
      adoptVersion: cliOptions.adoptVersion,
      onStatus: log,
    });

    if (result.applied.length === 0) {
      log('Database migrations are already current.');
    } else {
      log(`Applied ${result.applied.length} checked migration(s).`);
    }
    return result;
  } finally {
    await connection.close();
  }
}

if (import.meta.main) {
  executeMigrationCommand({ args: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
