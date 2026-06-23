import { describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { HealthCheckResult } from '@nestjs/terminus';

import { HealthController } from '../health.controller';
import { HealthProbeService } from '../health-probe.service';
import { registerRootHealthRoutes } from '../health-routes';

type RouteHandler = (request: unknown, response: FakeResponse) => unknown;

class FakeResponse {
  statusCode: number | null = null;
  body: unknown = null;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): unknown {
    this.body = body;
    return body;
  }
}

function createProbeService() {
  const liveness = {
    status: 'ok',
    service: 'sentris-backend',
    timestamp: '2026-06-23T00:00:00.000Z',
  };
  const readiness: HealthCheckResult = {
    status: 'ok',
    info: {
      postgres: { status: 'up' },
      redis: { status: 'up' },
      temporal: { status: 'up' },
    },
    error: {},
    details: {
      postgres: { status: 'up' },
      redis: { status: 'up' },
      temporal: { status: 'up' },
    },
  };

  return {
    liveness,
    readiness,
    probes: {
      liveness: () => liveness,
      readiness: async () => readiness,
    },
  };
}

function createAppWithRootRouteRegistry(
  probes: Pick<HealthProbeService, 'liveness' | 'readiness'>,
) {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get(token: unknown) {
      if (token === HealthProbeService) return probes;
      throw new Error('Unexpected provider lookup');
    },
    getHttpAdapter() {
      return {
        getInstance() {
          return {
            get(path: string, handler: RouteHandler) {
              routes.set(path, handler);
            },
          };
        },
      };
    },
  } as unknown as INestApplication;

  return { app, routes };
}

async function invokeRoute(routes: Map<string, RouteHandler>, path: string): Promise<FakeResponse> {
  const handler = routes.get(path);
  if (!handler) throw new Error(`Route not registered: ${path}`);

  const response = new FakeResponse();
  await handler({}, response);
  return response;
}

describe('health routes', () => {
  it('registers root health probes outside the API prefix', async () => {
    const { probes, liveness, readiness } = createProbeService();
    const { app, routes } = createAppWithRootRouteRegistry(probes);

    registerRootHealthRoutes(app);

    await expect(invokeRoute(routes, '/health')).resolves.toMatchObject({
      statusCode: 200,
      body: liveness,
    });
    await expect(invokeRoute(routes, '/health/ready')).resolves.toMatchObject({
      statusCode: 200,
      body: readiness,
    });
  });

  it('exposes controller probes for the API-prefixed health routes', async () => {
    const { probes, liveness, readiness } = createProbeService();
    const controller = new HealthController(probes as unknown as HealthProbeService);

    expect(controller.liveness()).toEqual(liveness);
    await expect(controller.readiness()).resolves.toEqual(readiness);
  });
});
