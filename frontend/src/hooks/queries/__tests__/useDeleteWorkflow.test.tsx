import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';
import { cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — follow established project pattern (SecretsManager.test.tsx):
// mock @tanstack/react-query and @/services/api, then test hook logic.
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

const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
let capturedMutationOptions: any = null;

mock.module('@tanstack/react-query', () => {
  return {
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
    }),
    useMutation: (options: any) => {
      capturedMutationOptions = options;
      return {
        mutate: vi.fn(),
        mutateAsync: async (args: any) => {
          const result = await options.mutationFn(args);
          if (options.onSuccess) {
            options.onSuccess(result, args, {});
          }
          return result;
        },
        isPending: false,
        error: null,
        isError: false,
        isSuccess: false,
        reset: vi.fn(),
      };
    },
    useQuery: vi.fn(),
    QueryClientProvider: ({ children }: any) => children,
    skipToken: Symbol('skipToken'),
  };
});

import { useDeleteWorkflow } from '../useWorkflowQueries';

afterEach(cleanup);

beforeEach(() => {
  deleteMock.mockReset();
  invalidateQueriesMock.mockClear();
  capturedMutationOptions = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDeleteWorkflow', () => {
  it('calls api.workflows.delete(id) via mutationFn', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const hook = useDeleteWorkflow();
    await hook.mutateAsync('wf-123');

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith('wf-123');
  });

  it('invalidates workflow list and summary query keys on success', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const hook = useDeleteWorkflow();
    await hook.mutateAsync('wf-1');

    // onSuccess should have called invalidateQueries twice
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);

    const calls = invalidateQueriesMock.mock.calls;
    // Verify both list and summary keys are invalidated
    const invalidatedKeys = calls.map((c: any) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['workflows']),
        expect.arrayContaining(['workflowsSummary']),
      ]),
    );
  });

  it('passes the correct mutationFn to useMutation', () => {
    useDeleteWorkflow();

    expect(capturedMutationOptions).toBeTruthy();
    expect(typeof capturedMutationOptions.mutationFn).toBe('function');
    expect(typeof capturedMutationOptions.onSuccess).toBe('function');
  });

  it('mutationFn delegates to api.workflows.delete', async () => {
    deleteMock.mockResolvedValueOnce({ ok: true });

    useDeleteWorkflow();

    const result = await capturedMutationOptions.mutationFn('wf-789');

    expect(deleteMock).toHaveBeenCalledWith('wf-789');
    expect(result).toEqual({ ok: true });
  });

  it('propagates errors from api.workflows.delete', async () => {
    deleteMock.mockRejectedValueOnce(new Error('Network error'));

    useDeleteWorkflow();

    await expect(capturedMutationOptions.mutationFn('wf-bad')).rejects.toThrow('Network error');
  });
});
