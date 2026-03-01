import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { WebhookConfiguration } from '@sentris/shared';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export function useWebhooks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.webhooks.all(),
    queryFn: () => api.webhooks.list(),
    staleTime: 60_000,
    enabled: options?.enabled,
  });
}

export function useWebhook(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.webhooks.detail(id || ''),
    queryFn: () => api.webhooks.get(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useWebhookDeliveries(webhookId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.webhooks.deliveries(webhookId || ''),
    queryFn: () => api.webhooks.listDeliveries(webhookId!),
    enabled: !!webhookId,
    staleTime: 60_000,
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.webhooks.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks.all() });
    },
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<WebhookConfiguration>) => api.webhooks.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks.all() });
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<WebhookConfiguration> }) =>
      api.webhooks.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks.all() });
    },
  });
}

export function useRegenerateWebhookPath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return api.post<{ id: string; webhookPath: string; url: string }>(
        `/webhooks/configurations/${id}/regenerate-path`,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks.all() });
    },
  });
}

export function useTestWebhookScript() {
  return useMutation({
    meta: { suppressGlobalError: true },
    mutationFn: (dto: {
      parsingScript: string;
      testPayload: Record<string, unknown>;
      testHeaders?: Record<string, string>;
      webhookId?: string;
    }) =>
      api.webhooks.testScript({
        script: dto.parsingScript,
        payload: dto.testPayload,
        headers: dto.testHeaders ?? {},
      }),
  });
}
