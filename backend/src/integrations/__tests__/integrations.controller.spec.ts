import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { IntegrationsController } from '../integrations.controller';
import { CompleteOAuthSchema, StartOAuthSchema } from '../integrations.dto';
import type { IntegrationsService } from '../integrations.service';
import type { AuthContext } from '../../auth/types';

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

function createServiceMock() {
  return {
    listConnections: mock(() => Promise.resolve([connection])),
    startOAuthSession: mock(() =>
      Promise.resolve({
        provider: 'github',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        state: 'state-1',
        expiresIn: 300,
      }),
    ),
    completeOAuthSession: mock(() => Promise.resolve(connection)),
    refreshConnection: mock(() => Promise.resolve(connection)),
    disconnect: mock(() => Promise.resolve()),
    getConnectionToken: mock(() =>
      Promise.resolve({
        provider: 'github',
        userId: auth.userId!,
        accessToken: 'secret-token',
        tokenType: 'Bearer',
        scopes: ['repo'],
        expiresAt: null,
      }),
    ),
  };
}

describe('IntegrationsController ownership boundary', () => {
  let controller: IntegrationsController;
  let service: ReturnType<typeof createServiceMock>;

  beforeEach(() => {
    service = createServiceMock();
    controller = new IntegrationsController(
      service as unknown as IntegrationsService,
      {
        get: mock((key: string) =>
          key === 'integrations'
            ? { internalServiceToken: 'internal-secret' }
            : { trustProfile: 'hardened' },
        ),
      } as any,
    );
  });

  it('derives connection-list ownership from authenticated context', async () => {
    await controller.listConnections(auth);

    expect(service.listConnections).toHaveBeenCalledWith('authenticated-user', 'org-1');
  });

  it('derives OAuth start ownership from authenticated context', async () => {
    await controller.startOAuth('github', auth, {
      userId: 'foreign-user',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['repo'],
    } as any);

    expect(service.startOAuthSession).toHaveBeenCalledWith('github', {
      userId: 'authenticated-user',
      organizationId: 'org-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['repo'],
      auth,
    });
  });

  it('derives OAuth exchange ownership from authenticated context', async () => {
    await controller.completeOAuth('github', auth, {
      userId: 'foreign-user',
      code: 'authorization-code',
      state: 'state-1',
      redirectUri: 'https://app.example.com/callback',
    } as any);

    expect(service.completeOAuthSession).toHaveBeenCalledWith('github', {
      userId: 'authenticated-user',
      organizationId: 'org-1',
      code: 'authorization-code',
      state: 'state-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: undefined,
      auth,
    });
  });

  it('derives refresh ownership from authenticated context', async () => {
    await controller.refreshConnection('connection-1', auth);

    expect(service.refreshConnection).toHaveBeenCalledWith(
      'connection-1',
      'authenticated-user',
      'org-1',
      auth,
    );
  });

  it('derives disconnect ownership from authenticated context', async () => {
    await controller.disconnectConnection('connection-1', auth);

    expect(service.disconnect).toHaveBeenCalledWith(
      'connection-1',
      'authenticated-user',
      'org-1',
      auth,
    );
  });

  it('binds internal token issuance to the authoritative organization and workflow run', async () => {
    await controller.issueConnectionToken(
      'connection-1',
      'internal-secret',
      'org-1',
      'run-1',
      auth,
    );

    expect(service.getConnectionToken).toHaveBeenCalledWith('connection-1', 'org-1', auth, 'run-1');
  });

  it('rejects a missing run before consulting the connection service', async () => {
    await expect(
      controller.issueConnectionToken('connection-1', 'internal-secret', 'org-1', undefined, auth),
    ).rejects.toThrow(NotFoundException);
    expect(service.getConnectionToken).not.toHaveBeenCalled();
  });

  it('rejects a caller organization that differs from internal auth context', async () => {
    await expect(
      controller.issueConnectionToken(
        'connection-1',
        'internal-secret',
        'org-foreign',
        'run-1',
        auth,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.getConnectionToken).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated connection access before consulting payload identity', async () => {
    await expect(
      controller.startOAuth('github', null, {
        userId: 'foreign-user',
        redirectUri: 'https://app.example.com/callback',
      } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects client-supplied integration user identifiers', () => {
    expect(
      StartOAuthSchema.safeParse({
        userId: 'foreign-user',
        redirectUri: 'https://app.example.com/callback',
      }).success,
    ).toBe(false);
    expect(
      CompleteOAuthSchema.safeParse({
        userId: 'foreign-user',
        code: 'authorization-code',
        state: 'state-1',
        redirectUri: 'https://app.example.com/callback',
      }).success,
    ).toBe(false);
  });
});
