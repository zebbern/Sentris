import { describe, it, expect, afterEach, vi, mock } from 'bun:test';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const getStatsMock = vi.fn();
const listMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    findings: {
      list: listMock,
      get: getMock,
      getStats: getStatsMock,
      exportFindings: vi.fn(),
    },
  },
}));

// Store must be mocked before queryKeys import (queryKeys imports authStore)
mock.module('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ organizationId: 'org-test', userId: 'user-test' }),
  },
}));

import { useFindingDetailQuery, useFindingsStatsQuery } from '../useFindingsQueries';

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

function createWrapper() {
  const qc = createTestQueryClient();
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
