import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import request from 'supertest';

import { ApiKeysController } from '../api-keys.controller';
import { ApiKeysService } from '../api-keys.service';
import { AuthGuard, type RequestWithAuthContext } from '../../auth/auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import type { AuthContext } from '../../auth/types';

const auth: AuthContext = {
  userId: 'authenticated-user',
  organizationId: 'authenticated-org',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

describe('API keys HTTP ownership boundary', () => {
  let app: INestApplication;
  const create = mock(() => {
    throw new Error('API-key service must not receive a forged organization');
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [{ provide: ApiKeysService, useValue: { create } }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest<RequestWithAuthContext>().auth = auth;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  test('POST create rejects organizationId before invoking the service', async () => {
    const response = await request(app.getHttpServer())
      .post('/api-keys')
      .send({
        name: 'Forged key',
        organizationId: 'foreign-org',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: false },
          audit: { read: true },
        },
      });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
