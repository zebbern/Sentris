import { describe, it, expect, afterEach, vi, mock } from 'bun:test';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const getStatsMock = vi.fn();
const listMock = vi.fn();
const updateTriageMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    findings: {
      list: listMock,
      get: getMock,
      getStats: getStatsMock,
      updateTriage: updateTriageMock,
      exportFindings: vi.fn(),
    },
  },
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Store must be mocked before queryKeys import (queryKeys imports authStore)
mock.module('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ organizationId: 'org-test', userId: 'user-test' }),
  },
}));

import {
  useFindingDetailQuery,
  useFindingsStatsQuery,
  useUpdateTriageMutation,
} from '../useFindingsQueries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useFindingDetailQuery
// ---------------------------------------------------------------------------

describe('useFindingDetailQuery', () => {
  it('is disabled when id is null', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useFindingDetailQuery(null), { wrapper });

    // Should not trigger a fetch — status should be pending (disabled)
    expect(result.current.isFetching).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('enables and fetches when id is provided', async () => {
    const mockFinding = {
      id: 'f-1',
      timestamp: '2025-06-15T12:00:00.000Z',
      severity: 'high',
      name: 'XSS',
      raw: { severity: 'high' },
      availability: 'available' as const,
    };
    getMock.mockResolvedValueOnce(mockFinding);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useFindingDetailQuery('f-1'), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(getMock).toHaveBeenCalledWith('f-1');
    expect(result.current.data).toEqual(mockFinding);
  });
});

// ---------------------------------------------------------------------------
// useFindingsStatsQuery
// ---------------------------------------------------------------------------

describe('useFindingsStatsQuery', () => {
  it('fetches stats on mount', async () => {
    const mockStats = {
      severityCounts: [
        { severity: 'critical', count: 3 },
        { severity: 'high', count: 10 },
      ],
      total: 13,
      availability: 'available' as const,
      schemaCoverage: { canonical: 13, legacy: 0, invalid: 0 },
    };
    getStatsMock.mockResolvedValueOnce(mockStats);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useFindingsStatsQuery(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(getStatsMock).toHaveBeenCalled();
    expect(result.current.data?.severityCounts).toHaveLength(2);
    expect(result.current.data?.total).toBe(13);
  });
});

describe('useUpdateTriageMutation', () => {
  it('optimistically preserves explicit null clears', async () => {
    const qc = createTestQueryClient();
    const queryKey = ['findings', 'org-test', 'list'];
    qc.setQueryData(queryKey, {
      items: [
        {
          id: 'f-1',
          triage: {
            status: 'triaged',
            assigneeUserId: 'user-1',
            severityOverride: 'high',
            notes: 'existing note',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      availability: 'available',
    });
    updateTriageMock.mockResolvedValueOnce({
      id: 'triage-1',
      findingOpensearchId: 'f-1',
      status: 'triaged',
      assigneeUserId: null,
      severityOverride: null,
      notes: null,
      slaDeadline: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z',
      projectionVersion: 2,
    });

    const { result } = renderHook(() => useUpdateTriageMutation(), {
      wrapper: createWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        findingId: 'f-1',
        data: {
          assigneeUserId: null,
          severityOverride: null,
          notes: null,
        },
      });
    });

    const cached = qc.getQueryData<{
      items: {
        triage: {
          assigneeUserId: string | null;
          severityOverride: string | null;
          notes: string | null;
        };
      }[];
    }>(queryKey);
    expect(cached?.items[0]?.triage).toMatchObject({
      assigneeUserId: null,
      severityOverride: null,
      notes: null,
    });
  });
});
