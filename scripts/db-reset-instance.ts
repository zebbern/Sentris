import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
  readActiveInstance,
  type ScriptDatabaseTarget,
} from './lib/local-script-runtime';

const USAGE = 'Usage: bun run db:reset [-- --instance <0-9>]';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSTGRES_CONTAINER = 'sentris-postgres';

export interface DbResetCliOptions {
  instance?: string;
}

export interface ResolvedDbResetTarget {
  instance: string;
  target: ScriptDatabaseTarget;
}

export interface ResolveDbResetTargetOptions {
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
}

export interface ProcessInvocation {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  captureOutput: boolean;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (invocation: ProcessInvocation) => Promise<ProcessResult>;

export interface ExecuteDbResetCommandOptions {
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  runProcess?: ProcessRunner;
  log?: (message: string) => void;
}

export interface DbResetResult {
  instance: string;
  databaseName: string;
}

const RESET_DATABASE_OVERRIDE_ENV = ['SENTRIS_SCRIPT_DATABASE_URL', 'DRIZZLE_DATABASE_URL'] as const;

export function parseDbResetArgs(args: readonly string[]): DbResetCliOptions {
  if (args.length === 0) {
    return {};
  }
  if (args.length === 2 && args[0] === '--instance' && /^[0-9]$/.test(args[1] ?? '')) {
    return { instance: args[1] };
  }
  throw new Error(USAGE);
}

export function resolveDbResetTarget({
  args,
  env = process.env,
  repoRoot,
}: ResolveDbResetTargetOptions): ResolvedDbResetTarget {
  const options = parseDbResetArgs(args);
  if (RESET_DATABASE_OVERRIDE_ENV.some((name) => env[name]?.trim())) {
    throw new Error(
      'Database URL overrides are not supported by db:reset; select an instance instead.',
    );
  }

  const targetEnv = { ...env };
  delete targetEnv.E2E_INSTANCE;
  if (options.instance !== undefined) {
    targetEnv.SENTRIS_INSTANCE = options.instance;
  }

  const active = readActiveInstance({ env: targetEnv, repoRoot });
  const target = getScriptDatabaseTarget({ env: targetEnv, repoRoot });
  const resolved = { instance: active.instance, target };
  validateDbResetTarget(resolved);
  return resolved;
}

export function validateDbResetTarget({ instance, target }: ResolvedDbResetTarget): void {
  const expectedDatabase = `sentris_instance_${instance}`;
  let parsed: URL;
  try {
    parsed = new URL(target.connectionString);
  } catch {
    throw new Error(
      `Refusing database reset: expected postgresql://sentris@localhost:5433/${expectedDatabase}`,
    );
  }

  if (
    target.databaseName !== expectedDatabase ||
    parsed.protocol !== 'postgresql:' ||
    parsed.username !== 'sentris' ||
    parsed.hostname !== 'localhost' ||
    parsed.port !== '5433' ||
    parsed.pathname !== `/${expectedDatabase}` ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      `Refusing database reset: expected postgresql://sentris@localhost:5433/${expectedDatabase}`,
    );
  }
}

export class NativeCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'NativeCommandError';
  }
}

export async function runNativeProcess({
  command,
  args,
  cwd,
  env,
  captureOutput,
}: ProcessInvocation): Promise<ProcessResult> {
  return await new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';

    if (captureOutput) {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.once('error', (error) => {
      rejectProcess(
        new NativeCommandError(
          `Failed to start ${command}: ${error instanceof Error ? error.message : String(error)}`,
          1,
        ),
      );
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveProcess({ stdout, stderr });
        return;
      }
      rejectProcess(
        new NativeCommandError(
          `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code ?? 1}`}`,
          code && code > 0 ? code : 1,
        ),
      );
    });
  });
}

function createMigrationEnvironment(
  env: NodeJS.ProcessEnv,
  instance: string,
  connectionString: string,
): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  delete childEnv.DATABASE_URL;
  delete childEnv.SENTRIS_SCRIPT_DATABASE_URL;
  delete childEnv.DRIZZLE_DATABASE_URL;

  return {
    ...childEnv,
    DRIZZLE_DATABASE_URL: connectionString,
    NODE_ENV: 'development',
    SENTRIS_ENV: 'development',
    SENTRIS_INSTANCE: instance,
  };
}

export async function executeDbResetCommand({
  args,
  env = process.env,
  repoRoot = REPO_ROOT,
  runProcess = runNativeProcess,
  log = console.log,
}: ExecuteDbResetCommandOptions): Promise<DbResetResult> {
  const resolved = resolveDbResetTarget({ args, env, repoRoot });
  validateDbResetTarget(resolved);

  log(formatDatabaseTarget(resolved.target));
  log(`Connection: ${resolved.target.redactedConnectionString}`);
  log(`Container: ${POSTGRES_CONTAINER}`);

  const containerResult = await runProcess({
    command: 'docker',
    args: [
      'ps',
      '--filter',
      `name=^/${POSTGRES_CONTAINER}$`,
      '--filter',
      'status=running',
      '--format',
      '{{.Names}}',
    ],
    cwd: repoRoot,
    captureOutput: true,
  });
  const containerNames = containerResult.stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (containerNames.length !== 1 || containerNames[0] !== POSTGRES_CONTAINER) {
    throw new Error(
      `PostgreSQL container ${POSTGRES_CONTAINER} is not running. Start shared infrastructure first.`,
    );
  }

  const databaseName = resolved.target.databaseName;
  log(`Dropping and recreating ${databaseName}...`);
  await runProcess({
    command: 'docker',
    args: [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'sentris',
      '-d',
      'postgres',
      '-c',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();`,
      '-c',
      `DROP DATABASE IF EXISTS "${databaseName}";`,
      '-c',
      `CREATE DATABASE "${databaseName}" OWNER sentris;`,
      '-c',
      `GRANT ALL PRIVILEGES ON DATABASE "${databaseName}" TO sentris;`,
    ],
    cwd: repoRoot,
    captureOutput: false,
  });

  log(`Running checked migrations for instance ${resolved.instance}...`);
  await runProcess({
    command: process.execPath,
    args: ['--cwd=backend', 'run', 'migration:run'],
    cwd: repoRoot,
    env: createMigrationEnvironment(env, resolved.instance, resolved.target.connectionString),
    captureOutput: false,
  });

  log(`Database reset complete for instance ${resolved.instance}.`);
  return { instance: resolved.instance, databaseName };
}

if (import.meta.main) {
  executeDbResetCommand({ args: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof NativeCommandError ? error.exitCode : 1;
  });
}
