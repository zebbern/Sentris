import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import type { components } from '@sentris/backend-client';

type IntegrationProvider = components['schemas']['IntegrationProviderResponse'];
type IntegrationConnection = components['schemas']['IntegrationConnectionResponse'];

function sortProviders(providers: IntegrationProvider[]) {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name));
}

function sortConnections(connections: IntegrationConnection[]) {
  return [...connections].sort((a, b) => a.providerName.localeCompare(b.providerName));
}

export function useIntegrationProviders() {
  return useQuery({
    queryKey: queryKeys.integrations.providers(),
    queryFn: () => api.integrations.listProviders(),
    staleTime: Infinity,
    gcTime: Infinity,
    select: sortProviders,
  });
}

export function useIntegrationConnections() {
  const userId = useAuthStore((state) => state.userId);
  return useQuery({
    queryKey: queryKeys.integrations.connections(userId),
    queryFn: () => api.integrations.listConnections(),
    staleTime: 60_000,
    select: sortConnections,
  });
}

export function useProviderConfig(providerId: string | undefined, enabled = true) {
  const isEnabled = !!providerId && enabled;
  return useQuery({
    queryKey: queryKeys.integrations.providerConfig(providerId || ''),
    queryFn: isEnabled ? () => api.integrations.getProviderConfig(providerId!) : skipToken,
    staleTime: 30_000,
    ...(isEnabled ? {} : { gcTime: 0 }),
  });
}

export function useRefreshConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.refreshConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useDisconnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.disconnect(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}
