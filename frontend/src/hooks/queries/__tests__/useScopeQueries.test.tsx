import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';
import { cleanup, act, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';

// ---------------------------------------------------------------------------
// Mocks — only mock the API layer; react-query is provided by the test wrapper.
// ---------------------------------------------------------------------------

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    scopes: {
      list: listMock,
      get: getMock,
      create: createMock,
      update: updateMock,
      remove: removeMock,
    },
  },
}));

import {
  useScopes,
  useScope,
  useCreateScope,
  useUpdateScope,
  useDeleteScope,
} from '../useScopeQueries';

afterEach(cleanup);

beforeEach(() => {
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  removeMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SCOPE_LIST = [
  {
    id: 'scope-1',
    organizationId: 'org-1',
    name: 'Prod',
    description: null,
    domains: ['example.com'],
    repos: [],
    ipRanges: [],
    runtimeValues: {},
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('useScopes', () => {
  it('returns the scope list from api.scopes.list', async () => {
    listMock.mockResolvedValueOnce(SCOPE_LIST);

    const { result } = renderHookWithProviders(() => useScopes());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(SCOPE_LIST);
  });
});

describe('useScope', () => {
  it('fetches a single scope by id', async () => {
    getMock.mockResolvedValueOnce(SCOPE_LIST[0]);

    const { result } = renderHookWithProviders(() => useScope('scope-1'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getMock).toHaveBeenCalledWith('scope-1');
    expect(result.current.data).toEqual(SCOPE_LIST[0]);
  });
});

describe('useCreateScope', () => {
  it('calls api.scopes.create with the input and invalidates queries', async () => {
    const input = {
      name: 'New Scope',
      description: null,
      domains: ['example.com'],
      repos: [],
      ipRanges: [],
      runtimeValues: {},
    };
    createMock.mockResolvedValueOnce({ id: 'scope-2', ...input });

    const { result, queryClient } = renderHookWithProviders(() => useCreateScope());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(input);
    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([expect.arrayContaining(['targets'])]));
  });

  it('propagates errors from api.scopes.create', async () => {
    createMock.mockRejectedValueOnce(new Error('Duplicate name'));

    const { result } = renderHookWithProviders(() => useCreateScope());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: 'Dup',
          domains: [],
          repos: [],
          ipRanges: [],
          runtimeValues: {},
        });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Duplicate name');
  });
});

describe('useUpdateScope', () => {
  it('calls api.scopes.update(id, payload) and invalidates queries', async () => {
    updateMock.mockResolvedValueOnce({ id: 'scope-1', name: 'Renamed' });

    const { result, queryClient } = renderHookWithProviders(() => useUpdateScope());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ id: 'scope-1', payload: { name: 'Renamed' } });
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('scope-1', { name: 'Renamed' });
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('useDeleteScope', () => {
  it('calls api.scopes.remove(id) and invalidates queries', async () => {
    removeMock.mockResolvedValueOnce(undefined);

    const { result, queryClient } = renderHookWithProviders(() => useDeleteScope());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('scope-1');
    });

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledWith('scope-1');
    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([expect.arrayContaining(['targets'])]));
  });

  it('propagates errors from api.scopes.remove', async () => {
    removeMock.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHookWithProviders(() => useDeleteScope());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync('scope-bad');
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Not found');
  });
});
