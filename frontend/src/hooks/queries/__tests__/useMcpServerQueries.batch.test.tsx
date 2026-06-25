import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { act, cleanup } from '@testing-library/react';

import { renderHookWithProviders } from '@/test/render-with-providers';
import { queryKeys } from '@/lib/queryKeys';

mock.module('@/services/api', () => ({
  getApiAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
  API_BASE_URL: 'http://localhost:3000',
}));

mock.module('@/services/mcpDiscoveryApi', () => ({
  mcpDiscoveryApi: {
    discover: vi.fn(),
    getStatus: vi.fn(),
  },
}));

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

// Query parameter bypasses alias-level mocks from page tests when files run serially.
const mcpServerQueriesModulePath = '../useMcpServerQueries?batch';
const { useTestEnabledMcpServers, useTestMcpConnection } = await import(mcpServerQueriesModulePath);

describe('useTestEnabledMcpServers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('posts to the batch endpoint and invalidates MCP server and tool caches', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            serverId: 'srv-1',
            serverName: 'Fetch Reference',
            success: true,
            message: 'Connection successful (1 tools discovered)',
            toolCount: 1,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { result, queryClient } = renderHookWithProviders(() => useTestEnabledMcpServers());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/mcp-servers/test-enabled',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.mcpServers.all() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.mcpServers.tools() });
  });

  it('invalidates MCP server and tool caches after testing one server connection', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          message: 'Connection successful (1 tools discovered)',
          toolCount: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { result, queryClient } = renderHookWithProviders(() => useTestMcpConnection());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('srv-1');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/mcp-servers/srv-1/test',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.mcpServers.all() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.mcpServers.tools() });
  });
});
