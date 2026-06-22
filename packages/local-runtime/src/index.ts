import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ScriptEnv = Record<string, string | undefined>;

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_DB_USER = 'sentris';
const DEFAULT_DB_PASSWORD = 'sentris';
const DEFAULT_DB_HOST = 'localhost';
const DEFAULT_DB_PORT = '5433';
const DEFAULT_TEMPORAL_PREFIX = 'sentris-dev';
const SCRIPT_DATABASE_URL_ENV = 'SENTRIS_SCRIPT_DATABASE_URL';
const SCRIPT_TEMPORAL_NAMESPACE_ENV = 'SENTRIS_SCRIPT_TEMPORAL_NAMESPACE';
const SCRIPT_TEMPORAL_TASK_QUEUE_ENV = 'SENTRIS_SCRIPT_TEMPORAL_TASK_QUEUE';

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

export interface ScriptTemporalTarget {
  namespace: string;
  taskQueue: string;
  source: string;
  ignoredTemporalEnv: boolean;
}

export interface ScriptDatabaseTargetOptions {
  env?: ScriptEnv;
  repoRoot?: string;
  overrideEnvVar?: string;
}

export interface ScriptTemporalTargetOptions {
  env?: ScriptEnv;
  repoRoot?: string;
  namespaceOverrideEnvVar?: string;
  taskQueueOverrideEnvVar?: string;
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

function buildInstanceTemporalName(instance: string): string {
  return `${DEFAULT_TEMPORAL_PREFIX}-${instance}`;
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

function readDatabaseOverride(
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

function readTemporalOverride(
  env: ScriptEnv,
  namespaceOverrideEnvVar?: string,
  taskQueueOverrideEnvVar?: string,
): { namespace: string; taskQueue: string; source: string } | null {
  const scriptNamespace =
    namespaceOverrideEnvVar !== undefined ? env[namespaceOverrideEnvVar]?.trim() : undefined;
  const scriptTaskQueue =
    taskQueueOverrideEnvVar !== undefined ? env[taskQueueOverrideEnvVar]?.trim() : undefined;

  if (scriptNamespace || scriptTaskQueue) {
    const namespace = scriptNamespace;
    const taskQueue = scriptTaskQueue;
    if (!namespace || !taskQueue) {
      throw new Error(
        `Both ${namespaceOverrideEnvVar ?? SCRIPT_TEMPORAL_NAMESPACE_ENV} and ${
          taskQueueOverrideEnvVar ?? SCRIPT_TEMPORAL_TASK_QUEUE_ENV
        } must be set when overriding Temporal target`,
      );
    }
    return {
      namespace,
      taskQueue,
      source: `env:${namespaceOverrideEnvVar}/env:${taskQueueOverrideEnvVar}`,
    };
  }

  const genericNamespace = env[SCRIPT_TEMPORAL_NAMESPACE_ENV]?.trim();
  const genericTaskQueue = env[SCRIPT_TEMPORAL_TASK_QUEUE_ENV]?.trim();
  if (genericNamespace || genericTaskQueue) {
    if (!genericNamespace || !genericTaskQueue) {
      throw new Error(
        `Both ${SCRIPT_TEMPORAL_NAMESPACE_ENV} and ${SCRIPT_TEMPORAL_TASK_QUEUE_ENV} must be set when overriding Temporal target`,
      );
    }
    return {
      namespace: genericNamespace,
      taskQueue: genericTaskQueue,
      source: `env:${SCRIPT_TEMPORAL_NAMESPACE_ENV}/env:${SCRIPT_TEMPORAL_TASK_QUEUE_ENV}`,
    };
  }

  return null;
}

export function getScriptDatabaseTarget({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
  overrideEnvVar,
}: ScriptDatabaseTargetOptions = {}): ScriptDatabaseTarget {
  const override = readDatabaseOverride(env, overrideEnvVar);
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

export function getScriptTemporalTarget({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
  namespaceOverrideEnvVar,
  taskQueueOverrideEnvVar,
}: ScriptTemporalTargetOptions = {}): ScriptTemporalTarget {
  const override = readTemporalOverride(env, namespaceOverrideEnvVar, taskQueueOverrideEnvVar);
  const activeInstance = override ? null : readActiveInstance({ env, repoRoot });
  const instanceName = buildInstanceTemporalName(activeInstance?.instance ?? '0');
  const namespace = override ? override.namespace : instanceName;
  const taskQueue = override ? override.taskQueue : instanceName;
  const source = override ? override.source : (activeInstance?.source ?? 'default:instance-0');

  return {
    namespace,
    taskQueue,
    source,
    ignoredTemporalEnv: Boolean(
      !override && (env.TEMPORAL_NAMESPACE?.trim() || env.TEMPORAL_TASK_QUEUE?.trim()),
    ),
  };
}

export function formatDatabaseTarget(target: ScriptDatabaseTarget): string {
  const ignored = target.ignoredDatabaseUrl
    ? ' (DATABASE_URL ignored; use a script-specific override to target another DB)'
    : '';
  return `Target database: ${target.databaseName} via ${target.source}${ignored}`;
}

export function formatTemporalTarget(target: ScriptTemporalTarget): string {
  const ignored = target.ignoredTemporalEnv
    ? ' (TEMPORAL_NAMESPACE/TEMPORAL_TASK_QUEUE ignored; use SENTRIS_SCRIPT_TEMPORAL_* or script-specific overrides to target another namespace)'
    : '';
  return `Target Temporal: namespace=${target.namespace}, taskQueue=${target.taskQueue} via ${target.source}${ignored}`;
}
