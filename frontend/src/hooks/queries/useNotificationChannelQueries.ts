import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import type { CreateNotificationChannel, UpdateNotificationChannel } from '@sentris/shared';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export function useNotificationChannels() {
  return useQuery({
    queryKey: queryKeys.notificationChannels.all(),
    queryFn: () => api.notificationChannels.list(),
    staleTime: 60_000,
  });
}

export function useNotificationChannel(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.notificationChannels.detail(id || ''),
    queryFn: id ? () => api.notificationChannels.get(id) : skipToken,
    staleTime: 30_000,
  });
}

export function useNotificationChannelDeliveries(
  channelId: string | undefined,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: [...queryKeys.notificationChannels.deliveries(channelId || ''), params] as const,
    queryFn: channelId
      ? () => api.notificationChannels.listDeliveries(channelId, params)
      : skipToken,
    staleTime: 60_000,
  });
}

export function useResendDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, deliveryId }: { channelId: string; deliveryId: string }) =>
      api.notificationChannels.resendDelivery(channelId, deliveryId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: queryKeys.notificationChannels.deliveries(variables.channelId),
      });
    },
  });
}

export function useCreateNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateNotificationChannel) => api.notificationChannels.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationChannels.all() });
    },
  });
}

export function useUpdateNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateNotificationChannel }) =>
      api.notificationChannels.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationChannels.all() });
    },
  });
}

export function useDeleteNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notificationChannels.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationChannels.all() });
    },
  });
}

export function useTestNotificationChannel() {
  return useMutation({
    meta: { suppressGlobalError: true },
    mutationFn: (id: string) => api.notificationChannels.testChannel(id),
  });
}

export function useToggleNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, currentStatus }: { id: string; currentStatus: 'active' | 'inactive' }) =>
      api.notificationChannels.update(id, {
        status: currentStatus === 'active' ? 'inactive' : 'active',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationChannels.all() });
    },
  });
}
