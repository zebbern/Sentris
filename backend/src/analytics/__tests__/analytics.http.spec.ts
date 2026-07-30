import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import request from 'supertest';

import { AuditLogService } from '../../audit/audit-log.service';
import { AnalyticsController } from '../analytics.controller';
import { OpenSearchTenantService } from '../opensearch-tenant.service';
import { OrganizationSettingsService } from '../organization-settings.service';
import { SecurityAnalyticsService } from '../security-analytics.service';

describe('Analytics HTTP contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: SecurityAnalyticsService,
          useValue: { query: async () => ({ total: 0, hits: [] }) },
        },
        {
          provide: OrganizationSettingsService,
          useValue: {},
        },
        {
          provide: OpenSearchTenantService,
          useValue: {
            isSecurityEnabled: () => false,
            ensureTenantExists: async () => true,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'INTERNAL_SERVICE_TOKEN' ? 'analytics-http-test-token' : undefined,
          },
        },
        {
          provide: AuditLogService,
          useValue: {},
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  }, 30_000);

  it('returns HTTP 200 for idempotent tenant ensure success', async () => {
    const response = await request(app.getHttpServer())
      .post('/analytics/ensure-tenant')
      .set('x-internal-token', 'analytics-http-test-token')
      .send({ organizationId: 'http-contract-org' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      securityEnabled: false,
    });
  });
});
