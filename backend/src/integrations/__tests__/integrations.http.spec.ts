import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import type { RequestWithAuthContext } from '../../auth/auth.guard';
import type { AuthContext } from '../../auth/types';
import { IntegrationsController } from '../integrations.controller';
import { IntegrationsService } from '../integrations.service';

const auth: AuthContext = {
  userId: 'authenticated-user',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const connection = {
  id: 'connection-1',
  provider: 'github',
  providerName: 'GitHub',
  userId: auth.userId!,
  scopes: ['repo'],
  tokenType: 'Bearer',
  expiresAt: null,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  status: 'active' as const,
  supportsRefresh: true,
  hasRefreshToken: true,
  metadata: {},
};

describe('Integrations HTTP ownership boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const service = {
      listConnections: mock(async () => []),
      startOAuthSession: mock(
        async (_provider: string, input: { userId: string; redirectUri: string }) => {
          if (input.userId !== auth.userId) {
            throw new Error('Controller did not derive OAuth owner from auth context');
          }
          return {
            provider: 'github',
            authorizationUrl: 'https://github.com/login/oauth/authorize',
            state: 'state-1',
            expiresIn: 300,
          };
        },
      ),
      completeOAuthSession: mock(async (_provider: string, input: { userId: string }) => {
        if (input.userId !== auth.userId) {
          throw new Error('Controller did not derive OAuth owner from auth context');
        }
        return connection;
      }),
      refreshConnection: mock(async (_id: string, userId: string) => {
        if (userId !== auth.userId) {
          throw new Error('Controller did not derive refresh owner from auth context');
        }
        return connection;
      }),
      disconnect: mock(async (_id: string, userId: string) => {
        if (userId !== auth.userId) {
          throw new Error('Controller did not derive disconnect owner from auth context');
        }
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: IntegrationsService, useValue: service },
        { provide: ConfigService, useValue: { get: mock() } },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as RequestWithAuthContext).auth = auth;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  test('POST start rejects a client-supplied userId through the real validation pipe', async () => {
    const response = await request(app.getHttpServer()).post('/integrations/github/start').send({
      userId: 'foreign-user',
      redirectUri: 'https://app.example.com/callback',
    });

    expect(response.status).toBe(400);
  });

  test('POST exchange rejects a client-supplied userId through the real validation pipe', async () => {
    const response = await request(app.getHttpServer()).post('/integrations/github/exchange').send({
      userId: 'foreign-user',
      code: 'authorization-code',
      state: 'state-1',
      redirectUri: 'https://app.example.com/callback',
    });

    expect(response.status).toBe(400);
  });

  test('POST start accepts an auth-derived request without a userId body field', async () => {
    const response = await request(app.getHttpServer())
      .post('/integrations/github/start')
      .send({ redirectUri: 'https://app.example.com/callback' });

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('state-1');
  });

  test('POST exchange accepts an auth-derived request without a userId body field', async () => {
    const response = await request(app.getHttpServer()).post('/integrations/github/exchange').send({
      code: 'authorization-code',
      state: 'state-1',
      redirectUri: 'https://app.example.com/callback',
    });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('connection-1');
  });

  test('POST refresh derives ownership without an ownership body', async () => {
    const response = await request(app.getHttpServer()).post(
      '/integrations/connections/connection-1/refresh',
    );

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('connection-1');
  });

  test('GET connections rejects a forged ownership query field', async () => {
    const response = await request(app.getHttpServer())
      .get('/integrations/connections')
      .query({ userId: 'foreign-user' });

    expect(response.status).toBe(400);
  });

  test('POST refresh rejects a forged ownership body field', async () => {
    const response = await request(app.getHttpServer())
      .post('/integrations/connections/connection-1/refresh')
      .send({ userId: 'foreign-user' });

    expect(response.status).toBe(400);
  });

  test('DELETE disconnect derives ownership without an ownership body', async () => {
    const response = await request(app.getHttpServer()).delete(
      '/integrations/connections/connection-1',
    );

    expect(response.status).toBe(200);
  });

  test('DELETE disconnect rejects a forged ownership body field', async () => {
    const response = await request(app.getHttpServer())
      .delete('/integrations/connections/connection-1')
      .send({ userId: 'foreign-user' });

    expect(response.status).toBe(400);
  });
});
