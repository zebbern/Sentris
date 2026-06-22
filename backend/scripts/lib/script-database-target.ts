import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

type ScriptEnv = Record<string, string | undefined>;

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_DB_USER = 'sentris';
const DEFAULT_DB_PASSWORD = 'sentris';
const DEFAULT_DB_HOST = 'localhost';
const DEFAULT_DB_PORT = '5433';
const SCRIPT_DATABASE_URL_ENV = 'SENTRIS_SCRIPT_DATABASE_URL';

export interface ActiveInstance {
  instance: string;
  source: string;
}

export interface ScriptDatabaseTarget {
  connectionString: string;
  redactedConnectionString: string;
  databaseName: string;
  source: string;
  ignoredDatabaseUrl: boolean;
}

export interface ScriptDatabaseTargetOptions {
  env?: ScriptEnv;
  repoRoot?: string;
  overrideEnvVar?: string;
}

function validateInstance(value: string, source: string): string {
  if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 9) {
    throw new Error(`${source} must be an integer from 0 to 9`);
  }
  return value;
}

function readMarkerInstance(repoRoot: string): string | null {
  const markerPath = join(repoRoot, '.sentris-instance');
  if (!existsSync(markerPath)) return null;

  const value = readFileSync(markerPath, 'utf-8').trim();
  return value.length > 0 ? value : null;
}

export function readActiveInstance({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
}: Pick<ScriptDatabaseTargetOptions, 'env' | 'repoRoot'> = {}): ActiveInstance {
  const sentrisInstance = env.SENTRIS_INSTANCE?.trim();
  if (sentrisInstance) {
    return {
      instance: validateInstance(sentrisInstance, 'SENTRIS_INSTANCE'),
      source: 'env:SENTRIS_INSTANCE',
    };
  }

  const e2eInstance = env.E2E_INSTANCE?.trim();
  if (e2eInstance) {
    return {
      instance: validateInstance(e2eInstance, 'E2E_INSTANCE'),
      source: 'env:E2E_INSTANCE',
    };
  }

  const markerInstance = readMarkerInstance(repoRoot);
  if (markerInstance) {
    return {
      instance: validateInstance(markerInstance, '.sentris-instance'),
      source: 'file:.sentris-instance',
    };
  }

  return { instance: '0', source: 'default:instance-0' };
}

function buildInstanceDatabaseUrl(instance: string): string {
  return `postgresql://${DEFAULT_DB_USER}:${DEFAULT_DB_PASSWORD}@${DEFAULT_DB_HOST}:${DEFAULT_DB_PORT}/sentris_instance_${instance}`;
}

export function getDatabaseName(connectionString: string): string {
  try {
    return new URL(connectionString).pathname.replace(/^\//, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function redactConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

function readOverride(
  env: ScriptEnv,
  overrideEnvVar?: string,
): { value: string; source: string } | null {
  if (overrideEnvVar) {
    const scriptOverride = env[overrideEnvVar]?.trim();
    if (scriptOverride) return { value: scriptOverride, source: `env:${overrideEnvVar}` };
  }

  const genericOverride = env[SCRIPT_DATABASE_URL_ENV]?.trim();
  if (genericOverride) {
    return { value: genericOverride, source: `env:${SCRIPT_DATABASE_URL_ENV}` };
  }

  return null;
}

export function getScriptDatabaseTarget({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
  overrideEnvVar,
}: ScriptDatabaseTargetOptions = {}): ScriptDatabaseTarget {
  const override = readOverride(env, overrideEnvVar);
  const activeInstance = override ? null : readActiveInstance({ env, repoRoot });
  const connectionString = override
    ? override.value
    : buildInstanceDatabaseUrl(activeInstance?.instance ?? '0');
  const source = override ? override.source : (activeInstance?.source ?? 'default:instance-0');

  return {
    connectionString,
    redactedConnectionString: redactConnectionString(connectionString),
    databaseName: getDatabaseName(connectionString),
    source,
    ignoredDatabaseUrl: Boolean(env.DATABASE_URL?.trim()),
  };
}

export function formatDatabaseTarget(target: ScriptDatabaseTarget): string {
  const ignored = target.ignoredDatabaseUrl
    ? ' (DATABASE_URL ignored; use a script-specific override to target another DB)'
    : '';
  return `Target database: ${target.databaseName} via ${target.source}${ignored}`;
}
