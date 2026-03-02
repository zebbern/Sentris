import { BadRequestException, NotFoundException } from '@nestjs/common';
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

// ── Constants ───────────────────────────────────────────────────────
const now = new Date('2024-06-01T00:00:00.000Z');

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
    upsertConnection: vi.fn().mockImplementation(async (input: any) => ({
      id: 'conn-1',
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

  return { repo, encryption, configSvc };
}

function mockFetchSuccess(payload: Record<string, any>) {
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  });
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
  let service: IntegrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMocks();
    repo = mocks.repo;
    encryption = mocks.encryption;
    configSvc = mocks.configSvc;

    service = new IntegrationsService(
      repo as unknown as IntegrationsRepository,
      encryption as unknown as TokenEncryptionService,
      configSvc as any,
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
      expect(repo.upsertProviderConfig).toHaveBeenCalledWith({
        provider: 'github',
        clientId: 'new-id',
        clientSecret: MOCK_ENCRYPTED,
      });
    });

    it('reuses previous secret when none provided', async () => {
      repo.listProviderConfigs.mockResolvedValue([makeProviderConfigRecord()]);
      await service.onModuleInit();
      await service.upsertProviderConfiguration('github', { clientId: 'updated-id' });
      expect(encryption.encrypt).not.toHaveBeenCalled();
      expect(repo.upsertProviderConfig).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'updated-id', clientSecret: MOCK_ENCRYPTED }),
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
      expect(repo.deleteProviderConfig).toHaveBeenCalledWith('github');
      const result = await service.getProviderConfiguration('github');
      expect(result.configuredBy).toBe('environment');
    });

    it('is idempotent for non-existent config', async () => {
      await service.deleteProviderConfiguration('github');
      expect(repo.deleteProviderConfig).toHaveBeenCalledWith('github');
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

    it('throws when OAuth state is missing', async () => {
      repo.consumeOAuthState.mockResolvedValue(undefined);
      await expect(
        service.completeOAuthSession('github', { ...oauthInput, state: 'bad' }),
      ).rejects.toThrow('OAuth state is missing');
    });

    it('throws when state userId does not match', async () => {
      repo.consumeOAuthState.mockResolvedValue(makeOAuthStateRecord({ userId: 'other' }));
      await expect(service.completeOAuthSession('github', oauthInput)).rejects.toThrow(
        'does not match the requesting user',
      );
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
  });

  // ── getConnectionToken ──────────────────────────────────────────
  describe('getConnectionToken', () => {
    it('returns a decrypted token for a specific connection', async () => {
      repo.findById.mockResolvedValue(makeTokenRecord());
      const result = await service.getConnectionToken('conn-1');
      expect(repo.findById).toHaveBeenCalledWith('conn-1');
      expect(encryption.decrypt).toHaveBeenCalled();
      expect(result.accessToken).toBe('decrypted-value');
    });

    it('throws NotFoundException when connection missing', async () => {
      repo.findById.mockResolvedValue(undefined);
      await expect(service.getConnectionToken('missing')).rejects.toThrow(NotFoundException);
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

    it('throws NotFoundException when connection missing', async () => {
      repo.findById.mockResolvedValue(undefined);
      await expect(service.refreshConnection('x', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws when connection belongs to another user', async () => {
      repo.findById.mockResolvedValue(makeTokenRecord({ userId: 'other' }));
      await expect(service.refreshConnection('conn-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
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
      await service.disconnect('conn-1', 'user-1');
      expect(repo.deleteConnection).toHaveBeenCalledWith('conn-1', 'user-1');
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
