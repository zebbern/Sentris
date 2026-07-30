import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { ExecutionRun } from './useRunQueries';
import type { WorkflowSummary } from '@/services/api/workflows';
import type { FindingItem } from '@/services/api/findings';
import type { HumanInputRequest } from '@/components/workflow/HumanInputResolutionView';
import type { WorkflowSchedule } from '@sentris/shared';

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'];
const FAILURE_STATUSES = new Set(['FAILED', 'TIMED_OUT', 'TERMINATED']);
const RECENT_RUNS_LIMIT = 10;
const FAILED_RUNS_LIMIT = 5;
const UPCOMING_SCHEDULES_LIMIT = 5;
const ATTENTION_FINDINGS_LIMIT = 5;
/** Open triage statuses for dashboard findings views. */
export const OPEN_FINDING_TRIAGE = 'new,triaged,in_progress';
const ATTENTION_SEVERITIES = new Set(['critical', 'high']);

function isFailureStatus(status: string | undefined): boolean {
  return FAILURE_STATUSES.has((status ?? '').toUpperCase());
}

interface DashboardStats {
  totalWorkflows: number;
  recentRunsCount: number;
  succeededCount: number;
  failedCount: number;
  activeSchedules: number;
  pendingActions: number;
  openFindingsTotal: number;
}

export interface DashboardSectionLoading {
  failedRuns: boolean;
  findings: boolean;
  schedules: boolean;
  humanInputs: boolean;
}

interface DashboardData {
  stats: DashboardStats;
  recentRuns: ExecutionRun[];
  failedRuns: ExecutionRun[];
  pendingActions: HumanInputRequest[];
  upcomingSchedules: WorkflowSchedule[];
  findingsSeverityCounts: { severity: string; count: number }[];
  attentionFindings: FindingItem[];
  workflows: WorkflowSummary[];
  isLoading: boolean;
  isError: boolean;
  sectionLoading: DashboardSectionLoading;
  errors: {
    workflows?: Error;
    runs?: Error;
    schedules?: Error;
    humanInputs?: Error;
    findings?: Error;
    failedRuns?: Error;
  };
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

  const failedRunsQuery = useQuery({
    queryKey: queryKeys.dashboard.failedRuns(),
    queryFn: () => api.executions.listRuns({ status: 'FAILED', limit: FAILED_RUNS_LIMIT }),
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

  const findingsStatsQuery = useQuery({
    queryKey: queryKeys.findings.stats({ triageStatus: OPEN_FINDING_TRIAGE }),
    queryFn: () => api.findings.getStats({ triageStatus: OPEN_FINDING_TRIAGE }),
    staleTime: 60_000,
  });

  const findingsListQuery = useQuery({
    queryKey: queryKeys.findings.all({
      triageStatus: OPEN_FINDING_TRIAGE,
      pageSize: 20,
      page: 1,
      sortOrder: 'desc',
    }),
    queryFn: () =>
      api.findings.list({
        triageStatus: OPEN_FINDING_TRIAGE,
        pageSize: 20,
        page: 1,
        sortOrder: 'desc',
      }),
    staleTime: 60_000,
  });

  const recentRuns = useMemo(() => {
    const rawRuns = (runsQuery.data?.runs ?? []) as ExecutionRun[];
    return [...rawRuns].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }, [runsQuery.data]);

  const failedRuns = useMemo(() => {
    const fromQuery = ((failedRunsQuery.data?.runs ?? []) as ExecutionRun[]).filter((run) =>
      isFailureStatus(run.status),
    );
    const fromRecent = recentRuns.filter((run) => isFailureStatus(run.status));
    const byId = new Map<string, ExecutionRun>();
    for (const run of [...fromQuery, ...fromRecent]) {
      byId.set(run.id, run);
    }
    return [...byId.values()]
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, FAILED_RUNS_LIMIT);
  }, [failedRunsQuery.data, recentRuns]);

  const pendingActions = useMemo(
    () => (humanInputsQuery.data ?? []) as HumanInputRequest[],
    [humanInputsQuery.data],
  );

  const upcomingSchedules = useMemo(() => {
    const schedules = (schedulesQuery.data ?? []) as WorkflowSchedule[];
    return [...schedules]
      .filter((s) => s.nextRunAt)
      .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
      .slice(0, UPCOMING_SCHEDULES_LIMIT);
  }, [schedulesQuery.data]);

  const findingsSeverityCounts = useMemo(
    () => findingsStatsQuery.data?.severityCounts ?? [],
    [findingsStatsQuery.data],
  );

  const attentionFindings = useMemo(() => {
    const items = findingsListQuery.data?.items ?? [];
    return items
      .filter((f) => ATTENTION_SEVERITIES.has((f.severity ?? '').toLowerCase()))
      .slice(0, ATTENTION_FINDINGS_LIMIT);
  }, [findingsListQuery.data]);

  const stats = useMemo((): DashboardStats => {
    const workflows = workflowsQuery.data ?? [];
    const runs = recentRuns;
    const schedules = schedulesQuery.data ?? [];

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
      pendingActions: pendingActions.length,
      openFindingsTotal: findingsStatsQuery.data?.total ?? 0,
    };
  }, [
    workflowsQuery.data,
    recentRuns,
    schedulesQuery.data,
    pendingActions.length,
    findingsStatsQuery.data?.total,
  ]);

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

  const sectionLoading = useMemo(
    (): DashboardSectionLoading => ({
      failedRuns: failedRunsQuery.isLoading,
      findings: findingsStatsQuery.isLoading || findingsListQuery.isLoading,
      schedules: schedulesQuery.isLoading,
      humanInputs: humanInputsQuery.isLoading,
    }),
    [
      failedRunsQuery.isLoading,
      findingsStatsQuery.isLoading,
      findingsListQuery.isLoading,
      schedulesQuery.isLoading,
      humanInputsQuery.isLoading,
    ],
  );

  const errors = useMemo(
    () => ({
      workflows: workflowsQuery.error ?? undefined,
      runs: runsQuery.error ?? undefined,
      schedules: schedulesQuery.error ?? undefined,
      humanInputs: humanInputsQuery.error ?? undefined,
      findings: findingsStatsQuery.error ?? findingsListQuery.error ?? undefined,
      failedRuns: failedRunsQuery.error ?? undefined,
    }),
    [
      workflowsQuery.error,
      runsQuery.error,
      schedulesQuery.error,
      humanInputsQuery.error,
      findingsStatsQuery.error,
      findingsListQuery.error,
      failedRunsQuery.error,
    ],
  );

  const refetch = () => {
    void workflowsQuery.refetch();
    void runsQuery.refetch();
    void failedRunsQuery.refetch();
    void schedulesQuery.refetch();
    void humanInputsQuery.refetch();
    void findingsStatsQuery.refetch();
    void findingsListQuery.refetch();
  };

  const workflows = useMemo(
    () => (workflowsQuery.data ?? []) as WorkflowSummary[],
    [workflowsQuery.data],
  );

  return {
    stats,
    recentRuns,
    failedRuns,
    pendingActions,
    upcomingSchedules,
    findingsSeverityCounts,
    attentionFindings,
    workflows,
    isLoading,
    isError,
    sectionLoading,
    errors,
    refetch,
  };
}
