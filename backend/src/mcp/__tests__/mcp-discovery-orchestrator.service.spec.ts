import { describe, expect, test, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import { McpDiscoveryOrchestratorService } from '../mcp-discovery-orchestrator.service';

const groupDiscoveryInput = {
  servers: [
    {
      transport: 'http' as const,
      name: 'public-mcp-a',
      endpoint: 'https://93.184.216.34/mcp',
    },
    {
      transport: 'http' as const,
      name: 'public-mcp-b',
      endpoint: 'https://93.184.216.35/mcp',
    },
  ],
};

const adminInOrgA: AuthContext = {
  userId: 'admin-a',
  organizationId: 'org-a',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function createService() {
  const records = new Map<string, string>();
  const redis = {
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      records.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (records.delete(key)) deleted += 1;
      }
      return deleted;
    }),
    quit: vi.fn(async () => 'OK'),
  };
  const temporal = {
    getDefaultTaskQueue: vi.fn(() => 'test-queue'),
    startWorkflow: vi.fn(async () => ({ workflowId: 'ignored' })),
    queryWorkflow: vi.fn(async () => ({ status: 'completed' as const, results: [] })),
  };

  return {
    service: new McpDiscoveryOrchestratorService(temporal as never, redis as never),
    redis,
    temporal,
    records,
  };
}

function generatedKeys(redis: ReturnType<typeof createService>['redis']): string[] {
  return redis.setex.mock.calls.map(([key]) => key);
}

describe('McpDiscoveryOrchestratorService group access boundaries', () => {
  test('rejects group discovery from non-admin organization members', async () => {
    const { service, temporal } = createService();
    const member: AuthContext = { ...adminInOrgA, roles: ['MEMBER'] };

    await expect(service.startGroupDiscovery(groupDiscoveryInput, member)).rejects.toThrow(
      'Administrator role required',
    );
    expect(temporal.startWorkflow).not.toHaveBeenCalled();
  });

  test('allows the owning organization to query group discovery', async () => {
    const { service, temporal } = createService();
    const started = await service.startGroupDiscovery(groupDiscoveryInput, adminInOrgA);

    await expect(service.getGroupStatus(started.workflowId, adminInOrgA)).resolves.toMatchObject({
      workflowId: started.workflowId,
      status: 'completed',
    });
    expect(temporal.queryWorkflow).toHaveBeenCalledWith({
      workflowId: started.workflowId,
      queryType: 'getGroupDiscoveryResult',
    });
  });

  test('denies group discovery status to another organization', async () => {
    const { service, temporal } = createService();
    const started = await service.startGroupDiscovery(groupDiscoveryInput, adminInOrgA);
    const adminInOrgB: AuthContext = {
      ...adminInOrgA,
      userId: 'admin-b',
      organizationId: 'org-b',
    };

    await expect(service.getGroupStatus(started.workflowId, adminInOrgB)).rejects.toThrow(
      'Discovery workflow access denied',
    );
    expect(temporal.queryWorkflow).not.toHaveBeenCalled();
  });

  test('denies group discovery status when the ownership record is missing', async () => {
    const { service, temporal } = createService();

    await expect(service.getGroupStatus('missing-group-workflow', adminInOrgA)).rejects.toThrow(
      'Discovery workflow access denied',
    );
    expect(temporal.queryWorkflow).not.toHaveBeenCalled();
  });
});

describe('McpDiscoveryOrchestratorService group startup compensation', () => {
  test('deletes the owner and every generated cache record when Temporal start fails', async () => {
    const { service, temporal, redis, records } = createService();
    records.set('mcp-discovery:existing-cache', '{"organizationId":"org-existing"}');
    temporal.startWorkflow.mockRejectedValueOnce(new Error('Temporal unavailable'));

    await expect(service.startGroupDiscovery(groupDiscoveryInput, adminInOrgA)).rejects.toThrow(
      'Temporal unavailable',
    );

    const freshKeys = generatedKeys(redis);
    expect(freshKeys).toHaveLength(3);
    expect(redis.del).toHaveBeenCalledWith(...freshKeys);
    expect(freshKeys.every((key) => !records.has(key))).toBe(true);
    expect(records.has('mcp-discovery:existing-cache')).toBe(true);
  });

  test('waits for partial writes to settle before deleting every generated key', async () => {
    const { service, redis, records, temporal } = createService();
    let invocation = 0;
    redis.setex.mockImplementation(async (key: string, _ttl: number, value: string) => {
      invocation += 1;
      if (invocation === 2) throw new Error('cache write failed');
      if (invocation === 1) await new Promise((resolve) => setTimeout(resolve, 10));
      records.set(key, value);
      return 'OK';
    });

    await expect(service.startGroupDiscovery(groupDiscoveryInput, adminInOrgA)).rejects.toThrow(
      'cache write failed',
    );

    const freshKeys = generatedKeys(redis);
    expect(redis.del).toHaveBeenCalledWith(...freshKeys);
    expect(freshKeys.every((key) => !records.has(key))).toBe(true);
    expect(temporal.startWorkflow).not.toHaveBeenCalled();
  });

  test('waits for in-flight writes before compensating a synchronous write failure', async () => {
    const { service, redis, records, temporal } = createService();
    let invocation = 0;
    redis.setex.mockImplementation((key: string, _ttl: number, value: string) => {
      invocation += 1;
      if (invocation === 2) throw new Error('synchronous cache write failure');
      return new Promise<'OK'>((resolve) => {
        setTimeout(() => {
          records.set(key, value);
          resolve('OK');
        }, 10);
      });
    });

    await expect(service.startGroupDiscovery(groupDiscoveryInput, adminInOrgA)).rejects.toThrow(
      'synchronous cache write failure',
    );

    const freshKeys = generatedKeys(redis);
    expect(redis.del).toHaveBeenCalledWith(...freshKeys);
    expect(freshKeys.every((key) => !records.has(key))).toBe(true);
    expect(temporal.startWorkflow).not.toHaveBeenCalled();
  });
});
