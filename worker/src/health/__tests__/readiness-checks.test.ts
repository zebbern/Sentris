import { describe, expect, it, vi } from 'bun:test';

describe('worker dependency readiness checks', () => {
  it('probes configured worker dependencies through their real client boundaries', async () => {
    const readiness = await import('../readiness-checks').catch(() => undefined);
    const calls: string[] = [];
    const dockerExec = vi.fn(
      async (command: string, args: string[], options: { env?: NodeJS.ProcessEnv } | undefined) => {
        calls.push(`docker:${command}:${args.join(' ')}`);
        expect(options?.env?.DOCKER_HOST).toBe('tcp://dind:2376');
        expect(options?.env?.DOCKER_TLS_VERIFY).toBe('1');
        expect(options?.env?.DOCKER_CERT_PATH).toBe('/certs/client');
        return { stdout: '27.5.1\n', stderr: '' };
      },
    );
    const checks = readiness?.createWorkerReadinessChecks({
      temporalConnection: {
        workflowService: {
          getSystemInfo: async () => {
            calls.push('temporal');
            return {};
          },
        },
      },
      databasePool: {
        query: async (sql: string) => {
          calls.push(`postgres:${sql}`);
          return { rows: [{ '?column?': 1 }] };
        },
      },
      minio: {
        client: {
          bucketExists: async (bucketName: string) => {
            calls.push(`minio:${bucketName}`);
            return true;
          },
        },
        bucketName: 'sentris-files',
      },
      redis: {
        ping: async () => {
          calls.push('redis');
          return 'PONG';
        },
      },
      kafka: {
        check: async () => {
          calls.push('kafka');
        },
      },
      mcpRuntime: {
        check: async () => {
          calls.push('mcp-runtime');
        },
      },
      backend: {
        apiBaseUrl: 'http://backend:3211/api/v1',
        internalToken: 'worker-token',
        fetch: async (url: string, init?: RequestInit) => {
          calls.push(`backend:${url}`);
          expect(init?.headers).toEqual({ 'x-internal-token': 'worker-token' });
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          return { ok: true, status: 200 };
        },
      },
      dockerExec,
      dockerEnv: {
        DOCKER_HOST: 'tcp://dind:2376',
        DOCKER_TLS_VERIFY: '1',
        DOCKER_CERT_PATH: '/certs/client',
      },
      workerState: {
        acceptingTasks: true,
        maintenanceError: undefined,
        mcpRuntimeError: undefined,
        telemetryError: undefined,
      },
    });

    const results = checks
      ? Object.fromEntries(
          await Promise.all(
            Object.entries(checks).map(async ([name, check]) => [name, await check()]),
          ),
        )
      : undefined;

    expect(results).toEqual({
      worker: { status: 'ok' },
      maintenance: { status: 'ok' },
      mcpRuntime: { status: 'ok' },
      telemetry: { status: 'ok' },
      temporal: { status: 'ok' },
      docker: { status: 'ok' },
      postgres: { status: 'ok' },
      minio: { status: 'ok' },
      redis: { status: 'ok' },
      kafka: { status: 'ok' },
      backend: { status: 'ok' },
    });
    expect(calls).toContain('temporal');
    expect(calls).toContain('postgres:SELECT 1');
    expect(calls).toContain('minio:sentris-files');
    expect(calls).toContain('redis');
    expect(calls).toContain('kafka');
    expect(calls).toContain('mcp-runtime');
    expect(calls).toContain('backend:http://backend:3211/api/v1/internal/health/worker-ready');
    expect(dockerExec).toHaveBeenCalledTimes(1);
  });

  it('marks backend readiness unhealthy when the authenticated internal probe rejects the token', async () => {
    const readiness = await import('../readiness-checks').catch(() => undefined);
    const checks = readiness?.createWorkerReadinessChecks({
      temporalConnection: {
        workflowService: { getSystemInfo: async () => ({}) },
      },
      databasePool: { query: async () => ({ rows: [{ '?column?': 1 }] }) },
      minio: {
        client: { bucketExists: async () => true },
        bucketName: 'sentris-files',
      },
      kafka: { check: async () => undefined },
      backend: {
        apiBaseUrl: 'http://backend:3211/api/v1',
        internalToken: 'wrong-worker-token',
        fetch: async (_url, init) => {
          expect(init?.headers).toEqual({ 'x-internal-token': 'wrong-worker-token' });
          return { ok: false, status: 401 };
        },
      },
      dockerExec: async () => ({ stdout: '27.5.1\n', stderr: '' }),
      dockerEnv: {},
      workerState: { acceptingTasks: true },
    });

    expect(await checks?.backend()).toEqual({
      status: 'unhealthy',
      message: 'Backend worker readiness returned HTTP 401',
    });
  });

  it('marks optional Redis and backend checks not configured when unused', async () => {
    const readiness = await import('../readiness-checks').catch(() => undefined);
    const checks = readiness?.createWorkerReadinessChecks({
      temporalConnection: {
        workflowService: { getSystemInfo: async () => ({}) },
      },
      databasePool: { query: async () => ({ rows: [{ '?column?': 1 }] }) },
      minio: {
        client: { bucketExists: async () => true },
        bucketName: 'sentris-files',
      },
      kafka: { check: async () => undefined },
      dockerExec: async () => ({ stdout: '27.5.1\n', stderr: '' }),
      dockerEnv: {},
      workerState: { acceptingTasks: true },
    });

    expect(await checks?.redis()).toEqual({ status: 'not_configured' });
    expect(await checks?.backend()).toEqual({ status: 'not_configured' });
  });

  it('fails MCP readiness when its lease probe fails even with no inventoried resources', async () => {
    const readiness = await import('../readiness-checks').catch(() => undefined);
    const checks = readiness?.createWorkerReadinessChecks({
      temporalConnection: {
        workflowService: { getSystemInfo: async () => ({}) },
      },
      databasePool: { query: async () => ({ rows: [{ '?column?': 1 }] }) },
      minio: {
        client: { bucketExists: async () => true },
        bucketName: 'sentris-files',
      },
      kafka: { check: async () => undefined },
      mcpRuntime: {
        check: async () => {
          throw new Error('runtime Redis unavailable');
        },
      },
      dockerExec: async () => ({ stdout: '27.5.1\n', stderr: '' }),
      dockerEnv: {},
      workerState: { acceptingTasks: true },
    });

    expect(await checks?.mcpRuntime()).toEqual({
      status: 'unhealthy',
      message: 'runtime Redis unavailable',
    });
  });

  it('fails closed for unavailable storage, missing callback credentials, and maintenance errors', async () => {
    const readiness = await import('../readiness-checks').catch(() => undefined);
    const checks = readiness?.createWorkerReadinessChecks({
      temporalConnection: {
        workflowService: { getSystemInfo: async () => ({}) },
      },
      databasePool: { query: async () => ({ rows: [{ '?column?': 1 }] }) },
      minio: {
        client: { bucketExists: async () => false },
        bucketName: 'sentris-files',
      },
      kafka: { check: async () => undefined },
      backend: {
        apiBaseUrl: 'http://backend:3211/api/v1',
        internalToken: undefined,
        fetch: async () => ({ ok: true, status: 200 }),
      },
      dockerExec: async () => ({ stdout: '27.5.1\n', stderr: '' }),
      dockerEnv: {},
      workerState: {
        acceptingTasks: false,
        maintenanceError: 'orphan volume removal failed',
        mcpRuntimeError: 'MCP runtime lease reconciliation failed',
        telemetryError: 'Kafka and the durable PostgreSQL fallback are unavailable',
      },
    });

    expect(await checks?.worker()).toEqual({
      status: 'unhealthy',
      message: 'Temporal worker is not accepting tasks',
    });
    expect(await checks?.maintenance()).toEqual({
      status: 'unhealthy',
      message: 'orphan volume removal failed',
    });
    expect(await checks?.mcpRuntime()).toEqual({
      status: 'unhealthy',
      message: 'MCP runtime lease reconciliation failed',
    });
    expect(await checks?.telemetry()).toEqual({
      status: 'unhealthy',
      message: 'Kafka and the durable PostgreSQL fallback are unavailable',
    });
    expect(await checks?.minio()).toEqual({
      status: 'unhealthy',
      message: 'Required MinIO bucket "sentris-files" does not exist',
    });
    expect(await checks?.backend()).toEqual({
      status: 'unhealthy',
      message: 'INTERNAL_SERVICE_TOKEN is not configured',
    });
  });
});
