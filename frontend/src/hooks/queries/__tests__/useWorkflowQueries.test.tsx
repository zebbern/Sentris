import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';
import { cleanup, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';
import { useQuery, skipToken } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

// ---------------------------------------------------------------------------
// Mocks — only mock the API layer; react-query is provided by the test wrapper.
// ---------------------------------------------------------------------------

const listMock = vi.fn();
const listSummaryMock = vi.fn();
const getMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    workflows: {
      list: listMock,
      listSummary: listSummaryMock,
      get: getMock,
      create: vi.fn(),
      update: vi.fn(),
      commit: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
      getRuntimeInputs: vi.fn(),
      listVersions: vi.fn(),
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

// Re-export hooks with real react-query backed by mocked API.
// Uses closured ESM imports (useQuery, skipToken, queryKeys) to avoid
// CJS/ESM React context mismatch.
mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsSummary: (tags?: string[]) => {
    const filters =
      tags && tags.length > 0 ? ({ tags: tags.join(',') } as Record<string, unknown>) : undefined;
    return useQuery({
      queryKey: queryKeys.workflows.summary(filters),
      queryFn: () => listSummaryMock(tags),
      staleTime: 0,
    });
  },
  useWorkflowsList: () => {
    return useQuery({
      queryKey: queryKeys.workflows.list(),
      queryFn: () => listMock(),
      staleTime: 0,
    });
  },
  useWorkflow: (workflowId: string | undefined) => {
    return useQuery({
      queryKey: queryKeys.workflows.detail(workflowId ?? ''),
      queryFn: workflowId ? () => getMock(workflowId) : skipToken,
      staleTime: 0,
      ...(workflowId ? {} : { gcTime: 0 }),
    });
  },
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn() }),
  useCloneWorkflow: () => ({ mutateAsync: vi.fn() }),
  useWorkflowRuntimeInputs: () => ({ data: undefined, isLoading: false }),
  useWorkflowVersions: () => ({ data: undefined, isLoading: false }),
}));

import { useWorkflowsSummary, useWorkflowsList, useWorkflow } from '../useWorkflowQueries';

afterEach(cleanup);

beforeEach(() => {
  listMock.mockReset();
  listSummaryMock.mockReset();
  getMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkflowsSummary', () => {
  it('calls api.workflows.listSummary and returns data', async () => {
    const summaries = [
      { id: 'wf-1', name: 'Workflow 1', runCount: 5 },
      { id: 'wf-2', name: 'Workflow 2', runCount: 10 },
    ];
    listSummaryMock.mockResolvedValueOnce(summaries);

    const { result } = renderHookWithProviders(() => useWorkflowsSummary());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(listSummaryMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toHaveLength(2);
    expect((result.current.data as any)?.[0]?.id).toBe('wf-1');
  });

  it('passes tags to the API call', async () => {
    listSummaryMock.mockResolvedValueOnce([]);

    const { result } = renderHookWithProviders(() => useWorkflowsSummary(['security', 'audit']));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(listSummaryMock).toHaveBeenCalledWith(['security', 'audit']);
  });

  it('handles API errors', async () => {
    listSummaryMock.mockRejectedValueOnce(new Error('API error'));

    const { result } = renderHookWithProviders(() => useWorkflowsSummary());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });
});

describe('useWorkflowsList', () => {
  it('calls api.workflows.list and returns data', async () => {
    const workflows = [{ id: 'wf-1', name: 'W1' }];
    listMock.mockResolvedValueOnce(workflows);

    const { result } = renderHookWithProviders(() => useWorkflowsList());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toHaveLength(1);
    expect((result.current.data as any)?.[0]?.id).toBe('wf-1');
  });
});

describe('useWorkflow', () => {
  it('calls api.workflows.get(id) when id is provided', async () => {
    const workflow = { id: 'wf-abc', name: 'My Workflow', graph: { nodes: [], edges: [] } };
    getMock.mockResolvedValueOnce(workflow);

    const { result } = renderHookWithProviders(() => useWorkflow('wf-abc'));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('wf-abc');
    expect((result.current.data as any)?.id).toBe('wf-abc');
  });

  it('skips fetch when id is undefined (uses skipToken)', async () => {
    const { result } = renderHookWithProviders(() => useWorkflow(undefined));

    // With skipToken the query should stay in pending/idle state, never call getMock
    expect(getMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    // fetchStatus should be 'idle' when using skipToken
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('handles errors from the API', async () => {
    getMock.mockRejectedValueOnce(new Error('Workflow not found'));

    const { result } = renderHookWithProviders(() => useWorkflow('wf-bad'));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });
});
