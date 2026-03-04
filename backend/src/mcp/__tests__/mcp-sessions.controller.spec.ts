import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { McpSessionsController } from '../mcp-sessions.controller';
import type { SessionRegistryService } from '../session-registry.service';

describe('McpSessionsController', () => {
  let controller: McpSessionsController;
  let sessionRegistry: SessionRegistryService;

  beforeEach(() => {
    sessionRegistry = {
      listActiveSessions: jest.fn().mockResolvedValue({ sessions: [], count: 0 }),
      register: jest.fn(),
      deregister: jest.fn(),
      getSession: jest.fn(),
      refresh: jest.fn(),
    } as unknown as SessionRegistryService;

    controller = new McpSessionsController(sessionRegistry);
  });

  describe('listSessions', () => {
    it('delegates to sessionRegistry.listActiveSessions()', async () => {
      const mockResult = {
        sessions: [
          {
            sessionId: 'session-1',
            instanceId: 'host-a',
            userId: 'user-1',
            organizationId: 'org-1',
            sessionType: 'mcp-gateway' as const,
            runId: 'run-1',
            createdAt: '2026-03-04T12:00:00.000Z',
          },
        ],
        count: 1,
      };
      (sessionRegistry.listActiveSessions as ReturnType<typeof jest.fn>).mockResolvedValue(
        mockResult,
      );

      const result = await controller.listSessions();

      expect(sessionRegistry.listActiveSessions).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResult);
    });

    it('returns empty list when no sessions exist', async () => {
      const result = await controller.listSessions();

      expect(result).toEqual({ sessions: [], count: 0 });
    });

    it('returns multiple sessions across different types', async () => {
      const mockResult = {
        sessions: [
          {
            sessionId: 'session-1',
            instanceId: 'host-a',
            userId: 'user-1',
            organizationId: 'org-1',
            sessionType: 'mcp-gateway' as const,
            runId: 'run-1',
            createdAt: '2026-03-04T12:00:00.000Z',
          },
          {
            sessionId: 'session-2',
            instanceId: 'host-b',
            userId: 'user-2',
            organizationId: 'org-2',
            sessionType: 'studio-mcp' as const,
            createdAt: '2026-03-04T12:05:00.000Z',
          },
        ],
        count: 2,
      };
      (sessionRegistry.listActiveSessions as ReturnType<typeof jest.fn>).mockResolvedValue(
        mockResult,
      );

      const result = await controller.listSessions();

      expect(result.count).toBe(2);
      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0].sessionType).toBe('mcp-gateway');
      expect(result.sessions[1].sessionType).toBe('studio-mcp');
    });

    it('propagates errors from session registry', async () => {
      (sessionRegistry.listActiveSessions as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Redis connection lost'),
      );

      await expect(controller.listSessions()).rejects.toThrow('Redis connection lost');
    });
  });

  describe('metadata', () => {
    it('is defined', () => {
      expect(controller).toBeDefined();
      expect(controller.listSessions).toBeDefined();
    });
  });
});
