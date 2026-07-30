import { describe, expect, it, vi } from 'bun:test';

import { mcpGroups, mcpServers } from '../../database/schema';
import { McpGroupsRepository } from '../mcp-groups.repository';

function chainable(resolvedValue: unknown) {
  const builder: Record<string, unknown> = {};
  const self = new Proxy(builder, {
    get(_target, property: string) {
      if (property === 'then') {
        return (resolve: (value: unknown) => void) => resolve(resolvedValue);
      }
      return () => self;
    },
  });
  return self;
}

describe('McpGroupsRepository transactional delete', () => {
  it('deletes related servers, the group, and schedules audit on one executor', async () => {
    const deletedTables: unknown[] = [];
    const executor = {
      select: vi.fn(() => chainable([{ serverId: 'server-1' }, { serverId: 'server-2' }])),
      delete: vi.fn((table: unknown) => {
        deletedTables.push(table);
        return chainable(table === mcpGroups ? [{ id: 'group-1' }] : []);
      }),
      insert: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (callback: (tx: typeof executor) => Promise<unknown>) =>
        callback(executor),
      ),
    };
    const repository = new McpGroupsRepository(db as never);
    let auditExecutor: unknown;
    let auditedServerIds: string[] = [];

    await repository.delete('group-1', async (tx, result) => {
      auditExecutor = tx;
      auditedServerIds = result.serverIds;
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(deletedTables).toEqual([mcpServers, mcpGroups]);
    expect(auditExecutor).toBe(executor);
    expect(auditedServerIds).toEqual(['server-1', 'server-2']);
  });

  it('propagates audit scheduling failure to roll back all deletes', async () => {
    const executor = {
      select: vi.fn(() => chainable([{ serverId: 'server-1' }])),
      delete: vi.fn((table: unknown) => chainable(table === mcpGroups ? [{ id: 'group-1' }] : [])),
      insert: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (callback: (tx: typeof executor) => Promise<unknown>) =>
        callback(executor),
      ),
    };
    const repository = new McpGroupsRepository(db as never);

    await expect(
      repository.delete('group-1', async () => {
        throw new Error('audit outbox unavailable');
      }),
    ).rejects.toThrow('audit outbox unavailable');
  });
});
