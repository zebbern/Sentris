import { UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { TicketingController } from '../ticketing.controller';
import type { ReconcileTicketCreationResult, TicketingService } from '../ticketing.service';
import type { AuthContext } from '../../auth/types';
import { AUTH_ROLES_KEY } from '../../auth/roles.decorator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-ctrl-1';
const USER_ID = 'user-ctrl-1';

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    isAuthenticated: true,
    userId: USER_ID,
    organizationId: ORG_ID,
    roles: ['ADMIN'],
    provider: 'local',
    ...overrides,
  } as AuthContext;
}

function makeConnectionStatus(isConnected = true) {
  return {
    id: isConnected ? 'conn-1' : null,
    provider: 'jira' as const,
    isConnected,
    cloudId: isConnected ? 'cloud-abc' : null,
    config: isConnected
      ? {
          projectKey: 'SEC',
          issueTypeId: '10001',
          statusMapping: { triaged: 'Open' },
          autoCreateOnStatuses: ['triaged'],
        }
      : null,
    createdAt: isConnected ? '2025-01-01T00:00:00.000Z' : null,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createServiceMock() {
  return {
    getConnection: mock(() => Promise.resolve(makeConnectionStatus())),
    startOAuthFlow: mock(() => ({
      authorizationUrl: 'https://auth.atlassian.com/authorize?...',
      state: 'state-uuid',
    })),
    handleOAuthCallback: mock(() => Promise.resolve({ success: true })),
    disconnect: mock(() => Promise.resolve()),
    updateConfig: mock(() => Promise.resolve(makeConnectionStatus())),
    listProjects: mock(() =>
      Promise.resolve([
        {
          id: '1',
          key: 'SEC',
          name: 'Security',
          avatarUrl: null,
        },
      ]),
    ),
    listIssueTypes: mock(() =>
      Promise.resolve([
        {
          id: '10001',
          name: 'Bug',
          description: 'A bug',
          iconUrl: null,
        },
      ]),
    ),
    reconcileTicketCreation: mock(
      (): Promise<ReconcileTicketCreationResult> =>
        Promise.resolve({
          action: 'attach' as const,
          status: 'attached' as const,
          findingTriageId: '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48',
          ticket: {
            id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
            findingTriageId: '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48',
            organizationId: ORG_ID,
            provider: 'jira',
            externalId: 'SEC-42',
            externalUrl: 'https://example.atlassian.net/browse/SEC-42',
            syncStatus: 'synced',
            lastSyncedAt: new Date('2026-07-26T12:00:00.000Z'),
            metadata: { retryPayload: { description: 'private evidence' } },
            createdAt: new Date('2026-07-26T11:00:00.000Z'),
          },
        }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketingController', () => {
  let controller: TicketingController;
  let serviceMock: ReturnType<typeof createServiceMock>;

  beforeEach(() => {
    serviceMock = createServiceMock();
    controller = new TicketingController(serviceMock as unknown as TicketingService);
  });

  // -----------------------------------------------------------------------
  // GET /ticketing/connection
  // -----------------------------------------------------------------------

  describe('getConnection', () => {
    it('returns connection status for authenticated user', async () => {
      const result = await controller.getConnection(makeAuth());

      expect(result.isConnected).toBe(true);
      expect(result.provider).toBe('jira');
      expect(serviceMock.getConnection).toHaveBeenCalledWith(ORG_ID);
    });

    it('throws UnauthorizedException when not authenticated', async () => {
      await expect(controller.getConnection(null)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when no organization context', async () => {
      await expect(
        controller.getConnection(makeAuth({ organizationId: undefined })),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // -----------------------------------------------------------------------
  // POST /ticketing/connect
  // -----------------------------------------------------------------------

  describe('connect', () => {
    it('returns authorization URL', async () => {
      const auth = makeAuth();
      const result = await controller.connect(auth, {
        redirectUri: 'https://app.example.com/callback',
      } as any);

      expect(result.authorizationUrl).toContain('atlassian.com');
      expect(result.state).toBe('state-uuid');
      expect(serviceMock.startOAuthFlow).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
        auth,
      );
    });

    it('requires authentication', async () => {
      await expect(
        controller.connect(null, { redirectUri: 'https://app.example.com/callback' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // -----------------------------------------------------------------------
  // GET /ticketing/callback
  // -----------------------------------------------------------------------

  describe('callback', () => {
    it('handles OAuth callback with valid code and state', async () => {
      const result = await controller.callback({ code: 'auth-code', state: 'state-uuid' } as any);

      expect(result.success).toBe(true);
      expect(serviceMock.handleOAuthCallback).toHaveBeenCalledWith('auth-code', 'state-uuid');
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /ticketing/disconnect
  // -----------------------------------------------------------------------

  describe('disconnect', () => {
    it('returns success on disconnect', async () => {
      const auth = makeAuth();
      const result = await controller.disconnect(auth);

      expect(result.success).toBe(true);
      expect(serviceMock.disconnect).toHaveBeenCalledWith(ORG_ID, auth);
    });

    it('requires authentication', async () => {
      await expect(controller.disconnect(null)).rejects.toThrow(UnauthorizedException);
    });
  });

  // -----------------------------------------------------------------------
  // PUT /ticketing/config
  // -----------------------------------------------------------------------

  describe('updateConfig', () => {
    it('updates config and returns connection status', async () => {
      const config = {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: { triaged: 'Open' },
        autoCreateOnStatuses: ['triaged'],
      };

      const auth = makeAuth();
      const result = await controller.updateConfig(auth, config as any);

      expect(result.isConnected).toBe(true);
      expect(serviceMock.updateConfig).toHaveBeenCalledWith(ORG_ID, config, auth);
    });

    it('requires authentication', async () => {
      await expect(controller.updateConfig(null, {} as any)).rejects.toThrow(UnauthorizedException);
    });
  });

  // -----------------------------------------------------------------------
  // GET /ticketing/projects
  // -----------------------------------------------------------------------

  describe('listProjects', () => {
    it('returns project list', async () => {
      const result = await controller.listProjects(makeAuth());

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('SEC');
      expect(serviceMock.listProjects).toHaveBeenCalledWith(ORG_ID);
    });

    it('requires authentication', async () => {
      await expect(controller.listProjects(null)).rejects.toThrow(UnauthorizedException);
    });
  });

  // -----------------------------------------------------------------------
  // GET /ticketing/issue-types/:projectKey
  // -----------------------------------------------------------------------

  describe('listIssueTypes', () => {
    it('returns issue types for a project', async () => {
      const result = await controller.listIssueTypes(makeAuth(), 'SEC');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bug');
      expect(serviceMock.listIssueTypes).toHaveBeenCalledWith(ORG_ID, 'SEC');
    });

    it('requires authentication', async () => {
      await expect(controller.listIssueTypes(null, 'SEC')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('reconcileTicketCreation', () => {
    const findingTriageId = '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48';

    it('scopes an attach action to the authenticated organization', async () => {
      const body = { action: 'attach' as const, issueKey: 'SEC-42' };

      const result = await controller.reconcileTicketCreation(makeAuth(), findingTriageId, body);

      expect(result.action).toBe('attach');
      expect(result.status).toBe('attached');
      expect(result.ticket?.externalId).toBe('SEC-42');
      expect(result.ticket?.reconciliationRequired).toBe(false);
      expect(result.ticket).not.toHaveProperty('metadata');
      expect(result.ticket).not.toHaveProperty('organizationId');
      expect(result.ticket?.lastSyncedAt).toBe('2026-07-26T12:00:00.000Z');
      expect(serviceMock.reconcileTicketCreation).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
        findingTriageId,
        body,
      );
    });

    it('returns a queued result without exposing a deleted placeholder', async () => {
      serviceMock.reconcileTicketCreation.mockResolvedValueOnce({
        action: 'clear_and_retry',
        status: 'retry_queued',
        findingTriageId,
        ticket: null,
      });

      const result = await controller.reconcileTicketCreation(makeAuth(), findingTriageId, {
        action: 'clear_and_retry',
        confirmedNoIssueExists: true,
      });

      expect(result).toEqual({
        action: 'clear_and_retry',
        status: 'retry_queued',
        findingTriageId,
        ticket: null,
      });
    });

    it('requires authentication', async () => {
      await expect(
        controller.reconcileTicketCreation(null, findingTriageId, {
          action: 'attach',
          issueKey: 'SEC-42',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('is restricted to organization administrators', () => {
      expect(
        Reflect.getMetadata(AUTH_ROLES_KEY, TicketingController.prototype.reconcileTicketCreation),
      ).toEqual(['ADMIN']);
    });

    it('declares the same 200 status documented by its OpenAPI response', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          TicketingController.prototype.reconcileTicketCreation,
        ),
      ).toBe(200);
    });
  });

  it('publishes complete response DTO contracts for connection setup and Jira discovery', () => {
    const responseType = (method: keyof TicketingController, status: number) =>
      Reflect.getMetadata(DECORATORS.API_RESPONSE, TicketingController.prototype[method])?.[status]
        ?.type?.name;

    expect(responseType('getConnection', 200)).toBe('TicketingConnectionResponseDto');
    expect(responseType('connect', 201)).toBe('OAuthConnectResponseDto');
    expect(responseType('callback', 200)).toBe('OperationSuccessResponseDto');
    expect(responseType('callback', 400)).toBe('TicketingErrorResponseDto');
    expect(responseType('disconnect', 200)).toBe('OperationSuccessResponseDto');
    expect(responseType('updateConfig', 200)).toBe('TicketingConnectionResponseDto');
    expect(responseType('listProjects', 200)).toBe('JiraProjectDto');
    expect(responseType('listIssueTypes', 200)).toBe('JiraIssueTypeDto');
  });
});
