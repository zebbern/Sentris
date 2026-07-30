const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_DATABASE_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINAL_REDIS_COMMAND_TIMEOUT_MS = 10_000;

export interface WorkerRuntimeTimeouts {
  databaseConnectionTimeoutMs: number;
  databaseQueryTimeoutMs: number;
  terminalRedisCommandTimeoutMs: number;
}

export function resolveWorkerRuntimeTimeouts(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeTimeouts {
  return {
    databaseConnectionTimeoutMs: positiveInteger(
      env.WORKER_DATABASE_CONNECTION_TIMEOUT_MS,
      DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
    ),
    databaseQueryTimeoutMs: positiveInteger(
      env.WORKER_DATABASE_QUERY_TIMEOUT_MS,
      DEFAULT_DATABASE_QUERY_TIMEOUT_MS,
    ),
    terminalRedisCommandTimeoutMs: positiveInteger(
      env.TERMINAL_REDIS_COMMAND_TIMEOUT_MS,
      DEFAULT_TERMINAL_REDIS_COMMAND_TIMEOUT_MS,
    ),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
