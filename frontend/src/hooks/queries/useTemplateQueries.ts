import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Template, TemplateCategory } from '@/types/templates';
import type { PublishTemplateInput } from '@/services/api/templates';

export type { Template, TemplateCategory } from '@/types/templates';
export type {
  PublishTemplateInput,
  PublishTemplateResponse,
  TemplateRepoInfo,
  TemplateRevalidationJobLog,
  TemplateRevalidationJobStatus,
  TemplateRevalidationLogStream,
  TemplateRevalidationResponse,
} from '@/services/api/templates';

export function templateRepoInfoQueryOptions() {
  return {
    queryKey: queryKeys.templates.repoInfo(),
    queryFn: () => api.templates.getRepoInfo(),
    staleTime: Infinity,
    gcTime: Infinity,
  };
}

export function useTemplates(
  filters?: { category?: string; search?: string; tags?: string[] },
  options?: { enabled?: boolean },
) {
  return useQuery<Template[]>({
    queryKey: queryKeys.templates.all(filters as Record<string, unknown>),
    queryFn: () => api.templates.list(filters),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: options?.enabled,
  });
}

export function useTemplateCategories() {
  return useQuery<TemplateCategory[]>({
    queryKey: queryKeys.templates.categories(),
    queryFn: () => api.templates.getCategories(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useTemplateTags() {
  return useQuery<string[]>({
    queryKey: queryKeys.templates.tags(),
    queryFn: () => api.templates.getTags(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSyncTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.templates.sync(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates.root() });
      qc.invalidateQueries({ queryKey: queryKeys.templates.categories() });
      qc.invalidateQueries({ queryKey: queryKeys.templates.tags() });
    },
  });
}

export function useRevalidateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => api.templates.revalidate(templateId),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: queryKeys.templates.root() });
      qc.invalidateQueries({ queryKey: queryKeys.templates.revalidationJobsRoot() });
      qc.invalidateQueries({ queryKey: queryKeys.templates.revalidationJob(job.auditId) });
    },
  });
}

export function usePublishTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PublishTemplateInput) => api.templates.publish(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates.submissions() });
    },
  });
}

export function useTemplateRevalidationJobs(limit = 5, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.templates.revalidationJobs(limit),
    queryFn: enabled ? () => api.templates.listRevalidationJobs(limit) : skipToken,
    staleTime: 30_000,
    refetchInterval: (query) => {
      if (!enabled) return false;
      const jobs = query.state.data ?? [];
      return jobs.some((job) => job.status === 'started') ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useTemplateRevalidationJob(auditId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.templates.revalidationJob(auditId ?? '__no-audit__'),
    queryFn: auditId ? () => api.templates.getRevalidationJob(auditId) : skipToken,
    staleTime: 0,
    refetchInterval: (query) => {
      if (!auditId) return false;
      return query.state.data?.status === 'completed' ? false : 5_000;
    },
    refetchIntervalInBackground: false,
  });
}

export function useTemplateRevalidationJobLog(
  auditId: string | null | undefined,
  stream: 'stdout' | 'stderr' = 'stderr',
  maxBytes = 4096,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;

  return useQuery({
    queryKey: queryKeys.templates.revalidationJobLog(auditId ?? '__no-audit__', stream, maxBytes),
    queryFn:
      auditId && enabled
        ? () => api.templates.getRevalidationJobLog(auditId, { stream, maxBytes })
        : skipToken,
    staleTime: 10_000,
  });
}

export function useUseTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      workflowName,
      secretMappings,
    }: {
      templateId: string;
      workflowName: string;
      secretMappings?: Record<string, string>;
    }) => api.templates.use(templateId, { workflowName, secretMappings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workflows.list() });
    },
  });
}
