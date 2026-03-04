import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';
import { cleanup, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

// ---------------------------------------------------------------------------
// Mocks — only mock the API layer; react-query is provided by the test wrapper.
// ---------------------------------------------------------------------------

const createMock = vi.fn();
const updateMock = vi.fn();
const rotateMock = vi.fn();
const deleteMock = vi.fn();
const listMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    secrets: {
      list: listMock,
      create: createMock,
      update: updateMock,
      rotate: rotateMock,
      delete: deleteMock,
      getValue: vi.fn(),
    },
    // Stubs for other api namespaces that may be referenced transitively
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
  },
}));

// Re-export hooks with real react-query backed by mocked API
mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => {
    // Not testing the query hook itself here — focus on mutations
    return { data: [], isLoading: false };
  },
  useCreateSecret: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: any) => createMock(input),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
      },
    });
  },
  useUpdateSecret: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: any }) => updateMock(id, input),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
      },
    });
  },
  useRotateSecret: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: any }) => rotateMock(id, input),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
      },
    });
  },
  useDeleteSecret: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => deleteMock(id),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
      },
    });
  },
}));

import {
  useCreateSecret,
  useUpdateSecret,
  useRotateSecret,
  useDeleteSecret,
} from '../useSecretQueries';

afterEach(cleanup);

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  rotateMock.mockReset();
  deleteMock.mockReset();
  listMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCreateSecret', () => {
  it('calls api.secrets.create with the input', async () => {
    createMock.mockResolvedValueOnce({ id: 's-1', name: 'MY_SECRET' });

    const { result } = renderHookWithProviders(() => useCreateSecret());

    await act(async () => {
      await result.current.mutateAsync({ name: 'MY_SECRET', value: 'secret-value' });
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({ name: 'MY_SECRET', value: 'secret-value' });
  });

  it('invalidates secrets queries on success', async () => {
    createMock.mockResolvedValueOnce({ id: 's-1', name: 'SEC' });

    const { result, queryClient } = renderHookWithProviders(() => useCreateSecret());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ name: 'SEC', value: 'val' });
    });

    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([expect.arrayContaining(['secrets'])]));
  });

  it('propagates errors from api.secrets.create', async () => {
    createMock.mockRejectedValueOnce(new Error('Duplicate name'));

    const { result } = renderHookWithProviders(() => useCreateSecret());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'DUP', value: 'val' });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Duplicate name');
  });
});

describe('useUpdateSecret', () => {
  it('calls api.secrets.update(id, input)', async () => {
    updateMock.mockResolvedValueOnce({ id: 's-1', name: 'UPDATED' });

    const { result } = renderHookWithProviders(() => useUpdateSecret());

    await act(async () => {
      await result.current.mutateAsync({ id: 's-1', input: { name: 'UPDATED' } });
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('s-1', { name: 'UPDATED' });
  });

  it('invalidates secrets queries on success', async () => {
    updateMock.mockResolvedValueOnce({ id: 's-1' });

    const { result, queryClient } = renderHookWithProviders(() => useUpdateSecret());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ id: 's-1', input: { name: 'X' } });
    });

    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('useRotateSecret', () => {
  it('calls api.secrets.rotate(id, input)', async () => {
    rotateMock.mockResolvedValueOnce({ id: 's-1' });

    const { result } = renderHookWithProviders(() => useRotateSecret());

    await act(async () => {
      await result.current.mutateAsync({ id: 's-1', input: { value: 'new-val' } });
    });

    expect(rotateMock).toHaveBeenCalledTimes(1);
    expect(rotateMock).toHaveBeenCalledWith('s-1', { value: 'new-val' });
  });
});

describe('useDeleteSecret', () => {
  it('calls api.secrets.delete(id)', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const { result } = renderHookWithProviders(() => useDeleteSecret());

    await act(async () => {
      await result.current.mutateAsync('s-42');
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith('s-42');
  });

  it('invalidates secrets queries on success', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const { result, queryClient } = renderHookWithProviders(() => useDeleteSecret());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('s-42');
    });

    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(expect.arrayContaining([expect.arrayContaining(['secrets'])]));
  });

  it('propagates errors from api.secrets.delete', async () => {
    deleteMock.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHookWithProviders(() => useDeleteSecret());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync('s-bad');
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Not found');
  });
});
