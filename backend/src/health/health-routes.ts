import type { INestApplication } from '@nestjs/common';

import { HealthProbeService } from './health-probe.service';

interface ExpressResponse {
  status(code: number): ExpressResponse;
  json(body: unknown): unknown;
}

interface ExpressLike {
  get(path: string, handler: (request: unknown, response: ExpressResponse) => void): void;
}

function getErrorStatus(error: unknown): number {
  if (
    error &&
    typeof error === 'object' &&
    'getStatus' in error &&
    typeof error.getStatus === 'function'
  ) {
    const status = error.getStatus();
    if (typeof status === 'number') return status;
  }

  return 503;
}

function getErrorBody(error: unknown): unknown {
  if (
    error &&
    typeof error === 'object' &&
    'getResponse' in error &&
    typeof error.getResponse === 'function'
  ) {
    return error.getResponse();
  }

  return {
    status: 'error',
    message: error instanceof Error ? error.message : 'Health check failed',
  };
}

export function registerRootHealthRoutes(app: INestApplication): void {
  const probes = app.get(HealthProbeService);
  const server = app.getHttpAdapter().getInstance() as ExpressLike | undefined;
  if (!server?.get) return;

  server.get('/health', (_request, response) => {
    response.status(200).json(probes.liveness());
  });

  server.get('/health/ready', async (_request, response) => {
    try {
      response.status(200).json(await probes.readiness());
    } catch (error) {
      response.status(getErrorStatus(error)).json(getErrorBody(error));
    }
  });
}
