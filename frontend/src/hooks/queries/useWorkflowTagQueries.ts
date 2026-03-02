import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

interface WorkflowTagInfo {
  name: string;
  count: number;
}

interface AllTagsResponse {
  tags: WorkflowTagInfo[];
}

interface SetWorkflowTagsResponse {
  tags: string[];
}

/** Fetches all unique tags with their usage counts. */
export function useWorkflowTags() {
  return useQuery({
    queryKey: queryKeys.workflowTags.all(),
    queryFn: () => api.get<AllTagsResponse>('/workflow-tags'),
    staleTime: 60_000,
    select: (data) => data.tags,
  });
}

interface SetTagsVariables {
  workflowId: string;
  tags: string[];
}

/** Mutation to replace all tags on a workflow. Invalidates summary + tags queries. */
export function useSetWorkflowTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, tags }: SetTagsVariables) =>
      api.patch<SetWorkflowTagsResponse>(`/workflows/${workflowId}/tags`, { tags }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workflows.summary() });
      qc.invalidateQueries({ queryKey: queryKeys.workflowTags.all() });
    },
  });
}
