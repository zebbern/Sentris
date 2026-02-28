import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export function useWorkflowsSummary() {
  return useQuery({
    queryKey: queryKeys.workflows.summary(),
    queryFn: () => api.workflows.listSummary(),
    staleTime: 60_000,
  });
}

export function useWorkflowsList() {
  return useQuery({
    queryKey: queryKeys.workflows.list(),
    queryFn: () => api.workflows.list(),
    staleTime: 30_000,
  });
}

export function useWorkflow(workflowId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflows.detail(workflowId ?? ''),
    queryFn: workflowId ? () => api.workflows.get(workflowId) : skipToken,
    staleTime: 60_000,
    ...(workflowId ? {} : { gcTime: 0 }),
  });
}

export function useWorkflowRuntimeInputs(workflowId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflows.runtimeInputs(workflowId ?? ''),
    queryFn: workflowId ? () => api.workflows.getRuntimeInputs(workflowId) : skipToken,
    staleTime: 30_000,
    ...(workflowId ? {} : { gcTime: 0 }),
  });
}

export function useWorkflowVersions(workflowId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflows.versions(workflowId ?? ''),
    queryFn: workflowId ? () => api.workflows.listVersions(workflowId) : skipToken,
    staleTime: 30_000,
    ...(workflowId ? {} : { gcTime: 0 }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.workflows.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workflows.list() });
      qc.invalidateQueries({ queryKey: queryKeys.workflows.summary() });
    },
  });
}

export function useCloneWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const source = await api.workflows.get(id);
      return api.workflows.create({
        name: `${source.name} (Copy)`,
        description: source.description ?? '',
        nodes: source.graph.nodes,
        edges: source.graph.edges,
        viewport: source.graph.viewport,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workflows.list() });
      qc.invalidateQueries({ queryKey: queryKeys.workflows.summary() });
    },
  });
}
