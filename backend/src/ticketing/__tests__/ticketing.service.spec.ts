import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { TicketingService } from '../ticketing.service';
import {
  TicketReconciliationEventUnavailableError,
  type TicketingRepository,
} from '../ticketing.repository';
import type { JiraAdapter } from '../jira/jira.adapter';
import { JiraApiError } from '../jira/jira.adapter';
import type { TokenEncryptionService } from '../../integrations/token.encryption';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-1';
const USER_ID = 'user-test-1';
const CONN_ID = 'conn-1';
const CLOUD_ID = 'cloud-abc123';
const TRIAGE_ID = 'triage-uuid-1';

function makeAuth(organizationId = ORG_ID): AuthContext {
  return {
    isAuthenticated: true,
    userId: USER_ID,
    organizationId,
    roles: ['ADMIN'],
    provider: 'local',
  } as AuthContext;
}

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    organizationId: ORG_ID,
    provider: 'jira',
    accessToken: { iv: 'iv', data: 'enc-access', tag: 'tag' },
    refreshToken: { iv: 'iv', data: 'enc-refresh', tag: 'tag' },
    tokenExpiresAt: new Date(Date.now() + 3_600_000), // 1 hr from now
    cloudId: CLOUD_ID,
    webhookSecret: 'wh-secret-123',
    webhookId: 'wh-id-1',
    webhookCloudId: CLOUD_ID,
    webhookRegistrationStatus: 'registered',
    webhookRegistrationVersion: 1,
    webhookRegisteredAt: new Date('2025-01-01T00:01:00.000Z'),
    config: {
      projectKey: 'SEC',
      issueTypeId: '10001',
      statusMapping: {
        triaged: 'Open',
        in_progress: 'In Progress',
        fixed: 'Done',
        verified: 'Done',
        wont_fix: "Won't Do",
        accepted_risk: "Won't Do",
      },
      autoCreateOnStatuses: ['triaged'],
    },
    createdBy: USER_ID,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeTicketLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    findingTriageId: TRIAGE_ID,
    organizationId: ORG_ID,
    provider: 'jira',
    externalId: 'SEC-42',
    externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
    syncStatus: 'synced',
    lastSyncedAt: new Date(),
    metadata: { jiraIssueId: '12345' },
    createdAt: new Date(),
    ...overrides,
  };
}

class MockRedis {
  private readonly kv = new Map<string, string>();
  private readonly ttls = new Map<string, number>();

  async set(key: string, value: string, mode?: string, ttl?: number): Promise<string> {
    this.kv.set(key, value);
    if (mode === 'EX' && ttl) {
      this.ttls.set(key, ttl);
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    const existed = this.kv.has(key);
    this.kv.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<void> {}

  getTtl(key: string): number | undefined {
    return this.ttls.get(key);
  }

  has(key: string): boolean {
    return this.kv.has(key);
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  const mutationExecutor = { insert: mock(), update: mock(), delete: mock() };
  const repoMock = {
    findConnectionByOrg: mock((): any => Promise.resolve(makeConnection())),
    createConnection: mock((): any => Promise.resolve(makeConnection())),
    updateConnection: mock(
      async (
        _id?: string,
        _data?: unknown,
        onUpdated?: (executor: unknown, record: ReturnType<typeof makeConnection>) => Promise<void>,
      ): Promise<any> => {
        const record = makeConnection();
        await onUpdated?.(mutationExecutor, record);
        return record;
      },
    ),
    saveOAuthConnectionAndQueueWebhookRegistration: mock(
      async (
        _data?: unknown,
        onPersisted?: (
          executor: unknown,
          record: ReturnType<typeof makeConnection>,
        ) => Promise<void>,
      ): Promise<any> => {
        const record = makeConnection({
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        });
        await onPersisted?.(mutationExecutor, record);
        return record;
      },
    ),
    findConnectionForWebhookRegistration: mock((): any => Promise.resolve(makeConnection())),
    completeWebhookRegistration: mock(
      async (
        _input?: unknown,
        onCompleted?: (
          executor: unknown,
          record: ReturnType<typeof makeConnection>,
        ) => Promise<void>,
      ): Promise<any> => {
        const record = makeConnection();
        await onCompleted?.(mutationExecutor, record);
        return record;
      },
    ),
    findWebhookRegistrationDelivery: mock((): any => Promise.resolve(undefined)),
    deleteConnection: mock(
      async (
        _organizationId?: string,
        _provider?: string,
        onDeleted?: (executor: unknown, record: ReturnType<typeof makeConnection>) => Promise<void>,
      ): Promise<any> => {
        await onDeleted?.(mutationExecutor, makeConnection());
        return true;
      },
    ),
    findTicketLinkByTriageId: mock((): any => Promise.resolve(undefined)),
    findTicketLinkByExternalId: mock((): any => Promise.resolve(undefined)),
    createTicketLink: mock((): any => Promise.resolve(makeTicketLink())),
    reserveTicketCreation: mock(
      async (
        _input?: unknown,
        onReserved?: (
          executor: unknown,
          record: ReturnType<typeof makeTicketLink>,
        ) => Promise<void>,
      ): Promise<any> => {
        const record = makeTicketLink({
          externalId: `sentris-pending:${TRIAGE_ID}`,
          externalUrl: '',
          syncStatus: 'pending',
          metadata: {},
        });
        await onReserved?.(mutationExecutor, record);
        return {
          acquired: true,
          record,
        };
      },
    ),
    releaseTicketCreationReservation: mock((): any => Promise.resolve()),
    finalizeTicketCreation: mock(
      async (
        _input?: unknown,
        onFinalized?: (
          executor: unknown,
          record: ReturnType<typeof makeTicketLink>,
        ) => Promise<void>,
      ): Promise<any> => {
        const record = makeTicketLink();
        await onFinalized?.(mutationExecutor, record);
        return record;
      },
    ),
    markTicketCreationUnknown: mock((): any =>
      Promise.resolve(
        makeTicketLink({
          externalId: `sentris-pending:${TRIAGE_ID}`,
          externalUrl: '',
          syncStatus: 'unknown',
        }),
      ),
    ),
    updateTicketLink: mock(
      async (
        _id?: string,
        _data?: unknown,
        onUpdated?: (executor: unknown, record: ReturnType<typeof makeTicketLink>) => Promise<void>,
      ): Promise<any> => {
        const record = makeTicketLink();
        await onUpdated?.(mutationExecutor, record);
        return record;
      },
    ),
    findUnresolvedTicketIntent: mock((): any => Promise.resolve(undefined)),
    attachUnresolvedTicketIntent: mock((_input?: unknown, _onMutated?: unknown): any =>
      Promise.resolve(makeTicketLink()),
    ),
    clearUnresolvedTicketIntent: mock((_input?: unknown, _onMutated?: unknown): any =>
      Promise.resolve(undefined),
    ),
  };

  const adapterMock = {
    getAccessibleResources: mock((): any =>
      Promise.resolve([
        {
          id: CLOUD_ID,
          url: 'https://myteam.atlassian.net',
          name: 'My Team',
          scopes: [],
          avatarUrl: '',
        },
      ]),
    ),
    listProjects: mock((): any =>
      Promise.resolve([
        { id: 'p1', key: 'SEC', name: 'Security', avatarUrls: { '48x48': 'https://img/sec.png' } },
        { id: 'p2', key: 'ENG', name: 'Engineering', avatarUrls: {} },
      ]),
    ),
    listIssueTypes: mock((): any =>
      Promise.resolve([
        { id: '10001', name: 'Bug', description: 'A bug', iconUrl: 'https://icon/bug.png' },
        { id: '10002', name: 'Task', description: 'A task', iconUrl: 'https://icon/task.png' },
      ]),
    ),
    createIssue: mock((): any =>
      Promise.resolve({
        id: '12345',
        key: 'SEC-42',
        self: 'https://api.atlassian.com/rest/api/3/issue/12345',
      }),
    ),
    transitionIssue: mock((): any => Promise.resolve(true)),
    getIssue: mock((): any =>
      Promise.resolve({
        id: '12345',
        key: 'SEC-42',
        self: 'https://api.atlassian.com/ex/jira/cloud-abc123/rest/api/3/issue/12345',
        fields: {},
      }),
    ),
    registerWebhook: mock((): any => Promise.resolve('wh-id-1')),
    listWebhooks: mock((): any => Promise.resolve([])),
    refreshWebhook: mock((): any => Promise.resolve('2026-08-28T12:00:00.000+0000')),
    deleteWebhook: mock((): any => Promise.resolve()),
  };

  const encryptionMock = {
    encrypt: mock((val: string): any =>
      Promise.resolve({ iv: 'iv', data: `enc-${val}`, tag: 'tag' }),
    ),
    decrypt: mock((_value?: unknown): any => Promise.resolve('decrypted-access-token')),
  };

  const configMock = {
    get: mock((key: string, def?: string): any => {
      const config: Record<string, string> = {
        JIRA_CLIENT_ID: 'client-id',
        JIRA_CLIENT_SECRET: 'client-secret',
        JIRA_CALLBACK_URL: 'https://app.example.com/callback',
      };
      return config[key] ?? def ?? '';
    }),
  };

  const auditLogMock = {
    recordDurable: mock((): any => Promise.resolve()),
    recordDurableWithExecutor: mock((): any => Promise.resolve()),
  };

  return {
    repoMock,
    adapterMock,
    encryptionMock,
    configMock,
    auditLogMock,
    mutationExecutor,
  };
}

function createService(mocks: ReturnType<typeof createMocks>, redis: MockRedis | null = null) {
  return new TicketingService(
    mocks.repoMock as unknown as TicketingRepository,
    mocks.adapterMock as unknown as JiraAdapter,
    mocks.encryptionMock as unknown as TokenEncryptionService,
    mocks.configMock as any,
    redis as any,
    mocks.auditLogMock as unknown as AuditLogService,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketingService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: TicketingService;

  beforeEach(() => {
    mocks = createMocks();
    service = createService(mocks);
  });

  // -----------------------------------------------------------------------
  // getConnection
  // -----------------------------------------------------------------------

  describe('getConnection', () => {
    it('returns connected status when connection exists', async () => {
      const result = await service.getConnection(ORG_ID);

      expect(result.isConnected).toBe(true);
      expect(result.provider).toBe('jira');
      expect(result.cloudId).toBe(CLOUD_ID);
      expect(result.config).toBeTruthy();
      expect(result.id).toBe(CONN_ID);
    });

    it('returns disconnected status when no connection exists', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(undefined);

      const result = await service.getConnection(ORG_ID);

      expect(result.isConnected).toBe(false);
      expect(result.id).toBeNull();
      expect(result.cloudId).toBeNull();
      expect(result.config).toBeNull();
    });

    it('exposes a legacy empty config as connected but explicitly unconfigured', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(makeConnection({ config: {} }));

      const result = await service.getConnection(ORG_ID);

      expect(result.isConnected).toBe(true);
      expect(result.config).toBeNull();
    });

    it('exposes a dead webhook registration delivery for operator requeue', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(
        makeConnection({
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 4,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.findWebhookRegistrationDelivery.mockResolvedValue({
        status: 'dead',
        attempts: 8,
        maxAttempts: 8,
        lastError: 'Jira API returned 503',
      });

      const result = await service.getConnection(ORG_ID);

      expect(result.webhookRegistration).toEqual({
        status: 'dead',
        version: 4,
        lastError: 'Jira API returned 503',
      });
    });
  });

  // -----------------------------------------------------------------------
  // startOAuthFlow
  // -----------------------------------------------------------------------

  describe('startOAuthFlow', () => {
    it('returns authorization URL with correct scopes', async () => {
      const result = await service.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
      );

      expect(result.authorizationUrl).toContain('https://auth.atlassian.com/authorize');
      expect(result.authorizationUrl).toContain('read%3Ajira-work');
      expect(result.authorizationUrl).toContain('write%3Ajira-work');
      expect(result.authorizationUrl).toContain('offline_access');
      expect(result.state).toBeTruthy();
      expect(typeof result.state).toBe('string');
      expect(new URL(result.authorizationUrl).searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/callback',
      );
    });

    it('returns a UUID state parameter', async () => {
      const result = await service.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
      );

      // UUID v4 format check
      expect(result.state).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('throws when Jira OAuth is not configured', async () => {
      mocks.configMock.get.mockReturnValue('');
      const svc = createService(mocks);

      await expect(
        svc.startOAuthFlow(ORG_ID, USER_ID, 'https://app.example.com/callback'),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires the configured Jira callback URL', async () => {
      mocks.configMock.get.mockImplementation((key: string, def?: string): any => {
        const config: Record<string, string> = {
          JIRA_CLIENT_ID: 'client-id',
          JIRA_CLIENT_SECRET: 'client-secret',
          JIRA_CALLBACK_URL: '',
        };
        return config[key] ?? def ?? '';
      });
      const svc = createService(mocks);

      await expect(
        svc.startOAuthFlow(ORG_ID, USER_ID, 'https://app.example.com/callback'),
      ).rejects.toThrow('JIRA_CALLBACK_URL');
    });

    it('rejects a client callback that differs from the configured callback', async () => {
      await expect(
        service.startOAuthFlow(ORG_ID, USER_ID, 'https://different.example.com/callback'),
      ).rejects.toThrow('does not match JIRA_CALLBACK_URL');
    });

    it('does not persist OAuth state when durable start audit acceptance fails', async () => {
      mocks.auditLogMock.recordDurable.mockRejectedValueOnce(new Error('audit outbox unavailable'));

      await expect(
        service.startOAuthFlow(ORG_ID, USER_ID, 'https://app.example.com/callback', makeAuth()),
      ).rejects.toThrow('audit outbox unavailable');

      expect(
        (service as unknown as { oauthStateCache: Map<string, unknown> }).oauthStateCache.size,
      ).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // handleOAuthCallback
  // -----------------------------------------------------------------------

  describe('handleOAuthCallback', () => {
    it('throws for invalid or expired state', async () => {
      await expect(service.handleOAuthCallback('code-123', 'invalid-state')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when no accessible Jira cloud resources found', async () => {
      // Set up a valid state first
      const { state } = await service.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
      );

      // Mock the code exchange
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
          { status: 200 },
        ),
      );

      mocks.adapterMock.getAccessibleResources.mockResolvedValueOnce([]);

      await expect(service.handleOAuthCallback('code-123', state)).rejects.toThrow(
        'No accessible Jira Cloud sites found',
      );

      fetchSpy.mockRestore();
    });

    it('does not exchange a callback code when durable exchange audit acceptance fails', async () => {
      const { state } = await service.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
        makeAuth(),
      );
      mocks.auditLogMock.recordDurable.mockRejectedValueOnce(new Error('audit outbox unavailable'));
      const fetchSpy = spyOn(globalThis, 'fetch');

      await expect(service.handleOAuthCallback('code-123', state)).rejects.toThrow(
        'audit outbox unavailable',
      );

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mocks.adapterMock.getAccessibleResources).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('consumes OAuth state across service instances through Redis', async () => {
      const redis = new MockRedis();
      const startService = createService(mocks, redis);
      const callbackService = createService(mocks, redis);

      const { state } = await startService.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
      );
      const redisKey = `sentris:ticketing:oauth-state:${state}`;

      expect(redis.getTtl(redisKey)).toBe(300);

      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
          { status: 200 },
        ),
      );

      await expect(callbackService.handleOAuthCallback('code-123', state)).resolves.toEqual({
        success: true,
      });

      expect(redis.has(redisKey)).toBe(false);

      fetchSpy.mockRestore();
    });

    it('uses the callback URI stored with the OAuth state for token exchange', async () => {
      const redis = new MockRedis();
      const startMocks = createMocks();
      const callbackMocks = createMocks();
      callbackMocks.configMock.get.mockImplementation((key: string, def?: string): any => {
        const config: Record<string, string> = {
          JIRA_CLIENT_ID: 'client-id',
          JIRA_CLIENT_SECRET: 'client-secret',
          JIRA_CALLBACK_URL: 'https://new.example.com/callback',
        };
        return config[key] ?? def ?? '';
      });
      const startService = createService(startMocks, redis);
      const callbackService = createService(callbackMocks, redis);
      const { state } = await startService.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
      );
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
          { status: 200 },
        ),
      );

      await callbackService.handleOAuthCallback('code-123', state);

      const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(request.body as string)).toMatchObject({
        redirect_uri: 'https://app.example.com/callback',
      });
      fetchSpy.mockRestore();
    });

    it('atomically persists pending webhook registration instead of calling Jira inline', async () => {
      const { state } = await service.startOAuthFlow(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
      );
      mocks.repoMock.findConnectionByOrg.mockResolvedValueOnce(undefined);
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
          { status: 200 },
        ),
      );

      await service.handleOAuthCallback('code-123', state);

      expect(mocks.repoMock.saveOAuthConnectionAndQueueWebhookRegistration).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          provider: 'jira',
          cloudId: CLOUD_ID,
          createdBy: USER_ID,
          webhookSecret: expect.any(String),
        }),
        expect.any(Function),
      );
      expect(mocks.adapterMock.registerWebhook).not.toHaveBeenCalled();
      expect(mocks.auditLogMock.recordDurableWithExecutor).toHaveBeenCalledWith(
        mocks.mutationExecutor,
        expect.objectContaining({
          userId: USER_ID,
          organizationId: ORG_ID,
        }),
        expect.objectContaining({
          action: 'ticketing.oauth.connect',
          resourceId: CONN_ID,
          metadata: expect.objectContaining({ phase: 'completed' }),
        }),
        undefined,
        ORG_ID,
      );
      fetchSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------

  describe('disconnect', () => {
    it('calls repository deleteConnection', async () => {
      await service.disconnect(ORG_ID);

      expect(mocks.repoMock.deleteConnection).toHaveBeenCalledWith(
        ORG_ID,
        'jira',
        expect.any(Function),
      );
      expect(mocks.auditLogMock.recordDurableWithExecutor).toHaveBeenCalledWith(
        mocks.mutationExecutor,
        null,
        expect.objectContaining({
          action: 'ticketing.oauth.disconnect',
          resourceId: CONN_ID,
        }),
        undefined,
        ORG_ID,
      );
    });
  });

  // -----------------------------------------------------------------------
  // updateConfig
  // -----------------------------------------------------------------------

  describe('updateConfig', () => {
    it('updates config and returns connection status', async () => {
      const config = {
        projectKey: 'ENG',
        issueTypeId: '10002',
        statusMapping: {
          triaged: 'To Do',
          in_progress: 'In Progress',
          fixed: 'Done',
          verified: 'Done',
          wont_fix: "Won't Do",
          accepted_risk: "Won't Do",
        },
        autoCreateOnStatuses: ['triaged', 'in_progress'] as any,
      };

      await service.updateConfig(ORG_ID, config);

      expect(mocks.repoMock.updateConnection).toHaveBeenCalledWith(
        CONN_ID,
        { config },
        expect.any(Function),
      );
      expect(mocks.auditLogMock.recordDurableWithExecutor).toHaveBeenCalledWith(
        mocks.mutationExecutor,
        null,
        expect.objectContaining({ action: 'ticketing.config.update' }),
        undefined,
        ORG_ID,
      );
    });

    it('throws when no connection exists', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(undefined);

      await expect(
        service.updateConfig(ORG_ID, {
          projectKey: 'SEC',
          issueTypeId: '10001',
          statusMapping: {} as any,
          autoCreateOnStatuses: ['triaged'] as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------------
  // listProjects
  // -----------------------------------------------------------------------

  describe('listProjects', () => {
    it('returns parsed project list with avatar URL', async () => {
      const result = await service.listProjects(ORG_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'p1',
        key: 'SEC',
        name: 'Security',
        avatarUrl: 'https://img/sec.png',
      });
    });
  });

  // -----------------------------------------------------------------------
  // listIssueTypes
  // -----------------------------------------------------------------------

  describe('listIssueTypes', () => {
    it('returns parsed issue type list', async () => {
      const result = await service.listIssueTypes(ORG_ID, 'SEC');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '10001',
        name: 'Bug',
        description: 'A bug',
        iconUrl: 'https://icon/bug.png',
      });
    });
  });

  describe('getCurrentJiraIssue', () => {
    it('loads the authoritative issue through the organization connection', async () => {
      const getCurrentJiraIssue = (
        service as unknown as {
          getCurrentJiraIssue: (
            organizationId: string,
            issueKey: string,
          ) => Promise<Record<string, unknown>>;
        }
      ).getCurrentJiraIssue;

      const issue = await getCurrentJiraIssue.call(service, ORG_ID, 'SEC-42');

      expect(issue).toEqual(expect.objectContaining({ id: '12345', key: 'SEC-42' }));
      expect(mocks.adapterMock.getIssue).toHaveBeenCalledWith(
        CLOUD_ID,
        'decrypted-access-token',
        'SEC-42',
      );
    });
  });

  describe('registerPendingWebhook', () => {
    it('does not call Jira when durable registration audit acceptance fails', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValueOnce(
        makeConnection({
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 1,
        }),
      );
      mocks.auditLogMock.recordDurable.mockRejectedValueOnce(new Error('audit outbox unavailable'));

      await expect(
        service.registerPendingWebhook({
          organizationId: ORG_ID,
          connectionId: CONN_ID,
          registrationVersion: 1,
        }),
      ).rejects.toThrow('audit outbox unavailable');

      expect(mocks.adapterMock.listWebhooks).not.toHaveBeenCalled();
      expect(mocks.adapterMock.refreshWebhook).not.toHaveBeenCalled();
      expect(mocks.adapterMock.registerWebhook).not.toHaveBeenCalled();
    });

    const event = {
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      registrationVersion: 2,
    };

    function registerPendingWebhook() {
      return (
        service as unknown as {
          registerPendingWebhook: (input: typeof event) => Promise<void>;
        }
      ).registerPendingWebhook.call(service, event);
    }

    it('registers the current version, completes it with CAS, and treats old cleanup as best-effort', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: 'old-webhook-id',
          webhookCloudId: 'old-cloud-id',
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.completeWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: 'new-webhook-id',
          webhookRegistrationStatus: 'registered',
          webhookRegistrationVersion: 2,
        }),
      );
      mocks.adapterMock.registerWebhook.mockResolvedValue('new-webhook-id');
      mocks.adapterMock.deleteWebhook.mockRejectedValue(new Error('old cleanup unavailable'));

      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.registerWebhook).toHaveBeenCalledWith(
        CLOUD_ID,
        'decrypted-access-token',
        'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
      );
      expect(mocks.repoMock.completeWebhookRegistration).toHaveBeenCalledWith(
        {
          id: CONN_ID,
          organizationId: ORG_ID,
          registrationVersion: 2,
          webhookSecret: 'wh-secret-123',
          webhookId: 'new-webhook-id',
          webhookCloudId: CLOUD_ID,
        },
        expect.any(Function),
      );
      expect(mocks.adapterMock.deleteWebhook).toHaveBeenCalledWith(
        'old-cloud-id',
        'decrypted-access-token',
        'old-webhook-id',
      );
    });

    it('no-ops a stale reconnect event before making any Jira call', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 3,
        }),
      );

      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.registerWebhook).not.toHaveBeenCalled();
      expect(mocks.repoMock.completeWebhookRegistration).not.toHaveBeenCalled();
    });

    it('refreshes the exact active Jira webhook before completing a due renewal', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: 'active-webhook-id',
          webhookCloudId: CLOUD_ID,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );
      mocks.adapterMock.listWebhooks.mockResolvedValue([
        {
          id: 'active-webhook-id',
          url: 'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
          events: ['jira:issue_updated'],
          jqlFilter: '*',
        },
      ]);
      mocks.repoMock.completeWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: 'active-webhook-id',
          webhookCloudId: CLOUD_ID,
          webhookRegistrationStatus: 'registered',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: new Date(),
        }),
      );

      await expect(
        (
          service as unknown as {
            registerPendingWebhook: (
              input: typeof event & { operation: 'renewal' },
            ) => Promise<void>;
          }
        ).registerPendingWebhook.call(service, { ...event, operation: 'renewal' }),
      ).resolves.toBeUndefined();

      expect(mocks.adapterMock.refreshWebhook).toHaveBeenCalledWith(
        CLOUD_ID,
        'decrypted-access-token',
        'active-webhook-id',
      );
      expect(mocks.adapterMock.registerWebhook).not.toHaveBeenCalled();
      expect(mocks.repoMock.completeWebhookRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: 'active-webhook-id' }),
        expect.any(Function),
      );
    });

    it('propagates a renewal refresh failure without claiming a new registered timestamp', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: 'active-webhook-id',
          webhookCloudId: CLOUD_ID,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );
      mocks.adapterMock.listWebhooks.mockResolvedValue([
        {
          id: 'active-webhook-id',
          url: 'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
          events: ['jira:issue_updated'],
          jqlFilter: '*',
        },
      ]);
      mocks.adapterMock.refreshWebhook.mockRejectedValue(new Error('Jira refresh unavailable'));

      await expect(
        (
          service as unknown as {
            registerPendingWebhook: (
              input: typeof event & { operation: 'renewal' },
            ) => Promise<void>;
          }
        ).registerPendingWebhook.call(service, { ...event, operation: 'renewal' }),
      ).rejects.toThrow('Jira refresh unavailable');

      expect(mocks.repoMock.completeWebhookRegistration).not.toHaveBeenCalled();
    });

    it('leaves a reusable webhook intact when a newer reconnect wins the completion CAS', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValueOnce(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValueOnce(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 3,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.completeWebhookRegistration.mockResolvedValue(undefined);
      mocks.adapterMock.registerWebhook.mockResolvedValue('orphan-webhook-id');

      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.deleteWebhook).not.toHaveBeenCalledWith(
        CLOUD_ID,
        expect.any(String),
        'orphan-webhook-id',
      );
    });

    it('treats a commit-then-throw response as success after an exact tenant-scoped reread', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValueOnce(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValueOnce(
        makeConnection({
          webhookId: 'committed-webhook-id',
          webhookCloudId: CLOUD_ID,
          webhookRegistrationStatus: 'registered',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: new Date(),
        }),
      );
      mocks.repoMock.completeWebhookRegistration.mockRejectedValue(
        new Error('connection dropped after commit'),
      );
      mocks.adapterMock.registerWebhook.mockResolvedValue('committed-webhook-id');

      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.deleteWebhook).not.toHaveBeenCalledWith(
        CLOUD_ID,
        expect.any(String),
        'committed-webhook-id',
      );
    });

    it('propagates an ambiguous CAS error without deleting a possible committed winner when reread is unavailable', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValueOnce(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.repoMock.findConnectionForWebhookRegistration.mockRejectedValueOnce(
        new Error('registration reread unavailable'),
      );
      mocks.repoMock.completeWebhookRegistration.mockRejectedValue(
        new Error('registration state write unavailable'),
      );
      mocks.adapterMock.registerWebhook.mockResolvedValue('possibly-committed-webhook-id');

      await expect(registerPendingWebhook()).rejects.toThrow(
        'registration state write unavailable',
      );

      expect(mocks.adapterMock.deleteWebhook).not.toHaveBeenCalledWith(
        CLOUD_ID,
        expect.any(String),
        'possibly-committed-webhook-id',
      );
    });

    it('reuses a webhook discovered after a crash instead of registering a duplicate on retry', async () => {
      const pendingConnection = makeConnection({
        webhookId: null,
        webhookCloudId: null,
        webhookRegistrationStatus: 'pending',
        webhookRegistrationVersion: 2,
        webhookRegisteredAt: null,
      });
      mocks.repoMock.findConnectionForWebhookRegistration
        .mockResolvedValueOnce(pendingConnection)
        .mockResolvedValueOnce(pendingConnection)
        .mockResolvedValueOnce(pendingConnection);
      mocks.repoMock.completeWebhookRegistration
        .mockRejectedValueOnce(new Error('registration state write unavailable'))
        .mockResolvedValueOnce(
          makeConnection({
            webhookId: 'crash-survivor-id',
            webhookCloudId: CLOUD_ID,
            webhookRegistrationStatus: 'registered',
            webhookRegistrationVersion: 2,
          }),
        );
      mocks.adapterMock.listWebhooks.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'crash-survivor-id',
          url: 'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
          events: ['jira:issue_updated'],
          jqlFilter: '*',
        },
      ]);
      mocks.adapterMock.registerWebhook.mockResolvedValue('crash-survivor-id');

      await expect(registerPendingWebhook()).rejects.toThrow(
        'registration state write unavailable',
      );
      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.registerWebhook).toHaveBeenCalledTimes(1);
      expect(mocks.repoMock.completeWebhookRegistration).toHaveBeenLastCalledWith(
        expect.objectContaining({ webhookId: 'crash-survivor-id' }),
        expect.any(Function),
      );
      expect(mocks.adapterMock.deleteWebhook).not.toHaveBeenCalledWith(
        CLOUD_ID,
        expect.any(String),
        'crash-survivor-id',
      );
    });

    it('does not reuse an exact callback whose JQL filter would miss findings', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.adapterMock.listWebhooks.mockResolvedValue([
        {
          id: 'narrow-webhook-id',
          url: 'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
          events: ['jira:issue_updated'],
          jqlFilter: 'project = SEC',
        },
      ]);
      mocks.adapterMock.registerWebhook.mockResolvedValue('complete-webhook-id');
      mocks.repoMock.completeWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: 'complete-webhook-id',
          webhookCloudId: CLOUD_ID,
          webhookRegistrationStatus: 'registered',
          webhookRegistrationVersion: 2,
        }),
      );

      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.registerWebhook).toHaveBeenCalledTimes(1);
      expect(mocks.adapterMock.deleteWebhook).toHaveBeenCalledWith(
        CLOUD_ID,
        'decrypted-access-token',
        'narrow-webhook-id',
      );
    });

    it('keeps the canonical webhook active when bounded duplicate cleanup fails', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: null,
          webhookCloudId: null,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.adapterMock.listWebhooks.mockResolvedValue([
        {
          id: '100',
          url: 'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
          events: ['jira:issue_updated'],
          jqlFilter: '*',
        },
        {
          id: '101',
          url: 'https://app.example.com/api/v1/ticketing/jira/webhook/wh-secret-123',
          events: ['jira:issue_updated'],
          jqlFilter: '*',
        },
      ]);
      mocks.repoMock.completeWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookId: '100',
          webhookCloudId: CLOUD_ID,
          webhookRegistrationStatus: 'registered',
          webhookRegistrationVersion: 2,
        }),
      );
      mocks.adapterMock.deleteWebhook.mockRejectedValue(new Error('duplicate cleanup unavailable'));

      await expect(registerPendingWebhook()).resolves.toBeUndefined();

      expect(mocks.adapterMock.registerWebhook).not.toHaveBeenCalled();
      expect(mocks.adapterMock.deleteWebhook).toHaveBeenCalledWith(
        CLOUD_ID,
        'decrypted-access-token',
        '101',
      );
      expect(mocks.adapterMock.deleteWebhook).not.toHaveBeenCalledWith(
        CLOUD_ID,
        expect.any(String),
        '100',
      );
    });

    it('propagates registration failures so the outbox retries and can dead-letter', async () => {
      mocks.repoMock.findConnectionForWebhookRegistration.mockResolvedValue(
        makeConnection({
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 2,
          webhookRegisteredAt: null,
        }),
      );
      mocks.adapterMock.registerWebhook.mockRejectedValue(
        new Error('Jira registration unavailable'),
      );

      await expect(registerPendingWebhook()).rejects.toThrow('Jira registration unavailable');

      expect(mocks.repoMock.completeWebhookRegistration).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getTicketLink
  // -----------------------------------------------------------------------

  describe('getTicketLink', () => {
    it('returns ticket link when it exists', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      const result = await service.getTicketLink(ORG_ID, TRIAGE_ID);

      expect(result).toBeTruthy();
      expect(result!.externalId).toBe('SEC-42');
    });

    it('returns null when no ticket link exists', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);

      const result = await service.getTicketLink(ORG_ID, TRIAGE_ID);

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // createTicket
  // -----------------------------------------------------------------------

  describe('createTicket', () => {
    it('does not call Jira when the transactional creation-intent audit fails', async () => {
      mocks.auditLogMock.recordDurableWithExecutor.mockRejectedValueOnce(
        new Error('audit outbox unavailable'),
      );

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'finding-1',
            title: 'SQL injection',
            description: 'Description',
            severity: 'high',
          },
          1,
        ),
      ).rejects.toThrow('audit outbox unavailable');

      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
    });

    it('calls Jira adapter createIssue with correct payload', async () => {
      const findingData = {
        findingOpensearchId: 'f-1',
        title: 'SQL Injection in login',
        description: 'Found SQL injection vulnerability',
        severity: 'high',
      };

      await service.createTicket(ORG_ID, TRIAGE_ID, findingData, 7);

      expect(mocks.adapterMock.createIssue).toHaveBeenCalledTimes(1);
      const [cloudId, _token, input] = mocks.adapterMock.createIssue.mock.calls[0]! as any[];
      expect(cloudId).toBe(CLOUD_ID);
      expect(input.projectKey).toBe('SEC');
      expect(input.issueTypeId).toBe('10001');
      expect(input.summary).toContain('[HIGH]');
      expect(input.summary).toContain('SQL Injection in login');
    });

    it('reserves before sending and finalizes the ticket link after Jira responds', async () => {
      await service.createTicket(
        ORG_ID,
        TRIAGE_ID,
        {
          findingOpensearchId: 'f-1',
          title: 'Test Finding',
          description: 'Description',
        },
        7,
      );

      expect(mocks.repoMock.reserveTicketCreation).toHaveBeenCalledWith(
        {
          findingTriageId: TRIAGE_ID,
          organizationId: ORG_ID,
          provider: 'jira',
          metadata: {
            lastAttemptedProjectionVersion: 7,
            retryPayload: {
              findingOpensearchId: 'f-1',
              title: 'Test Finding',
              description: 'Description',
            },
          },
        },
        expect.any(Function),
      );
      const [data] = mocks.repoMock.finalizeTicketCreation.mock.calls[0]! as any[];
      expect(data.externalId).toBe('SEC-42');
      expect(data.metadata.lastAppliedProjectionVersion).toBe(7);
      expect(mocks.repoMock.updateTicketLink).not.toHaveBeenCalled();
    });

    it('does not resend when a prior ticket attempt has an ambiguous outcome', async () => {
      mocks.repoMock.reserveTicketCreation.mockResolvedValue({
        acquired: false,
        record: makeTicketLink({
          externalId: `sentris-pending:${TRIAGE_ID}`,
          externalUrl: '',
          syncStatus: 'unknown',
        }),
      });

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow('manual reconciliation is required');
      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
    });

    it('marks a network-ambiguous create unknown and prevents an automatic duplicate', async () => {
      mocks.adapterMock.createIssue.mockRejectedValue(new Error('request timeout'));

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow('request timeout');

      expect(mocks.repoMock.markTicketCreationUnknown).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'link-1',
          findingTriageId: TRIAGE_ID,
          organizationId: ORG_ID,
        }),
      );
      expect(mocks.repoMock.releaseTicketCreationReservation).not.toHaveBeenCalled();
    });

    it('does not overwrite an operator resolution when finalization loses the pending CAS', async () => {
      mocks.repoMock.finalizeTicketCreation.mockResolvedValue(undefined);
      mocks.repoMock.markTicketCreationUnknown.mockResolvedValue(undefined);

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow('local reservation was no longer pending');

      expect(mocks.repoMock.markTicketCreationUnknown).not.toHaveBeenCalled();
      expect(mocks.repoMock.updateTicketLink).not.toHaveBeenCalled();
    });

    it('releases the reservation after a definite Jira rejection so retry stays useful', async () => {
      mocks.adapterMock.createIssue.mockRejectedValue(new JiraApiError(429, 'rate limited'));

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow(JiraApiError);

      expect(mocks.repoMock.releaseTicketCreationReservation).toHaveBeenCalledWith({
        id: 'link-1',
        findingTriageId: TRIAGE_ID,
        organizationId: ORG_ID,
        provider: 'jira',
      });
    });

    it('releases the reservation when resource preflight fails before Jira creation starts', async () => {
      mocks.adapterMock.getAccessibleResources.mockRejectedValueOnce(
        new Error('resource lookup unavailable'),
      );

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow('resource lookup unavailable');

      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
      expect(mocks.repoMock.releaseTicketCreationReservation).toHaveBeenCalledWith({
        id: 'link-1',
        findingTriageId: TRIAGE_ID,
        organizationId: ORG_ID,
        provider: 'jira',
      });
      expect(mocks.repoMock.updateTicketLink).not.toHaveBeenCalledWith(
        'link-1',
        expect.objectContaining({ syncStatus: 'unknown' }),
      );
    });

    it('releases the reservation when token preparation fails before the Jira POST starts', async () => {
      mocks.encryptionMock.decrypt
        .mockResolvedValueOnce('preflight-access-token')
        .mockRejectedValueOnce(new Error('token decrypt unavailable'));

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow('token decrypt unavailable');

      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
      expect(mocks.repoMock.releaseTicketCreationReservation).toHaveBeenCalledTimes(1);
      expect(mocks.repoMock.markTicketCreationUnknown).not.toHaveBeenCalled();
    });

    it('releases the reservation when a definite 401 is followed by refresh preparation failure', async () => {
      mocks.adapterMock.createIssue.mockRejectedValueOnce(
        new JiraApiError(401, 'expired access token'),
      );
      const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('token endpoint unavailable'),
      );

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test Finding',
            description: 'Description',
          },
          7,
        ),
      ).rejects.toThrow('token endpoint unavailable');
      fetchSpy.mockRestore();

      expect(mocks.adapterMock.createIssue).toHaveBeenCalledTimes(1);
      expect(mocks.repoMock.releaseTicketCreationReservation).toHaveBeenCalledTimes(1);
      expect(mocks.repoMock.markTicketCreationUnknown).not.toHaveBeenCalled();
    });

    it('refreshes before creation without replaying the Jira POST when resource lookup returns 401', async () => {
      mocks.adapterMock.getAccessibleResources.mockRejectedValueOnce(
        new JiraApiError(401, 'expired access token'),
      );
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600 }),
          { status: 200 },
        ),
      );

      await service.createTicket(
        ORG_ID,
        TRIAGE_ID,
        {
          findingOpensearchId: 'f-1',
          title: 'Test Finding',
          description: 'Description',
        },
        7,
      );
      fetchSpy.mockRestore();

      expect(mocks.adapterMock.getAccessibleResources).toHaveBeenCalledTimes(2);
      expect(mocks.adapterMock.createIssue).toHaveBeenCalledTimes(1);
    });

    it('throws when connection is not configured', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(
        makeConnection({ config: { projectKey: '', issueTypeId: '' } }),
      );

      await expect(
        service.createTicket(
          ORG_ID,
          TRIAGE_ID,
          {
            findingOpensearchId: 'f-1',
            title: 'Test',
            description: 'Desc',
          },
          7,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // updateTicketStatus
  // -----------------------------------------------------------------------

  describe('updateTicketStatus', () => {
    it('does not transition Jira when durable transition audit acceptance fails', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      mocks.auditLogMock.recordDurable.mockRejectedValueOnce(new Error('audit outbox unavailable'));

      await expect(service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress', 7)).rejects.toThrow(
        'audit outbox unavailable',
      );

      expect(mocks.adapterMock.transitionIssue).not.toHaveBeenCalled();
    });

    it('calls transitionIssue with mapped Jira status', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress', 7);

      expect(mocks.adapterMock.transitionIssue).toHaveBeenCalledTimes(1);
      const [cloudId, _token, issueKey, transitionName] = mocks.adapterMock.transitionIssue.mock
        .calls[0]! as any[];
      expect(cloudId).toBe(CLOUD_ID);
      expect(issueKey).toBe('SEC-42');
      expect(transitionName).toBe('In Progress');
    });

    it('passes distinct transition and resulting status names for replay-safe mappings', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(
        makeConnection({
          config: {
            projectKey: 'SEC',
            issueTypeId: '10001',
            statusMapping: {
              fixed: {
                transitionName: 'Resolve issue',
                resultingStatus: 'Done',
              },
            },
            autoCreateOnStatuses: ['triaged'],
          },
        }),
      );

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7);

      expect(mocks.adapterMock.transitionIssue).toHaveBeenCalledWith(
        CLOUD_ID,
        expect.any(String),
        'SEC-42',
        'Resolve issue',
        'Done',
      );
    });

    it('updates ticket link sync status to synced after success', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7);

      expect(mocks.repoMock.updateTicketLink).toHaveBeenCalledTimes(1);
      const [linkId, data] = mocks.repoMock.updateTicketLink.mock.calls[0]! as any[];
      expect(linkId).toBe('link-1');
      expect(data.syncStatus).toBe('synced');
      expect(data.metadata.lastAppliedProjectionVersion).toBe(7);
    });

    it('does not apply a stale version when called outside the listener', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(
        makeTicketLink({ metadata: { lastAppliedProjectionVersion: 8 } }),
      );

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7);

      expect(mocks.adapterMock.transitionIssue).not.toHaveBeenCalled();
      expect(mocks.repoMock.updateTicketLink).not.toHaveBeenCalled();
    });

    it('marks ticket link as error when transition fails', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      mocks.adapterMock.transitionIssue.mockResolvedValue(false);

      await expect(service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7)).rejects.toThrow(
        "Transition 'Done' not available",
      );

      expect(mocks.repoMock.updateTicketLink).toHaveBeenCalledTimes(1);
      const [, data] = mocks.repoMock.updateTicketLink.mock.calls[0]! as any[];
      expect(data.syncStatus).toBe('error');
    });

    it('skips when no ticket link exists', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7);

      expect(mocks.adapterMock.transitionIssue).not.toHaveBeenCalled();
    });

    it('records a configuration error and throws when the Jira cloud ID is missing', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(makeConnection({ cloudId: null }));
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      await expect(service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7)).rejects.toThrow(
        'Jira cloud ID is not set',
      );

      expect(mocks.repoMock.updateTicketLink).toHaveBeenCalledWith(
        'link-1',
        expect.objectContaining({
          syncStatus: 'error',
          metadata: expect.objectContaining({
            lastError: 'Jira cloud ID is not set',
          }),
        }),
      );
      expect(mocks.adapterMock.transitionIssue).not.toHaveBeenCalled();
    });

    it('skips when no status mapping exists for the status', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(
        makeConnection({
          config: {
            projectKey: 'SEC',
            issueTypeId: '10001',
            statusMapping: {},
            autoCreateOnStatuses: ['triaged'],
          },
        }),
      );

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed', 7);

      expect(mocks.adapterMock.transitionIssue).not.toHaveBeenCalled();
      expect(mocks.repoMock.updateTicketLink).toHaveBeenCalledWith(
        'link-1',
        expect.objectContaining({
          metadata: expect.objectContaining({ lastAppliedProjectionVersion: 7 }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Ambiguous create reconciliation
  // -----------------------------------------------------------------------

  describe('reconcileTicketCreation', () => {
    const retryPayload = {
      findingOpensearchId: 'f-1',
      title: 'Test Finding',
      description: 'Description',
      severity: 'high',
    };

    function makeUnresolvedLink() {
      return makeTicketLink({
        externalId: `sentris-pending:${TRIAGE_ID}`,
        externalUrl: '',
        syncStatus: 'unknown',
        metadata: {
          lastAttemptedProjectionVersion: 7,
          reconciliationRequired: true,
          retryPayload,
        },
      });
    }

    it('attaches an externally verified Jira issue to the unresolved intent', async () => {
      mocks.repoMock.findUnresolvedTicketIntent.mockResolvedValue(makeUnresolvedLink());
      mocks.repoMock.attachUnresolvedTicketIntent.mockResolvedValue(
        makeTicketLink({ metadata: { jiraIssueId: '12345', lastAppliedProjectionVersion: 7 } }),
      );

      const result = await service.reconcileTicketCreation(makeAuth(), TRIAGE_ID, {
        action: 'attach',
        issueKey: 'SEC-42',
      });

      expect(result).toEqual(
        expect.objectContaining({
          action: 'attach',
          status: 'attached',
          findingTriageId: TRIAGE_ID,
          ticket: expect.objectContaining({ externalId: 'SEC-42' }),
        }),
      );
      expect(mocks.adapterMock.getIssue).toHaveBeenCalledWith(
        CLOUD_ID,
        'decrypted-access-token',
        'SEC-42',
      );
      expect(mocks.repoMock.attachUnresolvedTicketIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'link-1',
          findingTriageId: TRIAGE_ID,
          organizationId: ORG_ID,
          outboxAggregateId: 'f-1',
          externalId: 'SEC-42',
          externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
          metadata: expect.objectContaining({
            jiraIssueId: '12345',
            lastAppliedProjectionVersion: 7,
            reconciliationRequired: false,
          }),
        }),
        expect.any(Function),
      );
    });

    it('denies reconciliation when the unresolved intent belongs to another tenant', async () => {
      mocks.repoMock.findUnresolvedTicketIntent.mockResolvedValue(undefined);

      await expect(
        service.reconcileTicketCreation(makeAuth('org-other'), TRIAGE_ID, {
          action: 'attach',
          issueKey: 'SEC-42',
        }),
      ).rejects.toThrow('Unresolved Jira ticket creation intent not found');

      expect(mocks.adapterMock.getIssue).not.toHaveBeenCalled();
      expect(mocks.repoMock.attachUnresolvedTicketIntent).not.toHaveBeenCalled();
    });

    it('denies clear-and-retry across tenants with the same generic not-found response', async () => {
      mocks.repoMock.findUnresolvedTicketIntent.mockResolvedValue(undefined);

      await expect(
        service.reconcileTicketCreation(makeAuth('org-other'), TRIAGE_ID, {
          action: 'clear_and_retry',
          confirmedNoIssueExists: true,
        }),
      ).rejects.toThrow('Unresolved Jira ticket creation intent not found');

      expect(mocks.repoMock.clearUnresolvedTicketIntent).not.toHaveBeenCalled();
      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
    });

    it('atomically clears an operator-confirmed unknown intent and queues one durable retry', async () => {
      const unresolved = makeUnresolvedLink();
      mocks.repoMock.findUnresolvedTicketIntent
        .mockResolvedValueOnce(unresolved)
        .mockResolvedValueOnce(undefined);
      mocks.repoMock.clearUnresolvedTicketIntent.mockResolvedValue(unresolved);

      const result = await service.reconcileTicketCreation(makeAuth(), TRIAGE_ID, {
        action: 'clear_and_retry',
        confirmedNoIssueExists: true,
      });

      await expect(
        service.reconcileTicketCreation(makeAuth(), TRIAGE_ID, {
          action: 'clear_and_retry',
          confirmedNoIssueExists: true,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mocks.repoMock.clearUnresolvedTicketIntent).toHaveBeenCalledWith(
        {
          id: 'link-1',
          findingTriageId: TRIAGE_ID,
          organizationId: ORG_ID,
          provider: 'jira',
          outboxAggregateId: 'f-1',
        },
        expect.any(Function),
      );
      expect(result).toEqual({
        action: 'clear_and_retry',
        status: 'retry_queued',
        findingTriageId: TRIAGE_ID,
        ticket: null,
      });
      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
    });

    it('durably audits attach inside the same repository transaction', async () => {
      const unresolved = makeUnresolvedLink();
      const attached = makeTicketLink({
        metadata: { jiraIssueId: '12345', lastAppliedProjectionVersion: 7 },
      });
      const transactionExecutor = { insert: mock(() => undefined) };
      mocks.repoMock.findUnresolvedTicketIntent.mockResolvedValue(unresolved);
      mocks.repoMock.attachUnresolvedTicketIntent.mockImplementation(
        async (_input: unknown, onMutated: any) => {
          await onMutated(transactionExecutor, attached);
          return attached;
        },
      );

      await service.reconcileTicketCreation(makeAuth(), TRIAGE_ID, {
        action: 'attach',
        issueKey: 'SEC-42',
      });

      expect(mocks.auditLogMock.recordDurableWithExecutor).toHaveBeenCalledWith(
        transactionExecutor,
        expect.objectContaining({ userId: USER_ID, organizationId: ORG_ID }),
        {
          action: 'ticketing.reconcile.attach',
          resourceType: 'finding_triage',
          resourceId: TRIAGE_ID,
          metadata: {
            provider: 'jira',
            issueKey: 'SEC-42',
          },
        },
      );
    });

    it('durably audits clear-and-retry inside the same repository transaction', async () => {
      const unresolved = makeUnresolvedLink();
      const transactionExecutor = { insert: mock(() => undefined) };
      mocks.repoMock.findUnresolvedTicketIntent.mockResolvedValue(unresolved);
      mocks.repoMock.clearUnresolvedTicketIntent.mockImplementation(
        async (_input: unknown, onMutated: any) => {
          await onMutated(transactionExecutor, unresolved);
          return unresolved;
        },
      );

      await service.reconcileTicketCreation(makeAuth(), TRIAGE_ID, {
        action: 'clear_and_retry',
        confirmedNoIssueExists: true,
      });

      expect(mocks.auditLogMock.recordDurableWithExecutor).toHaveBeenCalledWith(
        transactionExecutor,
        expect.objectContaining({ userId: USER_ID, organizationId: ORG_ID }),
        {
          action: 'ticketing.reconcile.clear_and_retry',
          resourceType: 'finding_triage',
          resourceId: TRIAGE_ID,
          metadata: {
            provider: 'jira',
          },
        },
      );
    });

    it('returns a conflict when no durable triage event can be recovered for retry', async () => {
      mocks.repoMock.findUnresolvedTicketIntent.mockResolvedValue(makeUnresolvedLink());
      mocks.repoMock.clearUnresolvedTicketIntent.mockRejectedValue(
        new TicketReconciliationEventUnavailableError(),
      );

      await expect(
        service.reconcileTicketCreation(makeAuth(), TRIAGE_ID, {
          action: 'clear_and_retry',
          confirmedNoIssueExists: true,
        }),
      ).rejects.toThrow(ConflictException);

      expect(mocks.adapterMock.createIssue).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Token refresh
  // -----------------------------------------------------------------------

  describe('token refresh on 401', () => {
    it('does not submit refresh credentials when durable refresh audit acceptance fails', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      mocks.adapterMock.transitionIssue.mockRejectedValueOnce(
        new JiraApiError(401, 'Unauthorized'),
      );
      mocks.auditLogMock.recordDurable.mockRejectedValueOnce(new Error('audit outbox unavailable'));
      const fetchSpy = spyOn(globalThis, 'fetch');

      await expect(service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress', 7)).rejects.toThrow(
        'audit outbox unavailable',
      );

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('retries after refreshing token when adapter returns 401', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      // First call throws 401, second succeeds
      let callCount = 0;
      mocks.adapterMock.transitionIssue.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new JiraApiError(401, 'Unauthorized');
        }
        return Promise.resolve(true);
      });

      // Mock the fetch for token refresh
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600 }),
          { status: 200 },
        ),
      );

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress', 7);

      // transitionIssue called twice (first fails with 401, second succeeds)
      expect(mocks.adapterMock.transitionIssue).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });

    it('reloads the connection before a 401 refresh so rotated refresh tokens win', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      const stale = makeConnection({
        refreshToken: { keyId: 'stale-refresh' },
      });
      const latest = makeConnection({
        refreshToken: { keyId: 'rotated-refresh' },
      });
      mocks.repoMock.findConnectionByOrg
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(latest)
        .mockResolvedValue(latest);
      mocks.encryptionMock.decrypt.mockImplementation((value: any) => {
        if (value?.keyId === 'rotated-refresh') return Promise.resolve('rotated-refresh-token');
        if (value?.keyId === 'stale-refresh') return Promise.resolve('stale-refresh-token');
        return Promise.resolve('decrypted-access-token');
      });
      mocks.adapterMock.transitionIssue
        .mockRejectedValueOnce(new JiraApiError(401, 'Unauthorized'))
        .mockResolvedValueOnce(true);
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'new-at', expires_in: 3600 }), {
          status: 200,
        }),
      );

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress', 7);

      expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual(
        expect.objectContaining({ refresh_token: 'rotated-refresh-token' }),
      );
      fetchSpy.mockRestore();
    });
  });
});
