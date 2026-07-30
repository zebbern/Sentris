/* eslint-disable no-console -- This guarded maintenance command reports its resolved target. */
import { resolve } from 'path';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
  type ScriptDatabaseTarget,
} from '../../scripts/lib/local-script-runtime';

type ScriptEnvironment = Record<string, string | undefined>;
const TARGET_OVERRIDE_ARGUMENTS = [
  '--config',
  '--url',
  '--host',
  '--port',
  '--user',
  '--password',
  '--database',
  '--ssl',
  '--auth-token',
  '--authToken',
  '--tlsSecurity',
  '--driver',
] as const;

export interface ExecuteDisposableDevSchemaPushOptions {
  args: string[];
  env?: ScriptEnvironment;
  resolveTarget?: () => ScriptDatabaseTarget;
  log?: (message: string) => void;
  run?: (input: { command: string[]; env: ScriptEnvironment }) => Promise<number>;
}

export function assertDisposableDevSchemaPushAllowed(env: ScriptEnvironment): void {
  const environmentNames = [env.NODE_ENV, env.SENTRIS_ENV]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  if (
    environmentNames.some(
      (value) => value === 'production' || value === 'prod' || value === 'staging',
    )
  ) {
    throw new Error('Schema push is disabled in production-like environments');
  }
  if (env.SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH !== 'true') {
    throw new Error(
      'Set SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH=true only for an intentionally disposable development database.',
    );
  }
}

function assertNoSchemaPushTargetOverrides(args: readonly string[]): void {
  for (const argument of args) {
    const override = TARGET_OVERRIDE_ARGUMENTS.find(
      (candidate) => argument === candidate || argument.startsWith(`${candidate}=`),
    );
    if (override) {
      throw new Error(
        `Schema push target overrides are not allowed (${override}); select the disposable target through SENTRIS_INSTANCE or DRIZZLE_DATABASE_URL.`,
      );
    }
  }
}

async function runDrizzleSchemaPush({
  command,
  env,
}: {
  command: string[];
  env: ScriptEnvironment;
}): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return child.exited;
}

export async function executeDisposableDevSchemaPush({
  args,
  env = process.env,
  resolveTarget = () =>
    getScriptDatabaseTarget({
      env,
      overrideEnvVar: 'DRIZZLE_DATABASE_URL',
    }),
  log = console.log,
  run = runDrizzleSchemaPush,
}: ExecuteDisposableDevSchemaPushOptions): Promise<void> {
  assertDisposableDevSchemaPushAllowed(env);
  assertNoSchemaPushTargetOverrides(args);
  const target = resolveTarget();
  log(formatDatabaseTarget(target));
  log(`Connection: ${target.redactedConnectionString}`);
  log(
    'Running irreversible schema push only against the opted-in disposable development database.',
  );

  const exitCode = await run({
    command: ['bun', 'x', 'drizzle-kit', 'push', ...args],
    env: {
      ...env,
      DRIZZLE_DATABASE_URL: target.connectionString,
    },
  });
  if (exitCode !== 0) {
    throw new Error(`Drizzle schema push failed with exit code ${exitCode}`);
  }
}

if (import.meta.main) {
  executeDisposableDevSchemaPush({ args: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
