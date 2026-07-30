import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Workflow, Play, CalendarClock, Zap, Plus, ArrowRight, Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDashboardData } from '@/hooks/queries/useDashboardQueries';
import { OnboardingChecklist } from '@/components/shared/OnboardingChecklist';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { exportTableData, type ExportColumn } from '@/lib/exportTableData';
import { formatDuration, formatStartTime } from '@/utils/timeFormat';
import { getStatusBadgeClassFromStatus, formatStatusText } from '@/utils/statusBadgeStyles';
import { DashboardOpsPanels } from '@/pages/dashboard/DashboardOpsPanels';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';

// ---------------------------------------------------------------------------
// Export column definitions
// ---------------------------------------------------------------------------

const RECENT_RUNS_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'workflowName', header: 'Workflow' },
  { key: 'status', header: 'Status' },
  { key: 'startTime', header: 'Started' },
  { key: 'duration', header: 'Duration (ms)' },
  { key: 'triggerType', header: 'Trigger' },
  { key: 'id', header: 'Run ID' },
];

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  href?: string;
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
}

function StatCard({ title, value, icon: Icon, href, isLoading, error, onRetry }: StatCardProps) {
  if (error) {
    return (
      <Card>
        <CardContent className="p-3">
          <ErrorBanner message={`Failed to load ${title.toLowerCase()}`} onRetry={onRetry} />
        </CardContent>
      </Card>
    );
  }

  const content = (
    <CardContent className="p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-1.5">
        {isLoading ? (
          <Skeleton className="h-7 w-14" />
        ) : (
          <p
            className={
              typeof value === 'number'
                ? 'text-xl font-bold tracking-tight sm:text-2xl'
                : 'truncate text-base font-bold tracking-tight sm:text-lg'
            }
          >
            {value}
          </p>
        )}
      </div>
    </CardContent>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <Card className="transition-colors hover:bg-muted/30">{content}</Card>
      </Link>
    );
  }

  return <Card className="transition-colors hover:bg-muted/30">{content}</Card>;
}

// ---------------------------------------------------------------------------
// Recent Runs Table
// ---------------------------------------------------------------------------

interface RecentRunsTableProps {
  runs: ExecutionRun[];
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
}

function RecentRunsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

function RecentRunsTable({ runs, isLoading, error, onRetry }: RecentRunsTableProps) {
  const navigate = useNavigate();

  if (error) {
    return <ErrorBanner message="Failed to load recent runs" onRetry={onRetry} />;
  }

  if (isLoading) {
    return <RecentRunsSkeleton />;
  }

  if (runs.length === 0) {
    return (
      <p className="py-5 text-center text-xs text-muted-foreground">
        No runs yet. Execute a workflow to see activity here.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table aria-label="Recent workflow runs" className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 px-3 py-1.5 text-xs">Workflow</TableHead>
            <TableHead className="h-8 px-3 py-1.5 text-xs">Status</TableHead>
            <TableHead className="hidden h-8 px-3 py-1.5 text-xs sm:table-cell">Duration</TableHead>
            <TableHead className="hidden h-8 px-3 py-1.5 text-xs md:table-cell">Started</TableHead>
            <TableHead className="hidden h-8 px-3 py-1.5 text-xs lg:table-cell">Trigger</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              className="cursor-pointer"
              onClick={() => navigate(`/workflows/${run.workflowId}/runs/${run.id}`)}
              tabIndex={0}
              aria-label={`${run.workflowName} — ${formatStatusText(run.status)}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/workflows/${run.workflowId}/runs/${run.id}`);
                }
              }}
            >
              <TableCell className="max-w-[200px] truncate px-3 py-1.5 font-medium">
                {run.workflowName}
              </TableCell>
              <TableCell className="px-3 py-1.5">
                <Badge
                  variant="outline"
                  className={getStatusBadgeClassFromStatus(
                    run.status,
                    'text-[10px] whitespace-nowrap',
                  )}
                >
                  {formatStatusText(run.status)}
                </Badge>
              </TableCell>
              <TableCell className="hidden px-3 py-1.5 text-muted-foreground sm:table-cell">
                {run.duration != null ? formatDuration(run.duration) : '—'}
              </TableCell>
              <TableCell className="hidden px-3 py-1.5 text-muted-foreground md:table-cell">
                {formatStartTime(run.startTime)}
              </TableCell>
              <TableCell className="hidden px-3 py-1.5 capitalize text-muted-foreground lg:table-cell">
                {run.triggerLabel ?? run.triggerType}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Actions
// ---------------------------------------------------------------------------

function QuickActions() {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Button asChild className="gap-2">
        <Link to="/templates?setup=none">
          <Play className="h-4 w-4" />
          Run a Template
        </Link>
      </Button>
      <Button asChild variant="outline" className="gap-2">
        <Link to="/workflows/new">
          <Plus className="h-4 w-4" />
          Build from Scratch
        </Link>
      </Button>
      <Button asChild variant="outline" className="gap-2">
        <Link to="/workflows">
          <Workflow className="h-4 w-4" />
          All Workflows
        </Link>
      </Button>
      <Button asChild variant="outline" className="gap-2">
        <Link to="/schedules">
          <CalendarClock className="h-4 w-4" />
          Schedules
        </Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const {
    stats,
    recentRuns,
    failedRuns,
    pendingActions,
    upcomingSchedules,
    findingsSeverityCounts,
    attentionFindings,
    isLoading,
    sectionLoading,
    errors,
    refetch,
    workflows,
  } = useDashboardData();

  const runsDisplayValue = useMemo(() => {
    if (stats.recentRunsCount === 0) return 'No runs in last 24h';
    const parts: string[] = [];
    if (stats.succeededCount > 0) parts.push(`${stats.succeededCount} succeeded`);
    if (stats.failedCount > 0) parts.push(`${stats.failedCount} failed`);
    return parts.join(', ') || `${stats.recentRunsCount} total`;
  }, [stats]);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Onboarding checklist — shown for new users */}
      <OnboardingChecklist
        totalWorkflows={stats.totalWorkflows}
        hasWorkflowWithNodes={workflows.some((w) => w.nodeCount > 0)}
        totalRuns={recentRuns.length}
        isLoading={isLoading}
      />

      {/* Quick actions */}
      <section aria-label="Quick actions">
        <QuickActions />
      </section>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3 sm:gap-4" aria-busy={isLoading}>
        <StatCard
          title="Workflows"
          value={stats.totalWorkflows}
          icon={Workflow}
          href="/workflows"
          isLoading={isLoading && !errors.workflows}
          error={errors.workflows}
          onRetry={refetch}
        />
        <StatCard
          title="Runs (24h)"
          value={runsDisplayValue}
          icon={Play}
          isLoading={isLoading && !errors.runs}
          error={errors.runs}
          onRetry={refetch}
        />
        <StatCard
          title="Active Schedules"
          value={stats.activeSchedules}
          icon={CalendarClock}
          href="/schedules"
          isLoading={isLoading && !errors.schedules}
          error={errors.schedules}
          onRetry={refetch}
        />
        <StatCard
          title="Pending Actions"
          value={stats.pendingActions}
          icon={Zap}
          href="/action-center"
          isLoading={isLoading && !errors.humanInputs}
          error={errors.humanInputs}
          onRetry={refetch}
        />
      </div>

      {/* Ops overview: attention + findings + upcoming */}
      <section aria-label="Operations overview">
        <DashboardOpsPanels
          failedRuns={failedRuns}
          pendingActions={pendingActions}
          attentionFindings={attentionFindings}
          findingsSeverityCounts={findingsSeverityCounts}
          openFindingsTotal={stats.openFindingsTotal}
          upcomingSchedules={upcomingSchedules}
          sectionLoading={sectionLoading}
          errors={errors}
          onRetry={refetch}
        />
      </section>

      {/* Recent runs */}
      <section aria-label="Recent runs" aria-busy={isLoading && !errors.runs}>
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent Runs</h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={recentRuns.length === 0}
                  aria-label="Export recent runs"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    exportTableData<ExecutionRun>({
                      data: recentRuns,
                      columns: RECENT_RUNS_EXPORT_COLUMNS,
                      filename: 'recent-runs',
                      format: 'csv',
                    })
                  }
                >
                  Download CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    exportTableData<ExecutionRun>({
                      data: recentRuns,
                      columns: RECENT_RUNS_EXPORT_COLUMNS,
                      filename: 'recent-runs',
                      format: 'json',
                    })
                  }
                >
                  Download JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              <Link to="/workflows">
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
        <RecentRunsTable
          runs={recentRuns}
          isLoading={isLoading && !errors.runs}
          error={errors.runs}
          onRetry={refetch}
        />
      </section>
    </div>
  );
}
