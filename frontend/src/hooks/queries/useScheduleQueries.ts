import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScheduleStatus, WorkflowSchedule } from '@shipsec/shared';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

/** Stable empty array to avoid new-reference re-renders when data is undefined. */
const EMPTY_SCHEDULES: WorkflowSchedule[] = [];

export type StatusFilter = ScheduleStatus | 'all';

interface ScheduleQueryFilters {
  workflowId?: string | null;
  status?: StatusFilter;
}

function buildApiFilters(filters?: ScheduleQueryFilters) {
  return {
    workflowId: filters?.workflowId ?? undefined,
    status:
      filters?.status && filters.status !== 'all' ? (filters.status as ScheduleStatus) : undefined,
  };
}

export function useSchedules(filters?: ScheduleQueryFilters, options?: { enabled?: boolean }) {
  const apiFilters = buildApiFilters(filters);
  return useQuery({
    queryKey: queryKeys.schedules.all(apiFilters as Record<string, unknown>),
    queryFn: () => api.schedules.list(apiFilters),
    staleTime: 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
    placeholderData: EMPTY_SCHEDULES,
    enabled: options?.enabled,
  });
}

export function usePauseSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.schedules.pause(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    },
  });
}

export function useResumeSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.schedules.resume(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    },
  });
}

export function useRunSchedule() {
  return useMutation({
    mutationFn: (id: string) => api.schedules.runNow(id),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.schedules.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    },
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.schedules.create>[0]) =>
      api.schedules.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    },
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof api.schedules.update>[1];
    }) => api.schedules.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    },
  });
}
