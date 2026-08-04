import { beforeEach, describe, expect, test, vi } from 'bun:test';

import { AUTH_ROLES_KEY } from '../../auth/roles.decorator';
import type { AuthContext } from '../../auth/types';
import { McpDiscoveryController } from '../mcp-discovery.controller';
import type { McpDiscoveryOrchestratorService } from '../mcp-discovery-orchestrator.service';

const adminAuth: AuthContext = {
  userId: 'admin-a',
  organizationId: 'org-a',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const groupDiscoveryInput = {
  servers: [
    {
      transport: 'http' as const,
      name: 'public-mcp',
      endpoint: 'https://93.184.216.34/mcp',
    },
  ],
};

describe('McpDiscoveryController authorization contract', () => {
  let controller: McpDiscoveryController;
  let orchestrator: {
    startGroupDiscovery: ReturnType<typeof vi.fn>;
    getGroupStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    orchestrator = {
      startGroupDiscovery: vi.fn(async () => ({
        workflowId: '67bcd81c-5f2e-4774-80c3-6b19349389da',
        cacheTokens: {
          'public-mcp': 'a64c944c-9e51-428d-8285-ae9ec79e5e81',
        },
        status: 'started' as const,
      })),
      getGroupStatus: vi.fn(async () => ({
        workflowId: '67bcd81c-5f2e-4774-80c3-6b19349389da',
        status: 'running' as const,
      })),
    };
    controller = new McpDiscoveryController(
      orchestrator as unknown as McpDiscoveryOrchestratorService,
    );
  });

  test('forwards the current auth context when starting group discovery', async () => {
    await controller.discoverGroup(adminAuth, groupDiscoveryInput);

    expect(orchestrator.startGroupDiscovery).toHaveBeenCalledWith(groupDiscoveryInput, adminAuth);
  });

  test('forwards the current auth context when querying group discovery', async () => {
    await controller.getGroupStatus(adminAuth, 'group-workflow');

    expect(orchestrator.getGroupStatus).toHaveBeenCalledWith('group-workflow', adminAuth);
  });

  test('requires ADMIN metadata on every discovery route handler', () => {
    const handlers = [controller.discoverGroup, controller.getGroupStatus];

    expect(handlers.map((handler) => Reflect.getMetadata(AUTH_ROLES_KEY, handler))).toEqual([
      ['ADMIN'],
      ['ADMIN'],
    ]);
  });
});
