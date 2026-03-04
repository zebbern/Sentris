import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  skipToken,
} from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import type {
  FindingsQueryParams,
  FindingsResponse,
  FindingDetailResponse,
  FindingsStatsResponse,
  FindingsStatsParams,
  FindingTriageResponse,
  FindingTriageEventResponse,
  BulkTriageResult,
  OrgMembersResponse,
} from '@/services/api';
import type { UpdateFindingTriage, BulkTriage } from '@sentris/shared';
import { useToast } from '@/components/ui/use-toast';

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
    triageStatus: params.triageStatus,
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
    queryKey: queryKeys.findings.stats(params as Record<string, unknown>),
    queryFn: () => api.findings.getStats(params),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Triage mutations
// ---------------------------------------------------------------------------

export function useUpdateTriageMutation() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation<
    FindingTriageResponse,
    Error,
    { findingId: string; data: UpdateFindingTriage },
    { previousData: FindingsResponse | undefined; queryKey: readonly unknown[] }
  >({
    mutationFn: ({ findingId, data }) => api.findings.updateTriage(findingId, data),
    onMutate: async ({ findingId, data }) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: ['findings'] });

      // Snapshot current findings cache (first matching query)
      const queriesData = qc.getQueriesData<FindingsResponse>({ queryKey: ['findings'] });
      const firstMatch = queriesData.find(([, d]) =>
        d?.items?.some((item) => item.id === findingId),
      );
      const queryKey = firstMatch?.[0] ?? ['findings'];
      const previousData = firstMatch?.[1];

      // Optimistically update cache
      if (previousData) {
        qc.setQueryData<FindingsResponse>(queryKey, {
          ...previousData,
          items: previousData.items.map((item) =>
            item.id === findingId
              ? {
                  ...item,
                  triage: {
                    status: data.status ?? item.triage?.status ?? 'new',
                    assigneeUserId: data.assigneeUserId ?? item.triage?.assigneeUserId ?? null,
                    severityOverride:
                      data.severityOverride ?? item.triage?.severityOverride ?? null,
                    notes: data.notes ?? item.triage?.notes ?? null,
                    updatedAt: new Date().toISOString(),
                  },
                }
              : item,
          ),
        });
      }

      return { previousData, queryKey };
    },
    onError: (_err, _vars, context) => {
      // Rollback optimistic update
      if (context?.previousData) {
        qc.setQueryData(context.queryKey, context.previousData);
      }
      toast({
        title: 'Failed to update status',
        description: _err.message || 'The status change could not be saved. Please try again.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['findings'] });
    },
  });
}

export function useBulkTriageMutation() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation<BulkTriageResult, Error, BulkTriage>({
    mutationFn: (data) => api.findings.bulkTriage(data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['findings'] });

      if (result.failureCount === 0) {
        toast({
          title: 'Bulk update complete',
          description: `${result.successCount} finding${result.successCount !== 1 ? 's' : ''} updated.`,
        });
      } else {
        toast({
          title: 'Bulk update partially complete',
          description: `${result.successCount} succeeded, ${result.failureCount} failed.`,
          variant: 'destructive',
        });
      }
    },
    onError: (err) => {
      toast({
        title: 'Bulk update failed',
        description: err.message || 'Could not apply bulk changes.',
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// History query
// ---------------------------------------------------------------------------

export function useFindingHistoryQuery(findingId: string | null, limit = 50) {
  return useQuery<{ events: FindingTriageEventResponse[] }>({
    queryKey: queryKeys.findings.history(findingId ?? ''),
    queryFn: findingId ? () => api.findings.getHistory(findingId, limit) : skipToken,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Org members query
// ---------------------------------------------------------------------------

export function useOrgMembersQuery() {
  return useQuery<OrgMembersResponse>({
    queryKey: queryKeys.orgMembers.all(),
    queryFn: () => api.orgMembers.list(),
    staleTime: 5 * 60_000, // 5 minutes — org membership changes rarely
  });
}
