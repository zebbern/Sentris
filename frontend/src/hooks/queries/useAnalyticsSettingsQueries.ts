import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { UpdateAnalyticsSettingsInput } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export function useAnalyticsSettings() {
  return useQuery({
    queryKey: queryKeys.analyticsSettings.all(),
    queryFn: () => api.analyticsSettings.get(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useUpdateAnalyticsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAnalyticsSettingsInput) => api.analyticsSettings.update(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.analyticsSettings.all() });
    },
  });
}
