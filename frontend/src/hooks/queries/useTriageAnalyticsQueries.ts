import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { triageAnalyticsApi } from '@/services/api/triage-analytics';
import type {
  PostureTrendResponse,
  TriageVelocityResponse,
  MttrResponse,
  SlaComplianceResponse,
  StatusDistributionResponse,
  TopAssigneesResponse,
  SlaPoliciesResponse,
  UpsertSlaPoliciesBody,
} from '@/services/api/triage-analytics';
import { useToast } from '@/components/ui/use-toast';

// ---------------------------------------------------------------------------
// Analytics query hooks (staleTime: 60s — not real-time but periodic refresh)
// ---------------------------------------------------------------------------

export function usePostureTrend(period: string) {
  return useQuery<PostureTrendResponse>({
    queryKey: queryKeys.triageAnalytics.postureTrend(period),
    queryFn: () => triageAnalyticsApi.getPostureTrend(period),
    staleTime: 60_000,
  });
}

export function useTriageVelocity(period: string) {
  return useQuery<TriageVelocityResponse>({
    queryKey: queryKeys.triageAnalytics.triageVelocity(period),
    queryFn: () => triageAnalyticsApi.getTriageVelocity(period),
    staleTime: 60_000,
  });
}

export function useMttr(period: string) {
  return useQuery<MttrResponse>({
    queryKey: queryKeys.triageAnalytics.mttr(period),
    queryFn: () => triageAnalyticsApi.getMttr(period),
    staleTime: 60_000,
  });
}

export function useSlaCompliance(period: string) {
  return useQuery<SlaComplianceResponse>({
    queryKey: queryKeys.triageAnalytics.slaCompliance(period),
    queryFn: () => triageAnalyticsApi.getSlaCompliance(period),
    staleTime: 60_000,
  });
}

export function useStatusDistribution() {
  return useQuery<StatusDistributionResponse>({
    queryKey: queryKeys.triageAnalytics.statusDistribution(),
    queryFn: () => triageAnalyticsApi.getStatusDistribution(),
    staleTime: 60_000,
  });
}

export function useTopAssignees(limit = 10) {
  return useQuery<TopAssigneesResponse>({
    queryKey: queryKeys.triageAnalytics.topAssignees(limit),
    queryFn: () => triageAnalyticsApi.getTopAssignees(limit),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// SLA Policies (staleTime: Infinity — reference/config data)
// ---------------------------------------------------------------------------

export function useSlaPolicies() {
  return useQuery<SlaPoliciesResponse>({
    queryKey: queryKeys.slaPolicies.all(),
    queryFn: () => triageAnalyticsApi.getSlaPolicies(),
    staleTime: Infinity,
  });
}

export function useUpsertSlaPolicies() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation<SlaPoliciesResponse, Error, UpsertSlaPoliciesBody>({
    mutationFn: (body) => triageAnalyticsApi.upsertSlaPolicies(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.slaPolicies.all() });
      toast({
        title: 'SLA policies saved',
        description: 'Deadline thresholds have been updated.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to save SLA policies',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    },
  });
}
