import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';
import { cleanup, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

// ---------------------------------------------------------------------------
// Mocks — only mock the API layer; react-query is provided by the test wrapper.
// ---------------------------------------------------------------------------

const deleteMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    workflows: {
      list: vi.fn(),
      listSummary: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      commit: vi.fn(),
      run: vi.fn(),
      delete: deleteMock,
      getRuntimeInputs: vi.fn(),
    },
  },
}));

// Override any global mock.module for useWorkflowQueries from other test files
// (e.g. WorkflowList.test.tsx) to prevent cross-file mock contamination.
// Provides the real hook logic backed by our mocked @/services/api above.
// Uses closured ESM imports (useMutation, useQueryClient, queryKeys) to avoid
// CJS/ESM React context mismatch that require() would cause.
mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useDeleteWorkflow: () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => deleteMock(id),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.workflows.list() });
        qc.invalidateQueries({ queryKey: queryKeys.workflows.summary() });
      },
    });
  },
}));

import { useDeleteWorkflow } from '../useWorkflowQueries';

afterEach(cleanup);

beforeEach(() => {
  deleteMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDeleteWorkflow', () => {
  it('calls api.workflows.delete(id) via mutateAsync', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const { result } = renderHookWithProviders(() => useDeleteWorkflow());

    await act(async () => {
      await result.current.mutateAsync('wf-123');
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith('wf-123');
  });

  it('invalidates workflow list and summary query keys on success', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const { result, queryClient } = renderHookWithProviders(() => useDeleteWorkflow());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('wf-1');
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    const invalidatedKeys = invalidateSpy.mock.calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['workflows']),
        expect.arrayContaining(['workflowsSummary']),
      ]),
    );
  });

  it('returns the result from the API delete call', async () => {
    deleteMock.mockResolvedValueOnce({ ok: true });

    const { result } = renderHookWithProviders(() => useDeleteWorkflow());

    let deleteResult: any;
    await act(async () => {
      deleteResult = await result.current.mutateAsync('wf-789');
    });

    expect(deleteMock).toHaveBeenCalledWith('wf-789');
    expect(deleteResult).toEqual({ ok: true });
  });

  it('propagates errors from api.workflows.delete', async () => {
    deleteMock.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHookWithProviders(() => useDeleteWorkflow());

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync('wf-bad');
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('Network error');
  });

  it('exposes isPending state initially as false', () => {
    const { result } = renderHookWithProviders(() => useDeleteWorkflow());
    expect(result.current.isPending).toBe(false);
  });
});
