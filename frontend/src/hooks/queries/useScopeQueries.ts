import { useMemo } from 'react';
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { CreateScopeInput, UpdateScopeInput } from '@/types/scopes';
import type { FindingItem } from '@/services/api/findings';

export function useScopes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.targets.all(),
    queryFn: () => api.scopes.list(),
    enabled: options?.enabled,
  });
}

export function useScope(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.targets.detail(id),
    queryFn: () => api.scopes.get(id),
    enabled: options?.enabled ?? Boolean(id),
  });
}

export interface ScopeRunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startTime: string;
  duration?: number;
  triggerLabel?: string | null;
}

const SCOPE_RUN_PAGE_SIZE = 50;
const SCOPE_FINDING_PAGE_SIZE = 50;

export function useScopeRuns(scopeId: string) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.targets.runs(scopeId),
    queryFn: scopeId
      ? async ({ pageParam }) => {
          const response = await api.executions.listRuns({
            scopeId,
            limit: SCOPE_RUN_PAGE_SIZE,
            offset: pageParam,
          });
          return (response.runs ?? []) as unknown as ScopeRunSummary[];
        }
      : skipToken,
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.length === SCOPE_RUN_PAGE_SIZE ? lastPageParam + SCOPE_RUN_PAGE_SIZE : undefined,
  });
  const runs = useMemo(() => query.data?.pages.flat() ?? undefined, [query.data?.pages]);

  return { ...query, data: runs };
}

export function useTargetAssets(scopeId: string) {
  return useQuery({
    queryKey: queryKeys.targets.assets(scopeId),
    queryFn: () => api.assets.listByScope(scopeId),
    enabled: Boolean(scopeId),
  });
}

export function useTargetFindings(scopeId: string, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.targets.findings(scopeId),
    queryFn:
      scopeId && enabled
        ? ({ pageParam }) =>
            api.findings.list({
              scopeId,
              page: pageParam.page,
              pageSize: SCOPE_FINDING_PAGE_SIZE,
              paginationMode: 'cursor',
              cursor: pageParam.cursor,
            })
        : skipToken,
    initialPageParam: {
      page: 1,
      cursor: undefined as string | undefined,
    },
    getNextPageParam: (lastPage) =>
      lastPage.nextCursor
        ? {
            page: lastPage.page + 1,
            cursor: lastPage.nextCursor,
          }
        : undefined,
  });
  const findings = useMemo<FindingItem[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages],
  );
  const availability: 'available' | 'degraded' | undefined = query.data?.pages.some(
    (page) => page.availability === 'degraded',
  )
    ? 'degraded'
    : query.data
      ? 'available'
      : undefined;
  const degradedReasons = useMemo(
    () =>
      Array.from(
        new Set(
          query.data?.pages.flatMap((page) => {
            const reasons = page.degradedReasons ?? [];
            if (page.projectionHealth?.reason && !reasons.includes(page.projectionHealth.reason)) {
              return [...reasons, page.projectionHealth.reason];
            }
            return reasons;
          }) ?? [],
        ),
      ),
    [query.data?.pages],
  );
  const projectionHealth = useMemo(
    () =>
      query.data?.pages.find((page) => page.projectionHealth?.availability === 'degraded')
        ?.projectionHealth ?? query.data?.pages[query.data.pages.length - 1]?.projectionHealth,
    [query.data?.pages],
  );
  const schemaCoverage = query.data?.pages[query.data.pages.length - 1]?.schemaCoverage;

  return {
    ...query,
    data: findings,
    availability,
    degradedReasons,
    projectionHealth,
    schemaCoverage,
  };
}

export function useAssetRunComparison(
  scopeId: string,
  baselineRunId: string | null,
  currentRunId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.targets.assetComparison(
      scopeId,
      baselineRunId ?? '__no-baseline__',
      currentRunId ?? '__no-current__',
    ),
    queryFn:
      scopeId && baselineRunId && currentRunId
        ? () => api.assets.compareRuns(scopeId, baselineRunId, currentRunId)
        : skipToken,
    staleTime: Infinity,
  });
}

export function useCreateScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateScopeInput) => api.scopes.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.targets.root() });
    },
  });
}

export function useUpdateScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateScopeInput }) =>
      api.scopes.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.targets.root() });
    },
  });
}

export function useDeleteScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.scopes.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.targets.root() });
    },
  });
}
