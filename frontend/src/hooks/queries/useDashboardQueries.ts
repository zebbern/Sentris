import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { ExecutionRun } from './useRunQueries';
import type { WorkflowSummary } from '@/services/api/workflows';

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'];
const RECENT_RUNS_LIMIT = 10;

interface DashboardStats {
  totalWorkflows: number;
  recentRunsCount: number;
  succeededCount: number;
  failedCount: number;
  activeSchedules: number;
  pendingActions: number;
}

interface DashboardData {
  stats: DashboardStats;
  recentRuns: ExecutionRun[];
  workflows: WorkflowSummary[];
  isLoading: boolean;
  isError: boolean;
  errors: { workflows?: Error; runs?: Error; schedules?: Error; humanInputs?: Error };
  refetch: () => void;
}

/**
 * Composes data from multiple existing endpoints to build the dashboard view.
 * Uses parallel TanStack Query calls — each section degrades independently.
 */
export function useDashboardData(): DashboardData {
  const workflowsQuery = useQuery({
    queryKey: queryKeys.workflows.summary(),
    queryFn: () => api.workflows.listSummary(),
    staleTime: 60_000,
  });

  const runsQuery = useQuery({
    queryKey: queryKeys.dashboard.recentActivity(),
    queryFn: () => api.executions.listRuns({ limit: RECENT_RUNS_LIMIT }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const schedulesQuery = useQuery({
    queryKey: queryKeys.schedules.all({ status: 'active' } as Record<string, unknown>),
    queryFn: () => api.schedules.list({ status: 'active' }),
    staleTime: 60_000,
  });

  const humanInputsQuery = useQuery({
    queryKey: queryKeys.humanInputs.all({ status: 'pending' } as Record<string, unknown>),
    queryFn: () => api.humanInputs.list({ status: 'pending' }),
    staleTime: 30_000,
  });

  const recentRuns = useMemo(() => {
    const rawRuns = (runsQuery.data?.runs ?? []) as ExecutionRun[];
    return [...rawRuns].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }, [runsQuery.data]);

  const stats = useMemo((): DashboardStats => {
    const workflows = workflowsQuery.data ?? [];
    const runs = recentRuns;
    const schedules = schedulesQuery.data ?? [];
    const humanInputs = humanInputsQuery.data ?? [];

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const last24hRuns = runs.filter((r) => new Date(r.startTime).getTime() >= oneDayAgo);

    return {
      totalWorkflows: workflows.length,
      recentRunsCount: last24hRuns.length,
      succeededCount: last24hRuns.filter((r) => r.status === 'COMPLETED').length,
      failedCount: last24hRuns.filter(
        (r) => TERMINAL_STATUSES.includes(r.status) && r.status !== 'COMPLETED',
      ).length,
      activeSchedules: schedules.length,
      pendingActions: humanInputs.length,
    };
  }, [workflowsQuery.data, recentRuns, schedulesQuery.data, humanInputsQuery.data]);

  const isLoading =
    workflowsQuery.isLoading ||
    runsQuery.isLoading ||
    schedulesQuery.isLoading ||
    humanInputsQuery.isLoading;

  const isError =
    workflowsQuery.isError ||
    runsQuery.isError ||
    schedulesQuery.isError ||
    humanInputsQuery.isError;

  const errors = useMemo(
    () => ({
      workflows: workflowsQuery.error ?? undefined,
      runs: runsQuery.error ?? undefined,
      schedules: schedulesQuery.error ?? undefined,
      humanInputs: humanInputsQuery.error ?? undefined,
    }),
    [workflowsQuery.error, runsQuery.error, schedulesQuery.error, humanInputsQuery.error],
  );

  const refetch = () => {
    void workflowsQuery.refetch();
    void runsQuery.refetch();
    void schedulesQuery.refetch();
    void humanInputsQuery.refetch();
  };

  const workflows = useMemo(
    () => (workflowsQuery.data ?? []) as WorkflowSummary[],
    [workflowsQuery.data],
  );

  return { stats, recentRuns, workflows, isLoading, isError, errors, refetch };
}
