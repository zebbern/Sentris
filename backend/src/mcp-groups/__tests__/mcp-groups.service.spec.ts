import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { McpGroupsService } from '../mcp-groups.service';
import type { AuthContext } from '../../auth/types';

const organizationId = 'organization-a';
const auth: AuthContext = {
  userId: 'admin-a',
  organizationId,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const group = {
  id: 'group-1',
  slug: 'cloud',
  name: 'Cloud',
  description: null,
  credentialContractName: 'cloud',
  credentialMapping: null,
  defaultDockerImage: null,
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const groupServerRelation = {
  groupId: group.id,
  serverId: 'server-1',
  recommended: true,
  defaultSelected: false,
};

function completedCache(owner: string, toolName: string): string {
  return JSON.stringify({
    status: 'completed',
    organizationId: owner,
    tools: [{ name: toolName }],
    toolCount: 1,
  });
}

describe('McpGroupsService discovery cache ownership', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let seeding: Record<string, ReturnType<typeof vi.fn>>;
  let serverRepository: Record<string, ReturnType<typeof vi.fn>>;
  let redis: Record<string, ReturnType<typeof vi.fn>>;
  let service: McpGroupsService;

  beforeEach(() => {
    repository = {
      findBySlug: vi.fn(async () => group),
      findServersByGroup: vi.fn(async () => [
        { id: 'server-storage', name: 'storage' },
        { id: 'server-code', name: 'code' },
      ]),
    };
    seeding = {
      syncTemplate: vi.fn(async () => ({ action: 'created' })),
      getTemplateBySlug: vi.fn(() => ({ name: group.name })),
    };
    serverRepository = {
      upsertTools: vi.fn(async () => []),
      updateHealthStatus: vi.fn(async () => undefined),
    };
    redis = {
      get: vi.fn(async (key: string) => {
        if (key.endsWith('storage-cache')) {
          return completedCache(organizationId, 'list_buckets');
        }
        return completedCache('organization-b', 'list_repositories');
      }),
    };

    service = new McpGroupsService(
      repository as never,
      seeding as never,
      serverRepository as never,
      redis as never,
      { record: vi.fn() } as never,
      { get: vi.fn(() => ({ mcpSyncTemplatesOnStartup: false })) } as never,
    );
  });

  it('uses completed discovery caches owned by the importing organization', async () => {
    redis.get.mockResolvedValueOnce(completedCache(organizationId, 'list_buckets'));
    repository.findServersByGroup.mockResolvedValueOnce([
      { id: 'server-storage', name: 'storage' },
    ]);

    await service.importTemplate(
      'cloud',
      organizationId,
      { serverCacheTokens: { storage: 'storage-cache' } },
      auth,
    );

    expect(seeding.syncTemplate).toHaveBeenCalledWith(
      'cloud',
      false,
      organizationId,
      expect.any(Function),
    );
    expect(serverRepository.upsertTools).toHaveBeenCalledWith('server-storage', [
      {
        toolName: 'list_buckets',
        description: null,
        inputSchema: null,
      },
    ]);
  });

  it('validates every cache owner before creating any template records or tools', async () => {
    await expect(
      service.importTemplate(
        'cloud',
        organizationId,
        {
          serverCacheTokens: {
            storage: 'storage-cache',
            code: 'code-cache',
          },
        },
        auth,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(seeding.syncTemplate).not.toHaveBeenCalled();
    expect(serverRepository.upsertTools).not.toHaveBeenCalled();
    expect(serverRepository.updateHealthStatus).not.toHaveBeenCalled();
  });
});

describe('McpGroupsService transactional audit scheduling', () => {
  const mutationExecutor = { insert: vi.fn() };
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let seeding: Record<string, ReturnType<typeof vi.fn>>;
  let serverRepository: Record<string, ReturnType<typeof vi.fn>>;
  let auditLog: Record<string, ReturnType<typeof vi.fn>>;
  let service: McpGroupsService;

  beforeEach(() => {
    repository = {
      create: vi.fn(
        async (
          _data: unknown,
          onMutated?: (executor: unknown, record: unknown) => Promise<void>,
        ) => {
          await onMutated?.(mutationExecutor, group);
          return group;
        },
      ),
      update: vi.fn(
        async (
          _id: unknown,
          _data: unknown,
          onMutated?: (executor: unknown, record: unknown) => Promise<void>,
        ) => {
          await onMutated?.(mutationExecutor, group);
          return group;
        },
      ),
      delete: vi.fn(
        async (
          _id: unknown,
          onMutated?: (executor: unknown, result: { serverIds: string[] }) => Promise<void>,
        ) => {
          await onMutated?.(mutationExecutor, {
            serverIds: ['server-1', 'server-2'],
          });
        },
      ),
      findById: vi.fn(async () => group),
      findBySlug: vi.fn(async () => group),
      findServersByGroup: vi.fn(async () => []),
      addServerToGroup: vi.fn(
        async (
          _groupId: string,
          _serverId: string,
          _metadata: unknown,
          onMutated?: (executor: unknown, record: unknown) => Promise<void>,
        ) => {
          await onMutated?.(mutationExecutor, groupServerRelation);
          return groupServerRelation;
        },
      ),
      removeServerFromGroup: vi.fn(
        async (
          _groupId: string,
          _serverId: string,
          onMutated?: (executor: unknown) => Promise<void>,
        ) => {
          await onMutated?.(mutationExecutor);
        },
      ),
      updateServerMetadata: vi.fn(
        async (
          _groupId: string,
          _serverId: string,
          _metadata: unknown,
          onMutated?: (executor: unknown, record: unknown) => Promise<void>,
        ) => {
          await onMutated?.(mutationExecutor, groupServerRelation);
          return groupServerRelation;
        },
      ),
    };
    seeding = {
      syncTemplate: vi.fn(
        async (
          slug: string,
          _force: boolean,
          _organizationId: string,
          onMutated?: (executor: unknown, result: unknown) => Promise<void>,
        ) => {
          const result = {
            slug,
            action: 'updated',
            groupId: group.id,
            serversSynced: 0,
            templateHash: 'hash',
          };
          await onMutated?.(mutationExecutor, result);
          return result;
        },
      ),
      getTemplateBySlug: vi.fn(() => ({ name: group.name })),
    };
    serverRepository = {
      clearTools: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    auditLog = {
      record: vi.fn(),
      recordDurable: vi.fn(async () => undefined),
      recordDurableWithExecutor: vi.fn(async () => undefined),
    };
    service = new McpGroupsService(
      repository as never,
      seeding as never,
      serverRepository as never,
      { get: vi.fn() } as never,
      auditLog as never,
      { get: vi.fn(() => ({ mcpSyncTemplatesOnStartup: false })) } as never,
    );
  });

  it('schedules create audit through the repository transaction executor', async () => {
    await service.createGroup(auth, {
      slug: 'cloud',
      name: 'Cloud',
      credentialContractName: 'cloud',
    });

    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      auth,
      expect.objectContaining({ action: 'mcp_group.create', resourceId: group.id }),
    );
  });

  it('rejects group creation when durable audit scheduling fails', async () => {
    auditLog.recordDurableWithExecutor.mockRejectedValueOnce(new Error('audit outbox unavailable'));

    await expect(
      service.createGroup(auth, {
        slug: 'cloud',
        name: 'Cloud',
        credentialContractName: 'cloud',
      }),
    ).rejects.toThrow('audit outbox unavailable');
  });

  it('schedules update audit through the repository transaction executor', async () => {
    await service.updateGroup(auth, group.id, { name: 'Cloud updated' });

    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      auth,
      expect.objectContaining({ action: 'mcp_group.update', resourceId: group.id }),
    );
  });

  it('schedules delete audit through the repository transaction executor', async () => {
    await service.deleteGroup(auth, group.id);

    expect(repository.delete).toHaveBeenCalledWith(group.id, expect.any(Function));
    expect(repository.findServersByGroup).not.toHaveBeenCalled();
    expect(serverRepository.clearTools).not.toHaveBeenCalled();
    expect(serverRepository.delete).not.toHaveBeenCalled();
    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      auth,
      expect.objectContaining({
        action: 'mcp_group.delete',
        resourceId: group.id,
        metadata: expect.objectContaining({ serverCount: 2 }),
      }),
    );
  });

  it('rejects the complete group delete when durable audit scheduling fails', async () => {
    auditLog.recordDurableWithExecutor.mockRejectedValueOnce(new Error('audit outbox unavailable'));

    await expect(service.deleteGroup(auth, group.id)).rejects.toThrow('audit outbox unavailable');
    expect(repository.delete).toHaveBeenCalledWith(group.id, expect.any(Function));
  });

  it('schedules template mutation audit through the seeding transaction executor', async () => {
    await service.importTemplate('cloud', organizationId, undefined, auth);

    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      auth,
      expect.objectContaining({ action: 'mcp_group.import_template', resourceId: group.id }),
    );
  });

  it('schedules group membership mutations through the repository transaction executor', async () => {
    await service.addServerToGroup(auth, group.id, {
      serverId: groupServerRelation.serverId,
      recommended: true,
      defaultSelected: false,
    });
    await service.updateServerInGroup(auth, group.id, groupServerRelation.serverId, {
      recommended: false,
    });
    await service.removeServerFromGroup(auth, group.id, groupServerRelation.serverId);

    for (const action of [
      'mcp_group.server_add',
      'mcp_group.server_update',
      'mcp_group.server_remove',
    ]) {
      expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
        mutationExecutor,
        auth,
        expect.objectContaining({
          action,
          resourceId: group.id,
          metadata: expect.objectContaining({ serverId: groupServerRelation.serverId }),
        }),
      );
    }
  });

  it('rejects a group membership mutation when durable audit scheduling fails', async () => {
    auditLog.recordDurableWithExecutor.mockRejectedValueOnce(new Error('audit outbox unavailable'));

    await expect(
      service.addServerToGroup(auth, group.id, {
        serverId: groupServerRelation.serverId,
      }),
    ).rejects.toThrow('audit outbox unavailable');
  });
});
