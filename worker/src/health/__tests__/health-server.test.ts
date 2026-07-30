import { afterEach, describe, expect, it } from 'bun:test';

import * as healthServer from '../health-server';

const originalHealthPort = process.env.WORKER_HEALTH_PORT;

afterEach(() => {
  if (originalHealthPort === undefined) {
    delete process.env.WORKER_HEALTH_PORT;
  } else {
    process.env.WORKER_HEALTH_PORT = originalHealthPort;
  }
});

describe('worker health HTTP server', () => {
  it('keeps liveness process-only when readiness is unhealthy', async () => {
    process.env.WORKER_HEALTH_PORT = '0';
    const handle = await healthServer.startHealthServer(
      {
        readiness: async () => ({
          status: 'unhealthy',
          service: 'sentris-worker',
          timestamp: new Date().toISOString(),
          checks: { docker: { status: 'unhealthy', message: 'unavailable' } },
        }),
      } as never,
      { port: 0 },
    );

    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
      const body = (await response.json()) as { status: string; checks?: unknown };

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.checks).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('returns readiness failures as HTTP 503 with per-dependency detail', async () => {
    const handle = await healthServer.startHealthServer(
      {
        readiness: async () => ({
          status: 'unhealthy',
          service: 'sentris-worker',
          timestamp: new Date().toISOString(),
          checks: { postgres: { status: 'unhealthy', message: 'connection refused' } },
        }),
      } as never,
      { port: 0 },
    );

    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/health/ready`);
      const body = (await response.json()) as {
        status: string;
        checks: Record<string, { status: string }>;
      };

      expect(response.status).toBe(503);
      expect(body.status).toBe('unhealthy');
      expect(body.checks.postgres.status).toBe('unhealthy');
    } finally {
      await handle.close();
    }
  });

  it('rejects startup when the configured health port is already occupied', async () => {
    const first = await healthServer.startHealthServer(
      {
        readiness: async () => ({
          status: 'ok',
          service: 'sentris-worker',
          timestamp: new Date().toISOString(),
          checks: {},
        }),
      } as never,
      { port: 0 },
    );

    try {
      await expect(
        healthServer.startHealthServer(
          {
            readiness: async () => ({
              status: 'ok',
              service: 'sentris-worker',
              timestamp: new Date().toISOString(),
              checks: {},
            }),
          } as never,
          { port: first.port },
        ),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await first.close();
    }
  });
});

describe('readiness evaluation', () => {
  it('runs independent checks in parallel and caches the result inside the TTL', async () => {
    const createEvaluator = (
      healthServer as unknown as {
        createCachedReadinessEvaluator?: (
          checks: Record<string, () => Promise<{ status: 'ok' }>>,
          options: { timeoutMs: number; cacheTtlMs: number },
        ) => () => Promise<unknown>;
      }
    ).createCachedReadinessEvaluator;
    const started: string[] = [];
    let releaseChecks: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseChecks = resolve;
    });
    const evaluator = createEvaluator?.(
      {
        temporal: async () => {
          started.push('temporal');
          await blocked;
          return { status: 'ok' };
        },
        postgres: async () => {
          started.push('postgres');
          await blocked;
          return { status: 'ok' };
        },
      },
      { timeoutMs: 100, cacheTtlMs: 5_000 },
    );

    const firstEvaluation = evaluator?.();
    await Promise.resolve();
    expect(started).toEqual(['temporal', 'postgres']);
    releaseChecks?.();
    const first = await firstEvaluation;
    const second = await evaluator?.();

    expect(first).toBe(second);
    expect(started).toEqual(['temporal', 'postgres']);
  });

  it('marks a timed-out dependency unhealthy instead of hanging readiness', async () => {
    const createEvaluator = (
      healthServer as unknown as {
        createCachedReadinessEvaluator?: (
          checks: Record<string, () => Promise<{ status: 'ok' }>>,
          options: { timeoutMs: number; cacheTtlMs: number },
        ) => () => Promise<{
          status: string;
          checks: Record<string, { status: string; message?: string }>;
        }>;
      }
    ).createCachedReadinessEvaluator;
    const evaluator = createEvaluator?.(
      {
        docker: () => new Promise(() => undefined),
      },
      { timeoutMs: 10, cacheTtlMs: 0 },
    );

    const response = await evaluator?.();

    expect(response?.status).toBe('unhealthy');
    expect(response?.checks.docker.status).toBe('unhealthy');
    expect(response?.checks.docker.message).toContain('10ms');
  });

  it('aborts and retains a timed-out dependency operation so repeated probes stay single-flight', async () => {
    const createEvaluator = healthServer.createCachedReadinessEvaluator;
    let underlyingCalls = 0;
    let dependencySignal: AbortSignal | undefined;
    const evaluator = createEvaluator(
      {
        docker: (signal) => {
          underlyingCalls += 1;
          dependencySignal = signal;
          return new Promise(() => undefined);
        },
      },
      { timeoutMs: 5, cacheTtlMs: 0 },
    );

    const first = await evaluator();
    const second = await evaluator();

    expect(first.checks.docker.status).toBe('unhealthy');
    expect(second.checks.docker.status).toBe('unhealthy');
    expect(underlyingCalls).toBe(1);
    expect(dependencySignal?.aborted).toBe(true);
  });
});
