import { beforeEach, describe, expect, it, jest } from 'bun:test';

import { McpServersController } from '../mcp-servers.controller';
import type { McpServersService } from '../mcp-servers.service';
import type { AuthContext } from '../../auth/types';

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: 'local-dev',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeService(): McpServersService {
  return {
    testEnabledServers: jest.fn().mockResolvedValue([
      {
        serverId: 'server-1',
        serverName: 'Fetch Reference',
        success: true,
        message: 'Connection successful (1 tools discovered)',
        toolCount: 1,
      },
    ]),
  } as unknown as McpServersService;
}

describe('McpServersController', () => {
  let controller: McpServersController;
  let service: McpServersService;

  beforeEach(() => {
    service = makeService();
    controller = new McpServersController(service);
  });

  it('delegates enabled server batch testing to the service', async () => {
    const result = await controller.testEnabledServers(authContext);

    expect(service.testEnabledServers).toHaveBeenCalledWith(authContext);
    expect(result).toEqual([
      {
        serverId: 'server-1',
        serverName: 'Fetch Reference',
        success: true,
        message: 'Connection successful (1 tools discovered)',
        toolCount: 1,
      },
    ]);
  });
});
