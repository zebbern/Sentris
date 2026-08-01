import { describe, expect, it, vi } from 'bun:test';

import { McpServersRepository } from '../mcp-servers.repository';

describe('McpServersRepository runtime identity timestamps', () => {
  it('records health without changing the configuration updatedAt timestamp', async () => {
    const where = vi.fn(async () => []);
    const set = vi.fn((_payload: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new McpServersRepository({ update } as never);

    await repository.updateHealthStatus('00000000-0000-4000-8000-000000000001', 'healthy', {
      organizationId: 'org-1',
    });

    expect(set).toHaveBeenCalledWith({
      lastHealthCheck: expect.anything(),
      lastHealthStatus: 'healthy',
    });
    expect(set.mock.calls[0]?.[0]).not.toHaveProperty('updatedAt');
  });
});
