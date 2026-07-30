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

const discoveryInput = {
  transport: 'http' as const,
  name: 'public-mcp',
  endpoint: 'https://93.184.216.34/mcp',
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
    startDiscovery: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    startGroupDiscovery: ReturnType<typeof vi.fn>;
    getGroupStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    orchestrator = {
      startDiscovery: vi.fn(async () => ({
        workflowId: '2f6080a6-7e26-462e-bd30-046c67f5a890',
        cacheToken: 'c3a97385-efec-41b2-b952-33c39eb47c24',
        status: 'started' as const,
      })),
      getStatus: vi.fn(async () => ({
        workflowId: '2f6080a6-7e26-462e-bd30-046c67f5a890',
        status: 'running' as const,
      })),
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

  test('forwards the current auth context when starting single discovery', async () => {
    await controller.discover(adminAuth, discoveryInput);

    expect(orchestrator.startDiscovery).toHaveBeenCalledWith(discoveryInput, adminAuth);
  });

  test('forwards the current auth context when querying single discovery', async () => {
    await controller.getStatus(adminAuth, 'single-workflow');

    expect(orchestrator.getStatus).toHaveBeenCalledWith('single-workflow', adminAuth);
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
    const handlers = [
      controller.discover,
      controller.getStatus,
      controller.discoverGroup,
      controller.getGroupStatus,
    ];

    expect(handlers.map((handler) => Reflect.getMetadata(AUTH_ROLES_KEY, handler))).toEqual([
      ['ADMIN'],
      ['ADMIN'],
      ['ADMIN'],
      ['ADMIN'],
    ]);
  });
});
