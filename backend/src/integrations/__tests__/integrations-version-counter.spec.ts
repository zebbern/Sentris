import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { IntegrationsService } from '../integrations.service';
import type { IntegrationsRepository } from '../integrations.repository';
import type { TokenEncryptionService } from '../token.encryption';
import type { SecretEncryptionMaterial } from '@sentris/shared';
import type { IntegrationProviderConfigRecord } from '../../database/schema';

// ── Constants ───────────────────────────────────────────────────────

const MOCK_ENCRYPTED: SecretEncryptionMaterial = {
  ciphertext: 'enc-ct',
  iv: 'enc-iv',
  authTag: 'enc-tag',
  keyId: 'enc-key',
};

const VERSION_KEY = 'sentris:provider-overrides:version';

// ── MockRedis ───────────────────────────────────────────────────────

class MockRedis {
  private kv = new Map<string, string>();

  async set(key: string, value: string): Promise<string> {
    this.kv.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async incr(key: string): Promise<number> {
    const current = Number(this.kv.get(key)) || 0;
    const next = current + 1;
    this.kv.set(key, String(next));
    return next;
  }

  async del(key: string): Promise<number> {
    const existed = this.kv.has(key);
    this.kv.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<void> {}

  /** Test helper — get a value */
  getValue(key: string): string | undefined {
    return this.kv.get(key);
  }
}

/** Error-throwing Redis mock */
class ErrorRedis extends MockRedis {
  override async set(): Promise<string> {
    throw new Error('Redis connection refused');
  }

  override async get(): Promise<string | null> {
    throw new Error('Redis connection refused');
  }

  override async incr(): Promise<number> {
    throw new Error('Redis connection refused');
  }
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
      extraAuthorizeParams: {},
      extraTokenParams: undefined,
      clientId: 'env-client-id',
      clientSecret: 'env-client-secret',
    },
  }),
  generateState: vi.fn().mockReturnValue('mock-state'),
  summarizeProvider: vi.fn().mockImplementation((config: any) => ({
    id: config.id,
    name: config.name,
    description: config.description,
    defaultScopes: config.defaultScopes,
    supportsRefresh: config.supportsRefresh,
    isConfigured: Boolean(config.clientId && config.clientSecret),
  })),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function makeProviderConfigRecord(
  overrides: Partial<IntegrationProviderConfigRecord> = {},
): IntegrationProviderConfigRecord {
  return {
    provider: 'github',
    clientId: 'override-client-id',
    clientSecret: MOCK_ENCRYPTED as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMocks() {
  const repo: Record<string, ReturnType<typeof vi.fn>> = {
    listConnections: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    findByProvider: vi.fn(),
    upsertConnection: vi.fn(),
    deleteConnection: vi.fn(),
    createOAuthState: vi.fn(),
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
      masterKey: null,
    }),
  };

  return { repo, encryption, configSvc };
}

function createService(
  repo: Record<string, ReturnType<typeof vi.fn>>,
  encryption: Record<string, ReturnType<typeof vi.fn>>,
  configSvc: Record<string, ReturnType<typeof vi.fn>>,
  redis: MockRedis | ErrorRedis | null,
): IntegrationsService {
  return new IntegrationsService(
    repo as unknown as IntegrationsRepository,
    encryption as unknown as TokenEncryptionService,
    configSvc as any,
    redis as any,
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe('IntegrationsService — version-counter polling', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let encryption: Record<string, ReturnType<typeof vi.fn>>;
  let configSvc: Record<string, ReturnType<typeof vi.fn>>;
  let redis: MockRedis;
  let service: IntegrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMocks();
    repo = mocks.repo;
    encryption = mocks.encryption;
    configSvc = mocks.configSvc;
    redis = new MockRedis();
    service = createService(repo, encryption, configSvc, redis);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('reads the current version counter from Redis at startup', async () => {
      // Pre-set a version in Redis
      await redis.set(VERSION_KEY, '5');

      await service.onModuleInit();

      // Accessing private field via bracket notation for testing
      expect((service as any).cachedVersion).toBe(5);
    });

    it('defaults cachedVersion to 0 when Redis has no version', async () => {
      await service.onModuleInit();
      expect((service as any).cachedVersion).toBe(0);
    });

    it('starts a polling interval', async () => {
      await service.onModuleInit();
      expect((service as any).versionCheckInterval).toBeTruthy();
    });
  });

  describe('incrementVersion (via upsertProviderConfiguration)', () => {
    it('increments the version counter in Redis after saving a provider config', async () => {
      await service.onModuleInit();

      await service.upsertProviderConfiguration('github', {
        clientId: 'new-id',
        clientSecret: 'new-secret',
      });

      expect(redis.getValue(VERSION_KEY)).toBe('1');
    });

    it('increments again for subsequent saves', async () => {
      await service.onModuleInit();

      await service.upsertProviderConfiguration('github', {
        clientId: 'id1',
        clientSecret: 'secret1',
      });
      await service.upsertProviderConfiguration('github', {
        clientId: 'id2',
        clientSecret: 'secret2',
      });

      expect(redis.getValue(VERSION_KEY)).toBe('2');
    });

    it('updates local cachedVersion after increment', async () => {
      await service.onModuleInit();

      await service.upsertProviderConfiguration('github', {
        clientId: 'new-id',
        clientSecret: 'new-secret',
      });

      expect((service as any).cachedVersion).toBe(1);
    });
  });

  describe('incrementVersion (via deleteProviderConfiguration)', () => {
    it('increments version when a provider config is deleted', async () => {
      await service.onModuleInit();

      await service.deleteProviderConfiguration('github');

      expect(redis.getValue(VERSION_KEY)).toBe('1');
    });
  });

  describe('checkVersionAndReload (polling logic)', () => {
    it('reloads from DB when remote version exceeds local version', async () => {
      await service.onModuleInit();
      repo.listProviderConfigs.mockClear();

      // Simulate another instance incrementing the version
      await redis.incr(VERSION_KEY);

      // Trigger the poll manually
      await (service as any).checkVersionAndReload();

      // Should have reloaded provider overrides from DB
      expect(repo.listProviderConfigs).toHaveBeenCalledTimes(1);
    });

    it('does NOT reload when version has not changed', async () => {
      await service.onModuleInit();
      repo.listProviderConfigs.mockClear();

      // Version is still 0, same as local
      await (service as any).checkVersionAndReload();

      expect(repo.listProviderConfigs).not.toHaveBeenCalled();
    });

    it('updates local cachedVersion after reload', async () => {
      await service.onModuleInit();

      // Simulate external version bump to 3
      await redis.set(VERSION_KEY, '3');

      await (service as any).checkVersionAndReload();

      expect((service as any).cachedVersion).toBe(3);
    });

    it('picks up provider override changes from another instance', async () => {
      await service.onModuleInit();

      // Simulate another instance adding a provider config and bumping version
      await redis.incr(VERSION_KEY);
      repo.listProviderConfigs.mockResolvedValue([makeProviderConfigRecord()]);

      await (service as any).checkVersionAndReload();

      // The overrides should now be loaded
      const config = await service.getProviderConfiguration('github');
      expect(config.clientId).toBe('override-client-id');
      expect(config.configuredBy).toBe('user');
    });
  });

  describe('onModuleDestroy', () => {
    it('clears the polling interval', async () => {
      await service.onModuleInit();
      expect((service as any).versionCheckInterval).toBeTruthy();

      await service.onModuleDestroy();
      expect((service as any).versionCheckInterval).toBeNull();
    });
  });

  describe('null Redis', () => {
    let nullService: IntegrationsService;

    beforeEach(() => {
      nullService = createService(repo, encryption, configSvc, null);
    });

    afterEach(async () => {
      await nullService.onModuleDestroy();
    });

    it('onModuleInit does not throw', async () => {
      await nullService.onModuleInit();
    });

    it('syncVersionFromRedis is a no-op', async () => {
      await nullService.onModuleInit();
      expect((nullService as any).cachedVersion).toBe(0);
    });

    it('checkVersionAndReload is a no-op', async () => {
      await nullService.onModuleInit();
      repo.listProviderConfigs.mockClear();

      await (nullService as any).checkVersionAndReload();
      // Should not reload since there's no Redis
      expect(repo.listProviderConfigs).not.toHaveBeenCalled();
    });

    it('upsert still works locally (no version increment)', async () => {
      await nullService.onModuleInit();

      await nullService.upsertProviderConfiguration('github', {
        clientId: 'local-id',
        clientSecret: 'local-secret',
      });

      const config = await nullService.getProviderConfiguration('github');
      expect(config.clientId).toBe('local-id');
    });
  });

  describe('Redis errors', () => {
    let errorService: IntegrationsService;

    beforeEach(() => {
      errorService = createService(repo, encryption, configSvc, new ErrorRedis());
    });

    afterEach(async () => {
      await errorService.onModuleDestroy();
    });

    it('onModuleInit does not throw when Redis fails', async () => {
      await errorService.onModuleInit();
      // Should complete without throwing
    });

    it('checkVersionAndReload does not throw on Redis error', async () => {
      await errorService.onModuleInit();
      await (errorService as any).checkVersionAndReload();
    });

    it('incrementVersion does not throw (upsert still works)', async () => {
      await errorService.onModuleInit();

      await errorService.upsertProviderConfiguration('github', {
        clientId: 'fail-id',
        clientSecret: 'fail-secret',
      });
      // Should not propagate Redis error
    });
  });
});
