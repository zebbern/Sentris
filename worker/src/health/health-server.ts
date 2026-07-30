/**
 * Lightweight HTTP health server for the Temporal worker process.
 *
 * Uses only `node:http` so liveness remains independent of application
 * frameworks and infrastructure clients.
 *
 * Endpoints:
 *   GET /health       — process-only liveness
 *   GET /health/ready — cached, dependency-aware readiness
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

const DEFAULT_HEALTH_PORT = 9100;
const DEFAULT_CHECK_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 5_000;
const SERVICE_NAME = 'sentris-worker';

export type CheckStatus = 'ok' | 'unhealthy' | 'not_configured';

export interface CheckResult {
  status: CheckStatus;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'unhealthy';
  service: string;
  timestamp: string;
  checks: Record<string, CheckResult>;
}

export type ReadinessCheck = (signal?: AbortSignal) => Promise<CheckResult>;
export type ReadinessEvaluator = () => Promise<HealthResponse>;

export interface HealthServerDeps {
  readiness: ReadinessEvaluator;
}

export interface HealthServerOptions {
  port?: number;
}

export interface HealthServerHandle {
  close: () => Promise<void>;
  port: number;
}

export interface ReadinessEvaluatorOptions {
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PendingReadinessCheck {
  controller: AbortController;
  promise: Promise<CheckResult>;
}

async function runCheckWithTimeout(
  name: string,
  pending: PendingReadinessCheck,
  timeoutMs: number,
): Promise<CheckResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<CheckResult>((resolve) => {
    timeout = setTimeout(() => {
      pending.controller.abort(new Error(`${name} readiness check timed out after ${timeoutMs}ms`));
      resolve({
        status: 'unhealthy',
        message: `${name} readiness check timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([pending.promise, timeoutResult]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createCachedReadinessEvaluator(
  checks: Record<string, ReadinessCheck>,
  options: ReadinessEvaluatorOptions = {},
): ReadinessEvaluator {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { expiresAt: number; response: HealthResponse } | undefined;
  let inFlight: Promise<HealthResponse> | undefined;
  const pendingChecks = new Map<string, PendingReadinessCheck>();

  const getPendingCheck = (name: string, check: ReadinessCheck): PendingReadinessCheck => {
    const existing = pendingChecks.get(name);
    if (existing) return existing;

    const controller = new AbortController();
    let operation: Promise<CheckResult>;
    try {
      operation = Promise.resolve(check(controller.signal));
    } catch (error: unknown) {
      operation = Promise.reject(error);
    }
    const pending: PendingReadinessCheck = {
      controller,
      promise: operation.catch(
        (error: unknown): CheckResult => ({
          status: 'unhealthy',
          message: errorMessage(error),
        }),
      ),
    };
    pendingChecks.set(name, pending);
    void operation
      .finally(() => {
        if (pendingChecks.get(name) === pending) pendingChecks.delete(name);
      })
      .catch(() => undefined);
    return pending;
  };

  return async () => {
    const currentTime = now();
    if (cached && currentTime < cached.expiresAt) {
      return cached.response;
    }
    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      const entries = await Promise.all(
        Object.entries(checks).map(async ([name, check]) => {
          const result = await runCheckWithTimeout(name, getPendingCheck(name, check), timeoutMs);
          return [name, result] as const;
        }),
      );
      const results = Object.fromEntries(entries);
      const healthy = Object.values(results).every(
        ({ status }) => status === 'ok' || status === 'not_configured',
      );
      const response: HealthResponse = {
        status: healthy ? 'ok' : 'unhealthy',
        service: SERVICE_NAME,
        timestamp: new Date(now()).toISOString(),
        checks: results,
      };
      cached = { expiresAt: now() + cacheTtlMs, response };
      return response;
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function handleRequest(deps: HealthServerDeps) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: SERVICE_NAME,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.url === '/health/ready') {
      try {
        const health = await deps.readiness();
        sendJson(res, health.status === 'ok' ? 200 : 503, health);
      } catch (error: unknown) {
        sendJson(res, 503, {
          status: 'unhealthy',
          service: SERVICE_NAME,
          timestamp: new Date().toISOString(),
          error: errorMessage(error),
        });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

function resolvePort(options: HealthServerOptions): number {
  const rawPort = options.port ?? process.env.WORKER_HEALTH_PORT ?? DEFAULT_HEALTH_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid worker health port: ${rawPort}`);
  }
  return port;
}

export function startHealthServer(
  deps: HealthServerDeps,
  options: HealthServerOptions = {},
): Promise<HealthServerHandle> {
  const requestedPort = resolvePort(options);

  return new Promise<HealthServerHandle>((resolve, reject) => {
    const server: Server = createServer(handleRequest(deps));

    server.once('error', reject);
    server.listen(requestedPort, () => {
      server.removeListener('error', reject);
      server.on('error', (error) => {
        console.error('Worker health server error', error);
      });
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : requestedPort;
      console.log(`✅ Health server listening on port ${port}`);
      resolve({
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((error) => (error ? rej(error) : res()));
          }),
        port,
      });
    });
  });
}
