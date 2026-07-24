import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { CreateScopeInput, UpdateScopeInput } from '@/types/scopes';

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

export function useScopeRuns(scopeId: string) {
  return useQuery({
    queryKey: [...queryKeys.targets.detail(scopeId), 'runs'],
    queryFn: () => api.executions.listRuns({ scopeId, limit: 50 }),
    enabled: !!scopeId,
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
