import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';
import { cleanup, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the api service (needed for auth headers / base URL used by apiRequest)
mock.module('@/services/api', () => ({
  getApiAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
  API_BASE_URL: 'http://localhost:3000',
  api: {
    workflows: {
      list: vi.fn(),
      listSummary: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      commit: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
      getRuntimeInputs: vi.fn(),
    },
    secrets: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      rotate: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock the mcpDiscoveryApi for useDiscoverMcpTools
mock.module('@/services/mcpDiscoveryApi', () => ({
  mcpDiscoveryApi: {
    discover: vi.fn(),
    getStatus: vi.fn(),
  },
}));

// Track fetch calls
const fetchMock = vi.fn();

// We need to mock the hooks themselves since they internally call fetch via apiRequest
const createServerMock = vi.fn();
const deleteServerMock = vi.fn();

mock.module('@/hooks/queries/useMcpServerQueries', () => ({
  useMcpServers: () => {
    // Returns a stub useQuery result
    return { data: [], isLoading: false, error: null };
  },
  useMcpAllTools: () => {
    return { data: [], isLoading: false, error: null };
  },
  useCreateMcpServer: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: any) => createServerMock(input),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      },
    });
  },
  useDeleteMcpServer: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => deleteServerMock(id),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
        qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
      },
    });
  },
  useUpdateMcpServer: () => useMutation({ mutationFn: vi.fn() }),
  useToggleMcpServer: () => useMutation({ mutationFn: vi.fn() }),
  useTestMcpConnection: () => useMutation({ mutationFn: vi.fn() }),
  useFetchServerTools: () => useMutation({ mutationFn: vi.fn() }),
  useToggleMcpTool: () => useMutation({ mutationFn: vi.fn() }),
  useDiscoverMcpTools: () => useMutation({ mutationFn: vi.fn() }),
}));

import { useCreateMcpServer, useDeleteMcpServer } from '../useMcpServerQueries';

afterEach(cleanup);

beforeEach(() => {
  createServerMock.mockReset();
  deleteServerMock.mockReset();
  fetchMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCreateMcpServer', () => {
  it('calls the create mutation with the input and invalidates queries', async () => {
    const newServer = { name: 'Test Server', transportType: 'http', endpoint: 'http://mcp:8080' };
    createServerMock.mockResolvedValueOnce({ id: 'srv-1', ...newServer });

    const { result, queryClient } = renderHookWithProviders(() => useCreateMcpServer());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(newServer as any);
    });

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(createServerMock).toHaveBeenCalledWith(newServer);
    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([expect.arrayContaining(['mcpServers'])]),
    );
  });

  it('propagates errors from the create call', async () => {
    createServerMock.mockRejectedValueOnce(new Error('Server limit reached'));

    const { result } = renderHookWithProviders(() => useCreateMcpServer());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'X' } as any);
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Server limit reached');
  });
});

describe('useDeleteMcpServer', () => {
  it('calls delete with the server id and invalidates server + tools queries', async () => {
    deleteServerMock.mockResolvedValueOnce(undefined);

    const { result, queryClient } = renderHookWithProviders(() => useDeleteMcpServer());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('srv-42');
    });

    expect(deleteServerMock).toHaveBeenCalledTimes(1);
    expect(deleteServerMock).toHaveBeenCalledWith('srv-42');
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([expect.arrayContaining(['mcpServers'])]),
    );
  });

  it('propagates errors from the delete call', async () => {
    deleteServerMock.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHookWithProviders(() => useDeleteMcpServer());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync('srv-bad');
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Not found');
  });

  it('starts with isPending=false', () => {
    const { result } = renderHookWithProviders(() => useDeleteMcpServer());
    expect(result.current.isPending).toBe(false);
  });
});
