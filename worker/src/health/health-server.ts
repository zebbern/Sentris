/**
 * Lightweight HTTP health server for the Temporal worker process.
 *
 * Uses only `node:http` — no framework dependencies.
 *
 * Endpoints:
 *   GET /health       — liveness + readiness checks (200 if all pass, 503 otherwise)
 *   GET /health/ready — alias for /health (kept for compatibility with k8s-style probes)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { access, constants } from 'node:fs/promises';
import { platform } from 'node:os';
import type { NativeConnection } from '@temporalio/worker';
import type Redis from 'ioredis';

const DEFAULT_HEALTH_PORT = 9100;
const SERVICE_NAME = 'sentris-worker';

type CheckStatus = 'ok' | 'unhealthy' | 'not_configured';

interface CheckResult {
  status: CheckStatus;
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'unhealthy';
  service: string;
  timestamp: string;
  checks: Record<string, CheckResult>;
}

export interface HealthServerDeps {
  /** Temporal NativeConnection — used to verify connectivity. */
  temporalConnection: NativeConnection;
  /** Optional terminal Redis instance. */
  terminalRedis?: Redis;
}

export interface HealthServerHandle {
  /** Close the health HTTP server gracefully. */
  close: () => Promise<void>;
  /** The port the server is listening on. */
  port: number;
}

// ── Individual health checks ────────────────────────────────────────────

async function checkTemporal(connection: NativeConnection): Promise<CheckResult> {
  try {
    // `describeNamespace` is a lightweight gRPC call that proves the connection
    // is alive without side-effects. Any successful response means connectivity
    // is fine.
    await connection.workflowService.getSystemInfo({});
    return { status: 'ok' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unhealthy', message };
  }
}

async function checkDocker(): Promise<CheckResult> {
  const os = platform();
  const socketPath = os === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';

  try {
    await access(socketPath, constants.R_OK);
    return { status: 'ok' };
  } catch {
    // On Windows dev environments the Docker socket may not exist — treat as
    // non-critical so the health check doesn't block development.
    if (os === 'win32') {
      return { status: 'ok', message: 'Docker socket not found (Windows dev — skipped)' };
    }
    return { status: 'unhealthy', message: `Docker socket not accessible at ${socketPath}` };
  }
}

async function checkRedis(redis: Redis | undefined): Promise<CheckResult> {
  if (!redis) {
    return { status: 'not_configured' };
  }
  try {
    const pong = await redis.ping();
    if (pong === 'PONG') {
      return { status: 'ok' };
    }
    return { status: 'unhealthy', message: `Unexpected PING response: ${pong}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unhealthy', message };
  }
}

// ── Health endpoint handler ─────────────────────────────────────────────

async function buildHealthResponse(deps: HealthServerDeps): Promise<HealthResponse> {
  const [temporal, docker, redis] = await Promise.all([
    checkTemporal(deps.temporalConnection),
    checkDocker(),
    checkRedis(deps.terminalRedis),
  ]);

  const checks: Record<string, CheckResult> = { temporal, docker, redis };

  const isHealthy = Object.values(checks).every(
    (c) => c.status === 'ok' || c.status === 'not_configured',
  );

  return {
    status: isHealthy ? 'ok' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    checks,
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

    if (req.url === '/health' || req.url === '/health/ready') {
      try {
        const health = await buildHealthResponse(deps);
        sendJson(res, health.status === 'ok' ? 200 : 503, health);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 503, {
          status: 'unhealthy',
          service: SERVICE_NAME,
          timestamp: new Date().toISOString(),
          error: message,
        });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Start the health HTTP server.
 *
 * Port resolution order:
 *   1. `WORKER_HEALTH_PORT` env var (explicit override)
 *   2. `9100` (default)
 */
export function startHealthServer(deps: HealthServerDeps): Promise<HealthServerHandle> {
  const port = Number(process.env.WORKER_HEALTH_PORT) || DEFAULT_HEALTH_PORT;

  return new Promise<HealthServerHandle>((resolve, reject) => {
    const server: Server = createServer(handleRequest(deps));

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️ Health server port ${port} is already in use — health endpoint disabled`);
        // Resolve with a no-op handle so the worker isn't blocked by port conflicts.
        resolve({ close: async () => {}, port });
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`✅ Health server listening on port ${port}`);
      resolve({
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
        port,
      });
    });
  });
}
