import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { TicketingService } from '../ticketing.service';
import type { TicketingRepository } from '../ticketing.repository';
import type { JiraAdapter } from '../jira/jira.adapter';
import { JiraApiError } from '../jira/jira.adapter';
import type { TokenEncryptionService } from '../../integrations/token.encryption';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-1';
const USER_ID = 'user-test-1';
const CONN_ID = 'conn-1';
const CLOUD_ID = 'cloud-abc123';
const TRIAGE_ID = 'triage-uuid-1';

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
  const repoMock = {
    findConnectionByOrg: mock((): any => Promise.resolve(makeConnection())),
    createConnection: mock((): any => Promise.resolve(makeConnection())),
    updateConnection: mock((): any => Promise.resolve(makeConnection())),
    deleteConnection: mock((): any => Promise.resolve()),
    findTicketLinkByTriageId: mock((): any => Promise.resolve(undefined)),
    findTicketLinkByExternalId: mock((): any => Promise.resolve(undefined)),
    createTicketLink: mock((): any => Promise.resolve(makeTicketLink())),
    updateTicketLink: mock((): any => Promise.resolve(makeTicketLink())),
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
    registerWebhook: mock((): any => Promise.resolve('wh-id-1')),
  };

  const encryptionMock = {
    encrypt: mock((val: string): any =>
      Promise.resolve({ iv: 'iv', data: `enc-${val}`, tag: 'tag' }),
    ),
    decrypt: mock((): any => Promise.resolve('decrypted-access-token')),
  };

  const configMock = {
    get: mock((key: string, def?: string): any => {
      const config: Record<string, string> = {
        JIRA_CLIENT_ID: 'client-id',
        JIRA_CLIENT_SECRET: 'client-secret',
        JIRA_CALLBACK_URL: 'https://app.example.com/api/v1/ticketing/callback',
      };
      return config[key] ?? def ?? '';
    }),
  };

  return { repoMock, adapterMock, encryptionMock, configMock };
}

function createService(mocks: ReturnType<typeof createMocks>, redis: MockRedis | null = null) {
  return new TicketingService(
    mocks.repoMock as unknown as TicketingRepository,
    mocks.adapterMock as unknown as JiraAdapter,
    mocks.encryptionMock as unknown as TokenEncryptionService,
    mocks.configMock as any,
    redis as any,
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
  });

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------

  describe('disconnect', () => {
    it('calls repository deleteConnection', async () => {
      await service.disconnect(ORG_ID);

      expect(mocks.repoMock.deleteConnection).toHaveBeenCalledWith(ORG_ID);
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

      expect(mocks.repoMock.updateConnection).toHaveBeenCalledWith(CONN_ID, { config });
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

  // -----------------------------------------------------------------------
  // getTicketLink
  // -----------------------------------------------------------------------

  describe('getTicketLink', () => {
    it('returns ticket link when it exists', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      const result = await service.getTicketLink(TRIAGE_ID);

      expect(result).toBeTruthy();
      expect(result!.externalId).toBe('SEC-42');
    });

    it('returns null when no ticket link exists', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);

      const result = await service.getTicketLink(TRIAGE_ID);

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // createTicket
  // -----------------------------------------------------------------------

  describe('createTicket', () => {
    it('calls Jira adapter createIssue with correct payload', async () => {
      const findingData = {
        findingOpensearchId: 'f-1',
        title: 'SQL Injection in login',
        description: 'Found SQL injection vulnerability',
        severity: 'high',
      };

      await service.createTicket(ORG_ID, TRIAGE_ID, findingData);

      expect(mocks.adapterMock.createIssue).toHaveBeenCalledTimes(1);
      const [cloudId, _token, input] = mocks.adapterMock.createIssue.mock.calls[0]! as any[];
      expect(cloudId).toBe(CLOUD_ID);
      expect(input.projectKey).toBe('SEC');
      expect(input.issueTypeId).toBe('10001');
      expect(input.summary).toContain('[HIGH]');
      expect(input.summary).toContain('SQL Injection in login');
    });

    it('stores ticket link in repository', async () => {
      await service.createTicket(ORG_ID, TRIAGE_ID, {
        findingOpensearchId: 'f-1',
        title: 'Test Finding',
        description: 'Description',
      });

      expect(mocks.repoMock.createTicketLink).toHaveBeenCalledTimes(1);
      const [data] = mocks.repoMock.createTicketLink.mock.calls[0]! as any[];
      expect(data.findingTriageId).toBe(TRIAGE_ID);
      expect(data.externalId).toBe('SEC-42');
      expect(data.syncStatus).toBe('synced');
      expect(data.provider).toBe('jira');
    });

    it('throws when connection is not configured', async () => {
      mocks.repoMock.findConnectionByOrg.mockResolvedValue(
        makeConnection({ config: { projectKey: '', issueTypeId: '' } }),
      );

      await expect(
        service.createTicket(ORG_ID, TRIAGE_ID, {
          findingOpensearchId: 'f-1',
          title: 'Test',
          description: 'Desc',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // updateTicketStatus
  // -----------------------------------------------------------------------

  describe('updateTicketStatus', () => {
    it('calls transitionIssue with mapped Jira status', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress');

      expect(mocks.adapterMock.transitionIssue).toHaveBeenCalledTimes(1);
      const [cloudId, _token, issueKey, transitionName] = mocks.adapterMock.transitionIssue.mock
        .calls[0]! as any[];
      expect(cloudId).toBe(CLOUD_ID);
      expect(issueKey).toBe('SEC-42');
      expect(transitionName).toBe('In Progress');
    });

    it('updates ticket link sync status to synced after success', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed');

      expect(mocks.repoMock.updateTicketLink).toHaveBeenCalledTimes(1);
      const [linkId, data] = mocks.repoMock.updateTicketLink.mock.calls[0]! as any[];
      expect(linkId).toBe('link-1');
      expect(data.syncStatus).toBe('synced');
    });

    it('marks ticket link as error when transition fails', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
      mocks.adapterMock.transitionIssue.mockResolvedValue(false);

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed');

      expect(mocks.repoMock.updateTicketLink).toHaveBeenCalledTimes(1);
      const [, data] = mocks.repoMock.updateTicketLink.mock.calls[0]! as any[];
      expect(data.syncStatus).toBe('error');
    });

    it('skips when no ticket link exists', async () => {
      mocks.repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed');

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

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'fixed');

      expect(mocks.adapterMock.transitionIssue).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Token refresh
  // -----------------------------------------------------------------------

  describe('token refresh on 401', () => {
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

      await service.updateTicketStatus(ORG_ID, TRIAGE_ID, 'in_progress');

      // transitionIssue called twice (first fails with 401, second succeeds)
      expect(mocks.adapterMock.transitionIssue).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });
  });
});
