import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, afterEach } from 'bun:test';

import { IntegrationsService } from '../integrations.service';
import type { IntegrationsRepository } from '../integrations.repository';
import type { TokenEncryptionService } from '../token.encryption';
import type { SecretEncryptionMaterial } from '@sentris/shared';
import type {
  IntegrationTokenRecord,
  IntegrationOAuthStateRecord,
  IntegrationProviderConfigRecord,
} from '../../database/schema';
import type { AuthContext } from '../../auth/types';

// ── Constants ───────────────────────────────────────────────────────
const now = new Date('2024-06-01T00:00:00.000Z');
const auth: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'test',
};

const MOCK_ENCRYPTED: SecretEncryptionMaterial = {
  ciphertext: 'enc-ct',
  iv: 'enc-iv',
  authTag: 'enc-tag',
  keyId: 'enc-key',
};

// ── Mock Factories ──────────────────────────────────────────────────

function makeTokenRecord(overrides: Partial<IntegrationTokenRecord> = {}): IntegrationTokenRecord {
  return {
    id: 'conn-1',
    organizationId: null,
    userId: 'user-1',
    provider: 'github',
    scopes: ['repo', 'read:user'],
    accessToken: MOCK_ENCRYPTED,
    refreshToken: MOCK_ENCRYPTED,
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 3_600_000),
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeOAuthStateRecord(
  overrides: Partial<IntegrationOAuthStateRecord> = {},
): IntegrationOAuthStateRecord {
  return {
    id: 'state-id-1',
    state: 'test-state-abc',
    organizationId: null,
    userId: 'user-1',
    provider: 'github',
    codeVerifier: null,
    createdAt: now,
    ...overrides,
  };
}

function makeProviderConfigRecord(
  overrides: Partial<IntegrationProviderConfigRecord> = {},
): IntegrationProviderConfigRecord {
  return {
    organizationId: null,
    provider: 'github',
    clientId: 'override-client-id',
    clientSecret: MOCK_ENCRYPTED as any,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Mock integration-providers module ───────────────────────────────
vi.mock('../integration-providers', () => ({
  loadIntegrationProviders: vi.fn().mockReturnValue({
    github: {
      id: 'github',
      name: 'GitHub',
      description: 'GitHub integration',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      defaultScopes: ['repo', 'read:user'],
      scopeSeparator: ' ',
      supportsRefresh: true,
      usesPkce: false,
      tokenRequestEncoding: 'json',
      tokenAuthMethod: 'client_secret_post',
      extraAuthorizeParams: { allow_signup: 'false' },
      extraTokenParams: undefined,
      clientId: 'env-client-id',
      clientSecret: 'env-client-secret',
    },
    zoom: {
      id: 'zoom',
      name: 'Zoom',
      description: 'Zoom integration',
      authorizeUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      defaultScopes: ['user:read:admin'],
      scopeSeparator: ' ',
      supportsRefresh: true,
      usesPkce: true,
      tokenRequestEncoding: 'form',
      tokenAuthMethod: 'client_secret_basic',
      extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
      extraTokenParams: undefined,
      clientId: 'zoom-client-id',
      clientSecret: 'zoom-client-secret',
    },
  }),
  generateState: vi.fn().mockReturnValue('mock-state-123'),
  summarizeProvider: vi.fn().mockImplementation((config: any) => ({
    id: config.id,
    name: config.name,
    description: config.description,
    defaultScopes: config.defaultScopes,
    supportsRefresh: config.supportsRefresh,
    isConfigured: Boolean(config.clientId && config.clientSecret),
  })),
}));

// ── Global fetch mock ───────────────────────────────────────────────
const originalFetch = globalThis.fetch;

// ── Shared mock setup ───────────────────────────────────────────────
function createMocks() {
  const repo: Record<string, ReturnType<typeof vi.fn>> = {
    listConnections: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    findByProvider: vi.fn(),
    runBelongsToOrganization: vi.fn().mockResolvedValue(true),
    upsertConnection: vi.fn().mockImplementation(async (input: any) => ({
      id: 'conn-1',
      organizationId: input.organizationId ?? null,
      userId: input.userId,
      provider: input.provider,
      scopes: input.scopes,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenType: input.tokenType,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })),
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    createOAuthState: vi.fn().mockResolvedValue(makeOAuthStateRecord()),
    consumeOAuthState: vi.fn(),
    upsertProviderConfig: vi.fn().mockImplementation(async (input: any) =>
      makeProviderConfigRecord({
        provider: input.provider,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
    ),
    findProviderConfig: vi.fn(),
    listProviderConfigs: vi.fn().mockResolvedValue([]),
    deleteProviderConfig: vi.fn().mockResolvedValue(undefined),
  };

  const encryption: Record<string, ReturnType<typeof vi.fn>> = {
    encrypt: vi.fn().mockResolvedValue(MOCK_ENCRYPTED),
    decrypt: vi.fn().mockResolvedValue('decrypted-value'),
  };

  const configSvc: Record<string, ReturnType<typeof vi.fn>> = {
    get: vi.fn().mockReturnValue({
      github: {
        clientId: 'env-client-id',
        clientSecret: 'env-client-secret',
        scopes: 'repo,read:user',
      },
      zoom: {
        clientId: 'zoom-client-id',
        clientSecret: 'zoom-client-secret',
        scopes: 'user:read:admin',
      },
      masterKey: null,
    }),
  };

  const auditLogService: Record<string, ReturnType<typeof vi.fn>> = {
    recordDurable: vi.fn().mockResolvedValue(undefined),
    recordDurableWithExecutor: vi.fn().mockResolvedValue(undefined),
  };

  return { repo, encryption, configSvc, auditLogService };
}

function mockFetchSuccess(payload: Record<string, any>) {
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  });
}

async function captureHttpException(operation: () => Promise<unknown>): Promise<HttpException> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected operation to throw an HttpException');
}

function mockFetchError(status: number, payload: Record<string, any>) {
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  });
}

// ── Tests ───────────────────────────────────────────────────────────
describe('IntegrationsService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let encryption: Record<string, ReturnType<typeof vi.fn>>;
  let configSvc: Record<string, ReturnType<typeof vi.fn>>;
  let auditLogService: Record<string, ReturnType<typeof vi.fn>>;
  let service: IntegrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMocks();
    repo = mocks.repo;
    encryption = mocks.encryption;
    configSvc = mocks.configSvc;
    auditLogService = mocks.auditLogService;

    service = new IntegrationsService(
      repo as unknown as IntegrationsRepository,
      encryption as unknown as TokenEncryptionService,
      configSvc as any,
      null,
      auditLogService as any,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── onModuleInit ────────────────────────────────────────────────
  describe('onModuleInit', () => {
    it('loads provider overrides from the database', async () => {
      repo.listProviderConfigs.mockResolvedValue([makeProviderConfigRecord()]);
      await service.onModuleInit();
      expect(repo.listProviderConfigs).toHaveBeenCalledTimes(1);
    });
  });

  // ── listProviders ───────────────────────────────────────────────
  describe('listProviders', () => {
    it('returns summarized providers', () => {
      const providers = service.listProviders();
      expect(providers).toHaveLength(2);
    });
  });

  // ── getProviderConfiguration ────────────────────────────────────
  describe('getProviderConfiguration', () => {
    it('returns environment config when no override exists', async () => {
      const result = await service.getProviderConfiguration('github');
      expect(result.provider).toBe('github');
      expect(result.clientId).toBe('env-client-id');
      expect(result.configuredBy).toBe('environment');
      expect(result.hasClientSecret).toBe(true);
      expect(result.updatedAt).toBeNull();
    });

    it('returns user override config when one exists', async () => {
      repo.listProviderConfigs.mockResolvedValue([makeProviderConfigRecord()]);
      await service.onModuleInit();
      const result = await service.getProviderConfiguration('github');
      expect(result.clientId).toBe('override-client-id');
      expect(result.configuredBy).toBe('user');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException for an unknown provider', async () => {
      expect(() => service.getProviderConfiguration('unknown')).toThrow(NotFoundException);
    });
  });

  // ── upsertProviderConfiguration ─────────────────────────────────
  describe('upsertProviderConfiguration', () => {
    it('creates config with clientId and clientSecret', async () => {
      await service.upsertProviderConfiguration('github', {
        clientId: 'new-id',
        clientSecret: 'new-secret',
      });
      expect(encryption.encrypt).toHaveBeenCalledWith('new-secret');
      expect(repo.upsertProviderConfig).toHaveBeenCalledWith(
        {
          organizationId: null,
          provider: 'github',
          clientId: 'new-id',
          clientSecret: MOCK_ENCRYPTED,
        },
        expect.any(Function),
      );
    });

    it('reuses previous secret when none provided', async () => {
      repo.listProviderConfigs.mockResolvedValue([makeProviderConfigRecord()]);
      await service.onModuleInit();
      await service.upsertProviderConfiguration('github', { clientId: 'updated-id' });
      expect(encryption.encrypt).not.toHaveBeenCalled();
      expect(repo.upsertProviderConfig).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'updated-id', clientSecret: MOCK_ENCRYPTED }),
        expect.any(Function),
      );
    });

    it('throws when clientId is empty', async () => {
      await expect(
        service.upsertProviderConfiguration('github', { clientId: '  ', clientSecret: 's' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when no secret and no previous override', async () => {
      await expect(
        service.upsertProviderConfiguration('github', { clientId: 'ci' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── deleteProviderConfiguration ─────────────────────────────────
  describe('deleteProviderConfiguration', () => {
    it('removes the config and clears in-memory override', async () => {
      repo.listProviderConfigs.mockResolvedValue([makeProviderConfigRecord()]);
      await service.onModuleInit();
      await service.deleteProviderConfiguration('github');
      expect(repo.deleteProviderConfig).toHaveBeenCalledWith(null, 'github', expect.any(Function));
      const result = await service.getProviderConfiguration('github');
      expect(result.configuredBy).toBe('environment');
    });

    it('is idempotent for non-existent config', async () => {
      await service.deleteProviderConfiguration('github');
      expect(repo.deleteProviderConfig).toHaveBeenCalledWith(null, 'github', expect.any(Function));
    });
  });

  // ── listConnections ─────────────────────────────────────────────
  describe('listConnections', () => {
    it('returns mapped connections for a user', async () => {
      repo.listConnections.mockResolvedValue([makeTokenRecord()]);
      const connections = await service.listConnections('user-1');
      expect(connections).toHaveLength(1);
      expect(connections[0]).toMatchObject({
        id: 'conn-1',
        provider: 'github',
        providerName: 'GitHub',
        userId: 'user-1',
        status: 'active',
        supportsRefresh: true,
      });
    });

    it('marks expired connections', async () => {
      repo.listConnections.mockResolvedValue([
        makeTokenRecord({ expiresAt: new Date('2020-01-01T00:00:00Z') }),
      ]);
      const connections = await service.listConnections('user-1');
      expect(connections[0].status).toBe('expired');
    });
  });

  // ── startOAuthSession ───────────────────────────────────────────
  describe('startOAuthSession', () => {
    it('generates a valid OAuth authorization URL', async () => {
      const result = await service.startOAuthSession('github', {
        userId: 'user-1',
        redirectUri: 'https://app.test/callback',
        scopes: ['repo'],
      });
      expect(result.provider).toBe('github');
      expect(result.state).toBe('mock-state-123');
      expect(result.expiresIn).toBe(300);

      const url = new URL(result.authorizationUrl);
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('env-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/callback');
      expect(url.searchParams.get('scope')).toBe('repo');
      expect(url.searchParams.get('state')).toBe('mock-state-123');
      expect(url.searchParams.get('response_type')).toBe('code');
    });

    it('includes extra authorize params from provider config', async () => {
      const result = await service.startOAuthSession('github', {
        userId: 'user-1',
        redirectUri: 'https://app.test/callback',
      });
      const url = new URL(result.authorizationUrl);
      expect(url.searchParams.get('allow_signup')).toBe('false');
    });

    it('uses default scopes when none provided', async () => {
      const result = await service.startOAuthSession('github', {
        userId: 'user-1',
        redirectUri: 'https://app.test/callback',
      });
      const url = new URL(result.authorizationUrl);
      expect(url.searchParams.get('scope')).toBe('read:user repo');
    });

    it('includes PKCE parameters for providers that use it', async () => {
      const result = await service.startOAuthSession('zoom', {
        userId: 'user-1',
        redirectUri: 'https://app.test/callback',
      });
      const url = new URL(result.authorizationUrl);
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('stores OAuth state in the repository', async () => {
      await service.startOAuthSession('github', {
        userId: 'user-1',
        redirectUri: 'https://app.test/callback',
      });
      expect(repo.createOAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'mock-state-123',
          userId: 'user-1',
          provider: 'github',
        }),
        expect.any(Function),
      );
    });

    it('throws when provider is not configured for OAuth', async () => {
      const { loadIntegrationProviders } = await import('../integration-providers');
      const orig = (loadIntegrationProviders as any).mock.results[0].value;
      (loadIntegrationProviders as any).mockReturnValue({
        ...orig,
        nocreds: { ...orig.github, id: 'nocreds', clientId: null, clientSecret: null },
      });
      const svc2 = new IntegrationsService(
        repo as unknown as IntegrationsRepository,
        encryption as unknown as TokenEncryptionService,
        configSvc as any,
        null,
      );
      await expect(
        svc2.startOAuthSession('nocreds', { userId: 'u', redirectUri: 'https://x' }),
      ).rejects.toThrow(BadRequestException);
      (loadIntegrationProviders as any).mockReturnValue(orig);
    });
  });

  // ── completeOAuthSession ────────────────────────────────────────
  describe('completeOAuthSession', () => {
    const oauthInput = {
      userId: 'user-1',
      state: 'test-state-abc',
      code: 'auth-code-xyz',
      redirectUri: 'https://app.test/callback',
    };

    beforeEach(() => {
      mockFetchSuccess({
        access_token: 'ghp_access123',
        refresh_token: 'ghp_refresh456',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'repo read:user',
      });
      repo.consumeOAuthState.mockResolvedValue(makeOAuthStateRecord());
      repo.findByProvider.mockResolvedValue(undefined);
    });

    it('exchanges code for tokens, encrypts, and stores connection', async () => {
      const result = await service.completeOAuthSession('github', oauthInput);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(encryption.encrypt).toHaveBeenCalledWith('ghp_access123');
      expect(encryption.encrypt).toHaveBeenCalledWith('ghp_refresh456');
      expect(repo.upsertConnection).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('github');
      expect(result.userId).toBe('user-1');
    });

    it('redeems OAuth state using authenticated user and provider ownership', async () => {
      repo.consumeOAuthState.mockImplementation(
        async (state: string, userId: string, provider: string) =>
          state === oauthInput.state && userId === oauthInput.userId && provider === 'github'
            ? makeOAuthStateRecord()
            : undefined,
      );

      const result = await service.completeOAuthSession('github', oauthInput);

      expect(result.id).toBe('conn-1');
    });

    it('returns the same generic not-found response for missing and foreign-owned OAuth state', async () => {
      repo.consumeOAuthState
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(makeOAuthStateRecord({ userId: 'other' }));

      const missing = await captureHttpException(() =>
        service.completeOAuthSession('github', { ...oauthInput, state: 'missing-state' }),
      );
      const foreign = await captureHttpException(() =>
        service.completeOAuthSession('github', oauthInput),
      );
      const expectedResponse = {
        message: 'OAuth state was not found',
        error: 'Not Found',
        statusCode: 404,
      };

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(missing.getStatus()).toBe(404);
      expect(missing.getResponse()).toEqual(expectedResponse);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(foreign.getStatus()).toBe(404);
      expect(foreign.getResponse()).toEqual(expectedResponse);
    });

    it('throws when state provider does not match', async () => {
      repo.consumeOAuthState.mockResolvedValue(makeOAuthStateRecord({ provider: 'zoom' }));
      await expect(service.completeOAuthSession('github', oauthInput)).rejects.toThrow(
        'does not match the provider',
      );
    });

    it('throws when token exchange fails', async () => {
      mockFetchError(400, { error_description: 'The code has expired' });
      await expect(service.completeOAuthSession('github', oauthInput)).rejects.toThrow(
        'The code has expired',
      );
    });

    it('handles providers that do not return a refresh token', async () => {
      mockFetchSuccess({ access_token: 'access-only', token_type: 'bearer', expires_in: 3600 });
      const result = await service.completeOAuthSession('github', oauthInput);
      expect(result.hasRefreshToken).toBe(false);
    });

    it('wraps fetch network errors in a meaningful message', async () => {
      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      await expect(service.completeOAuthSession('github', oauthInput)).rejects.toThrow(
        'Failed to contact GitHub token endpoint',
      );
    });
  });

  // ── getProviderToken ────────────────────────────────────────────
  describe('getProviderToken', () => {
    it('returns a decrypted access token', async () => {
      repo.findByProvider.mockResolvedValue(makeTokenRecord());
      const result = await service.getProviderToken('github', 'user-1');
      expect(encryption.decrypt).toHaveBeenCalled();
      expect(result.accessToken).toBe('decrypted-value');
      expect(result.provider).toBe('github');
      expect(result.tokenType).toBe('Bearer');
    });

    it('throws NotFoundException when no connection exists', async () => {
      repo.findByProvider.mockResolvedValue(undefined);
      await expect(service.getProviderToken('github', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('triggers auto-refresh when token is expired', async () => {
      repo.findByProvider.mockResolvedValue(
        makeTokenRecord({ expiresAt: new Date(Date.now() - 10_000) }),
      );
      mockFetchSuccess({
        access_token: 'refreshed',
        refresh_token: 'refreshed-rt',
        token_type: 'bearer',
        expires_in: 3600,
      });
      const result = await service.getProviderToken('github', 'user-1');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBe('decrypted-value');
    });

    it('does not refresh or decrypt a provider token when durable issuance audit fails', async () => {
      repo.findByProvider.mockResolvedValue(makeTokenRecord({ organizationId: 'org-1' }));
      auditLogService.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));
      globalThis.fetch = vi.fn() as never;

      await expect(service.getProviderToken('github', 'user-1', 'org-1', auth)).rejects.toThrow(
        'audit outbox unavailable',
      );

      expect(auditLogService.recordDurable).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({
          action: 'integration.token.issue',
          resourceId: 'conn-1',
          metadata: expect.objectContaining({ selection: 'provider' }),
        }),
        undefined,
        'org-1',
      );
      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // ── getConnectionToken ──────────────────────────────────────────
  describe('getConnectionToken', () => {
    it('returns a decrypted token only for a connection and run in the same organization', async () => {
      repo.findById.mockResolvedValue(makeTokenRecord({ organizationId: 'org-1' }));
      const result = await service.getConnectionToken('conn-1', 'org-1', auth, 'run-1');
      expect(repo.findById).toHaveBeenCalledWith('conn-1', 'org-1');
      expect(repo.runBelongsToOrganization).toHaveBeenCalledWith('run-1', 'org-1');
      expect(auditLogService.recordDurable).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({
          action: 'integration.token.issue',
          metadata: expect.objectContaining({ runId: 'run-1' }),
        }),
        undefined,
        'org-1',
      );
      expect(encryption.decrypt).toHaveBeenCalled();
      expect(result.accessToken).toBe('decrypted-value');
    });

    it('returns the same not-found response for a missing connection and foreign-org run', async () => {
      repo.findById.mockResolvedValue(undefined);
      const missingConnection = await captureHttpException(() =>
        service.getConnectionToken('missing', 'org-1', auth, 'run-1'),
      );
      repo.findById.mockResolvedValue(makeTokenRecord({ organizationId: 'org-1' }));
      repo.runBelongsToOrganization.mockResolvedValue(false);
      const foreignRun = await captureHttpException(() =>
        service.getConnectionToken('conn-1', 'org-1', auth, 'run-foreign'),
      );

      expect(missingConnection).toBeInstanceOf(NotFoundException);
      expect(foreignRun).toBeInstanceOf(NotFoundException);
      expect(missingConnection.getResponse()).toEqual(foreignRun.getResponse());
      expect(auditLogService.recordDurable).not.toHaveBeenCalled();
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });

    it('does not release the same connection id through another organization context', async () => {
      repo.findById.mockResolvedValue(undefined);
      repo.runBelongsToOrganization.mockResolvedValue(true);

      await expect(
        service.getConnectionToken(
          'conn-1',
          'org-2',
          {
            ...auth,
            organizationId: 'org-2',
          },
          'run-org-2',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(repo.findById).toHaveBeenCalledWith('conn-1', 'org-2');
      expect(auditLogService.recordDurable).not.toHaveBeenCalled();
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });

    it('rejects a missing run identifier before looking up or releasing credentials', async () => {
      await expect(service.getConnectionToken('conn-1', 'org-1', auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.runBelongsToOrganization).not.toHaveBeenCalled();
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });

    it('does not refresh or decrypt a run-bound token when durable audit fails', async () => {
      repo.findById.mockResolvedValue(makeTokenRecord({ organizationId: 'org-1' }));
      auditLogService.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));
      globalThis.fetch = vi.fn() as never;

      await expect(service.getConnectionToken('conn-1', 'org-1', auth, 'run-1')).rejects.toThrow(
        'audit outbox unavailable',
      );

      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // ── refreshConnection ───────────────────────────────────────────
  describe('refreshConnection', () => {
    beforeEach(() => {
      mockFetchSuccess({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'bearer',
        expires_in: 7200,
        scope: 'repo read:user',
      });
    });

    it('refreshes token and returns updated connection', async () => {
      repo.findById.mockResolvedValue(makeTokenRecord());
      const result = await service.refreshConnection('conn-1', 'user-1');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(encryption.encrypt).toHaveBeenCalledWith('new-access');
      expect(repo.upsertConnection).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('github');
    });

    it('returns the same complete not-found response for missing and foreign connections', async () => {
      repo.findById
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(makeTokenRecord({ userId: 'other' }));

      const missing = await captureHttpException(() => service.refreshConnection('x', 'user-1'));
      const foreign = await captureHttpException(() =>
        service.refreshConnection('conn-1', 'user-1'),
      );
      const expectedResponse = {
        message: 'Connection was not found',
        error: 'Not Found',
        statusCode: 404,
      };

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(missing.getStatus()).toBe(404);
      expect(missing.getResponse()).toEqual(expectedResponse);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(foreign.getStatus()).toBe(404);
      expect(foreign.getResponse()).toEqual(expectedResponse);
    });

    it('throws when no refresh token is stored', async () => {
      repo.findById.mockResolvedValue(makeTokenRecord({ refreshToken: null }));
      await expect(service.refreshConnection('conn-1', 'user-1')).rejects.toThrow(
        'No refresh token stored',
      );
    });
  });

  // ── disconnect ──────────────────────────────────────────────────
  describe('disconnect', () => {
    it('removes the connection record', async () => {
      repo.deleteConnection.mockResolvedValue(true);
      await service.disconnect('conn-1', 'user-1');
      expect(repo.deleteConnection).toHaveBeenCalledWith(
        'conn-1',
        'user-1',
        null,
        expect.any(Function),
      );
    });

    it('returns the same complete not-found response for missing and foreign connections', async () => {
      repo.deleteConnection.mockResolvedValue(false);

      const missing = await captureHttpException(() => service.disconnect('missing', 'user-1'));
      const foreign = await captureHttpException(() => service.disconnect('conn-1', 'user-1'));
      const expectedResponse = {
        message: 'Connection was not found',
        error: 'Not Found',
        statusCode: 404,
      };

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(missing.getStatus()).toBe(404);
      expect(missing.getResponse()).toEqual(expectedResponse);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(foreign.getStatus()).toBe(404);
      expect(foreign.getResponse()).toEqual(expectedResponse);
    });
  });

  // ── encryption integration ──────────────────────────────────────
  describe('encryption integration', () => {
    it('encrypts tokens before storage', async () => {
      mockFetchSuccess({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'bearer',
        expires_in: 3600,
      });
      repo.consumeOAuthState.mockResolvedValue(makeOAuthStateRecord());
      repo.findByProvider.mockResolvedValue(undefined);
      await service.completeOAuthSession('github', {
        userId: 'user-1',
        state: 'test-state-abc',
        code: 'c',
        redirectUri: 'https://x',
      });
      expect(encryption.encrypt).toHaveBeenCalledWith('at');
      expect(encryption.encrypt).toHaveBeenCalledWith('rt');
      const stored = repo.upsertConnection.mock.calls[0][0];
      expect(stored.accessToken).toEqual(MOCK_ENCRYPTED);
    });

    it('decrypts tokens when retrieving', async () => {
      repo.findByProvider.mockResolvedValue(makeTokenRecord());
      const result = await service.getProviderToken('github', 'user-1');
      expect(encryption.decrypt).toHaveBeenCalled();
      expect(result.accessToken).toBe('decrypted-value');
    });
  });

  // ── error paths ─────────────────────────────────────────────────
  describe('error paths', () => {
    it('wraps HTTP errors from OAuth provider', async () => {
      mockFetchError(401, { error: 'invalid_client' });
      repo.consumeOAuthState.mockResolvedValue(makeOAuthStateRecord());
      repo.findByProvider.mockResolvedValue(undefined);
      await expect(
        service.completeOAuthSession('github', {
          userId: 'user-1',
          state: 'test-state-abc',
          code: 'c',
          redirectUri: 'https://x',
        }),
      ).rejects.toThrow('invalid_client');
    });

    it('parses non-JSON token responses as URLSearchParams', async () => {
      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('access_token=form_tok&token_type=bearer&scope=repo'),
      });
      repo.consumeOAuthState.mockResolvedValue(makeOAuthStateRecord());
      repo.findByProvider.mockResolvedValue(undefined);
      const result = await service.completeOAuthSession('github', {
        userId: 'user-1',
        state: 'test-state-abc',
        code: 'c',
        redirectUri: 'https://x',
      });
      expect(encryption.encrypt).toHaveBeenCalledWith('form_tok');
      expect(result.provider).toBe('github');
    });
  });
});
