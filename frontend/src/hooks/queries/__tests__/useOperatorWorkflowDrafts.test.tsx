import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, waitFor } from '@testing-library/react';
import type { OperatorWorkflowDraftDetail } from '@sentris/shared';

import { queryKeys } from '@/lib/queryKeys';
import { createTestQueryClient, renderHookWithProviders } from '@/test/render-with-providers';
import { restoreMockedModules } from '@/test/restore-mocks';

const listWorkflowDrafts = mock(
  async (_sessionId: string): Promise<OperatorWorkflowDraftDetail[]> => [],
);

mock.module('@/services/api', () => ({
  api: {
    operator: {
      listWorkflowDrafts,
    },
  },
}));

const { useOperatorWorkflowDraftForBuilder, useOperatorWorkflowDrafts } =
  await import('../useOperatorQueries');

afterEach(() => {
  cleanup();
  listWorkflowDrafts.mockClear();
});

afterAll(() => restoreMockedModules(['@/services/api']));

describe('useOperatorWorkflowDrafts', () => {
  it('loads every draft for one session through the batch endpoint', async () => {
    const { result } = renderHookWithProviders(() => useOperatorWorkflowDrafts('session/1'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listWorkflowDrafts).toHaveBeenCalledTimes(1);
    expect(listWorkflowDrafts).toHaveBeenCalledWith('session/1');
  });

  it('uses skipToken when no session is selected', async () => {
    const { result } = renderHookWithProviders(() => useOperatorWorkflowDrafts(undefined));

    expect(result.current.fetchStatus).toBe('idle');
    expect(listWorkflowDrafts).not.toHaveBeenCalled();
  });

  it('refetches once the session projection reports a newly succeeded proposal', async () => {
    const draft = { draftId: 'draft-1' } as OperatorWorkflowDraftDetail;
    listWorkflowDrafts.mockResolvedValueOnce([]).mockResolvedValueOnce([draft]);

    const { result, rerender } = renderHookWithProviders(
      ({ expectedDraftCount }: { expectedDraftCount: number }) =>
        useOperatorWorkflowDrafts('session/1', false, expectedDraftCount),
      { initialProps: { expectedDraftCount: 0 } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);

    rerender({ expectedDraftCount: 1 });

    await waitFor(() => expect(result.current.data).toEqual([draft]));
    expect(listWorkflowDrafts).toHaveBeenCalledTimes(2);
  });

  it('forces a fresh Builder read when a still-fresh cached list misses the requested draft', async () => {
    const queryClient = createTestQueryClient();
    const sessionId = 'session/1';
    const draft = { draftId: 'draft-1' } as OperatorWorkflowDraftDetail;
    queryClient.setQueryData(queryKeys.operator.workflowDrafts(sessionId), []);
    listWorkflowDrafts.mockResolvedValueOnce([draft]);

    const { result } = renderHookWithProviders(
      () => useOperatorWorkflowDraftForBuilder(sessionId, draft.draftId),
      { queryClient },
    );

    expect(result.current.data).toEqual([]);
    expect(result.current.draft).toBeNull();
    expect(result.current.isDraftLoading).toBe(true);

    await waitFor(() => expect(result.current.draft).toEqual(draft));
    expect(result.current.isDraftLoading).toBe(false);
    expect(listWorkflowDrafts).toHaveBeenCalledTimes(1);
  });
});
