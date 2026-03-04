import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { TicketingController } from '../ticketing.controller';
import type { TicketingService } from '../ticketing.service';
import type { AuthContext } from '../../auth/types';

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
    role: 'ADMIN',
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
      const result = await controller.connect(makeAuth(), {
        redirectUri: 'https://app.example.com/callback',
      } as any);

      expect(result.authorizationUrl).toContain('atlassian.com');
      expect(result.state).toBe('state-uuid');
      expect(serviceMock.startOAuthFlow).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        'https://app.example.com/callback',
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
      const result = await controller.disconnect(makeAuth());

      expect(result.success).toBe(true);
      expect(serviceMock.disconnect).toHaveBeenCalledWith(ORG_ID);
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

      const result = await controller.updateConfig(makeAuth(), config as any);

      expect(result.isConnected).toBe(true);
      expect(serviceMock.updateConfig).toHaveBeenCalledWith(ORG_ID, config);
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
});
