import { useQuery, keepPreviousData, skipToken } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import type {
  FindingsQueryParams,
  FindingsResponse,
  FindingDetailResponse,
  FindingsStatsResponse,
  FindingsStatsParams,
} from '@/services/api';

export type { FindingItem, FindingsResponse } from '@/services/api';

export function useFindingsQuery(params: FindingsQueryParams = {}) {
  const keyFilters: Record<string, unknown> = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    severity: params.severity,
    search: params.search,
    sortOrder: params.sortOrder ?? 'desc',
    workflowId: params.workflowId,
    componentId: params.componentId,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  };

  return useQuery<FindingsResponse>({
    queryKey: queryKeys.findings.all(keyFilters),
    queryFn: () => api.findings.list(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useFindingDetailQuery(id: string | null) {
  return useQuery<FindingDetailResponse>({
    queryKey: queryKeys.findings.detail(id ?? ''),
    queryFn: id ? () => api.findings.get(id) : skipToken,
    staleTime: 60_000,
  });
}

export function useFindingsStatsQuery(params: FindingsStatsParams = {}) {
  return useQuery<FindingsStatsResponse>({
    queryKey: queryKeys.findings.stats(params),
    queryFn: () => api.findings.getStats(params),
    staleTime: 60_000,
  });
}
