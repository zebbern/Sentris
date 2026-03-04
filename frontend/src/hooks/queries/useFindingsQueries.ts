import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import type { FindingsQueryParams, FindingsResponse } from '@/services/api';

export type { FindingItem, FindingsResponse } from '@/services/api';

export function useFindingsQuery(params: FindingsQueryParams = {}) {
  const keyFilters: Record<string, unknown> = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    severity: params.severity,
    search: params.search,
    sortOrder: params.sortOrder ?? 'desc',
  };

  return useQuery<FindingsResponse>({
    queryKey: queryKeys.findings.all(keyFilters),
    queryFn: () => api.findings.list(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
