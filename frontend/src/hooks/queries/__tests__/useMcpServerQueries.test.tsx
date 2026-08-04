import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { cleanup, waitFor } from '@testing-library/react';
import { skipToken } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithProviders } from '@/test/render-with-providers';

const fetchMock = vi.fn();

mock.module('@/services/api', () => ({
  API_BASE_URL: 'http://api.test',
  getApiAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test' }),
}));
import { useMcpAllTools, useMcpServers } from '../useMcpServerQueries';

afterEach(cleanup);
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('MCP catalog queries', () => {
  it('uses skipToken and makes no server request when disabled', () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useMcpServers({ enabled: false }),
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.mcpServers.all() })?.options.queryFn,
    ).toBe(skipToken);
  });

  it('uses skipToken and makes no tools request when disabled', () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useMcpAllTools({ enabled: false }),
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.mcpServers.tools() })?.options.queryFn,
    ).toBe(skipToken);
  });

  it('keeps the organization-scoped keys and stale times when enabled', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    const servers = renderHookWithProviders(() => useMcpServers());
    const tools = renderHookWithProviders(() => useMcpAllTools(), {
      queryClient: servers.queryClient,
    });

    await waitFor(() => expect(servers.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(tools.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      servers.queryClient.getQueryCache().find({ queryKey: queryKeys.mcpServers.all() })?.options,
    ).toMatchObject({ queryKey: queryKeys.mcpServers.all(), staleTime: 120_000 });
    expect(
      servers.queryClient.getQueryCache().find({ queryKey: queryKeys.mcpServers.tools() })?.options,
    ).toMatchObject({ queryKey: queryKeys.mcpServers.tools(), staleTime: 120_000 });
  });
});
