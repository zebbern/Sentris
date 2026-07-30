import { execFile } from 'node:child_process';

import type { CheckResult, ReadinessCheck } from './health-server';

interface TemporalConnectionLike {
  workflowService: {
    getSystemInfo(input: Record<string, never>): Promise<unknown>;
  };
}

interface DatabasePoolLike {
  query(sql: string): Promise<unknown>;
}

interface MinioLike {
  client: {
    bucketExists(bucketName: string): Promise<boolean>;
  };
  bucketName: string;
}

interface RedisLike {
  ping(): Promise<string>;
}

export interface KafkaReadiness {
  check(): Promise<void>;
  close?(): Promise<void>;
}

interface BackendReadiness {
  apiBaseUrl: string;
  internalToken?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;
}

export interface WorkerReadinessState {
  acceptingTasks: boolean;
  maintenanceError?: string;
  telemetryError?: string;
}

interface DockerExecOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  signal?: AbortSignal;
}

export type DockerExec = (
  command: string,
  args: string[],
  options?: DockerExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface WorkerReadinessDeps {
  temporalConnection: TemporalConnectionLike;
  databasePool: DatabasePoolLike;
  minio: MinioLike;
  redis?: RedisLike;
  kafka: KafkaReadiness;
  backend?: BackendReadiness;
  dockerExec?: DockerExec;
  dockerEnv?: NodeJS.ProcessEnv;
  workerState: WorkerReadinessState;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function check(operation: () => Promise<void>): Promise<CheckResult> {
  try {
    await operation();
    return { status: 'ok' };
  } catch (error: unknown) {
    return { status: 'unhealthy', message: messageFor(error) };
  }
}

const executeDocker: DockerExec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        env: options?.env,
        timeout: options?.timeout,
        signal: options?.signal,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

export function createWorkerReadinessChecks(
  deps: WorkerReadinessDeps,
): Record<string, ReadinessCheck> {
  return {
    worker: async () =>
      deps.workerState.acceptingTasks
        ? { status: 'ok' }
        : { status: 'unhealthy', message: 'Temporal worker is not accepting tasks' },
    maintenance: async () =>
      deps.workerState.maintenanceError
        ? { status: 'unhealthy', message: deps.workerState.maintenanceError }
        : { status: 'ok' },
    telemetry: async () =>
      deps.workerState.telemetryError
        ? { status: 'unhealthy', message: deps.workerState.telemetryError }
        : { status: 'ok' },
    temporal: () =>
      check(async () => {
        await deps.temporalConnection.workflowService.getSystemInfo({});
      }),
    docker: (signal) =>
      check(async () => {
        const result = await (deps.dockerExec ?? executeDocker)(
          'docker',
          ['info', '--format', '{{.ServerVersion}}'],
          {
            env: deps.dockerEnv ?? process.env,
            timeout: 2_500,
            signal,
          },
        );
        if (!result.stdout.trim()) {
          throw new Error('Docker daemon returned an empty server version');
        }
      }),
    postgres: () =>
      check(async () => {
        await deps.databasePool.query('SELECT 1');
      }),
    minio: async () => {
      try {
        const exists = await deps.minio.client.bucketExists(deps.minio.bucketName);
        return exists
          ? { status: 'ok' }
          : {
              status: 'unhealthy',
              message: `Required MinIO bucket "${deps.minio.bucketName}" does not exist`,
            };
      } catch (error: unknown) {
        return { status: 'unhealthy', message: messageFor(error) };
      }
    },
    redis: async () => {
      if (!deps.redis) return { status: 'not_configured' };
      try {
        const pong = await deps.redis.ping();
        return pong === 'PONG'
          ? { status: 'ok' }
          : { status: 'unhealthy', message: `Unexpected Redis PING response: ${pong}` };
      } catch (error: unknown) {
        return { status: 'unhealthy', message: messageFor(error) };
      }
    },
    kafka: () => check(() => deps.kafka.check()),
    backend: async (signal) => {
      if (!deps.backend) return { status: 'not_configured' };
      if (!deps.backend.internalToken) {
        return {
          status: 'unhealthy',
          message: 'INTERNAL_SERVICE_TOKEN is not configured',
        };
      }

      return check(async () => {
        const apiBaseUrl = deps.backend!.apiBaseUrl.replace(/\/+$/, '');
        const response = await (deps.backend!.fetch ?? globalThis.fetch)(
          `${apiBaseUrl}/internal/health/worker-ready`,
          {
            headers: { 'x-internal-token': deps.backend!.internalToken! },
            signal: signal ?? AbortSignal.timeout(2_500),
          },
        );
        if (!response.ok) {
          throw new Error(`Backend worker readiness returned HTTP ${response.status}`);
        }
      });
    },
  };
}
