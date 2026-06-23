import { afterEach, describe, it } from 'bun:test';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { HealthModule } from '../health.module';
import { registerRootHealthRoutes } from '../health-routes';
import {
  PostgresHealthIndicator,
  RedisHealthIndicator,
  TemporalHealthIndicator,
} from '../indicators';

describe('health routes', () => {
  let app: INestApplication | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('serves health probes at root and under the API prefix', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(PostgresHealthIndicator)
      .useValue({ isHealthy: () => ({ postgres: { status: 'up' } }) })
      .overrideProvider(RedisHealthIndicator)
      .useValue({ isHealthy: () => ({ redis: { status: 'up' } }) })
      .overrideProvider(TemporalHealthIndicator)
      .useValue({ isHealthy: () => ({ temporal: { status: 'up' } }) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    registerRootHealthRoutes(app);
    await app.init();

    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });
});
