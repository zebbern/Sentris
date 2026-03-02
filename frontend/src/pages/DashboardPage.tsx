import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Workflow,
  Play,
  CalendarClock,
  Zap,
  Plus,
  Package,
  ArrowRight,
  Download,
} from 'lucide-react';
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
  value: number;
  icon: React.ElementType;
  subtitle?: string;
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
}

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  isLoading,
  error,
  onRetry,
}: StatCardProps) {
  if (error) {
    return (
      <Card>
        <CardContent className="p-5">
          <ErrorBanner message={`Failed to load ${title.toLowerCase()}`} onRetry={onRetry} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="mt-2">
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-3xl font-bold tracking-tight">{value}</p>
          )}
        </div>
        {subtitle && !isLoading && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        {isLoading && <Skeleton className="mt-1 h-3 w-24" />}
      </CardContent>
    </Card>
  );
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
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
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
      <p className="py-8 text-center text-sm text-muted-foreground">
        No runs yet. Execute a workflow to see activity here.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table aria-label="Recent workflow runs">
        <TableHeader>
          <TableRow>
            <TableHead>Workflow</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Duration</TableHead>
            <TableHead className="hidden md:table-cell">Started</TableHead>
            <TableHead className="hidden lg:table-cell">Trigger</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              className="cursor-pointer"
              onClick={() => navigate(`/workflows/${run.workflowId}/runs/${run.id}`)}
              role="link"
              tabIndex={0}
              aria-label={`${run.workflowName} — ${formatStatusText(run.status)}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/workflows/${run.workflowId}/runs/${run.id}`);
                }
              }}
            >
              <TableCell className="font-medium max-w-[200px] truncate">
                {run.workflowName}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={getStatusBadgeClassFromStatus(run.status, 'text-xs whitespace-nowrap')}
                >
                  {formatStatusText(run.status)}
                </Badge>
              </TableCell>
              <TableCell className="hidden sm:table-cell text-muted-foreground">
                {run.duration != null ? formatDuration(run.duration) : '—'}
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {formatStartTime(run.startTime)}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground capitalize">
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
    <div className="flex flex-wrap gap-3">
      <Button asChild variant="outline" className="gap-2">
        <Link to="/workflows/new">
          <Plus className="h-4 w-4" />
          Create Workflow
        </Link>
      </Button>
      <Button asChild variant="outline" className="gap-2">
        <Link to="/templates">
          <Package className="h-4 w-4" />
          Template Library
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
  const { stats, recentRuns, isLoading, errors, refetch, workflows } = useDashboardData();

  const runsSubtitle = useMemo(() => {
    if (stats.recentRunsCount === 0) return 'No runs in last 24h';
    const parts: string[] = [];
    if (stats.succeededCount > 0) parts.push(`${stats.succeededCount} succeeded`);
    if (stats.failedCount > 0) parts.push(`${stats.failedCount} failed`);
    return parts.join(', ') || `${stats.recentRunsCount} total`;
  }, [stats]);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Page heading */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
      </div>

      {/* Onboarding checklist — shown for new users */}
      <OnboardingChecklist
        totalWorkflows={stats.totalWorkflows}
        hasWorkflowWithNodes={workflows.some((w) => w.nodeCount > 0)}
        totalRuns={recentRuns.length}
        isLoading={isLoading}
      />

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-busy={isLoading}>
        <StatCard
          title="Workflows"
          value={stats.totalWorkflows}
          icon={Workflow}
          isLoading={isLoading && !errors.workflows}
          error={errors.workflows}
          onRetry={refetch}
        />
        <StatCard
          title="Runs (24h)"
          value={stats.recentRunsCount}
          icon={Play}
          subtitle={runsSubtitle}
          isLoading={isLoading && !errors.runs}
          error={errors.runs}
          onRetry={refetch}
        />
        <StatCard
          title="Active Schedules"
          value={stats.activeSchedules}
          icon={CalendarClock}
          isLoading={isLoading && !errors.schedules}
          error={errors.schedules}
          onRetry={refetch}
        />
        <StatCard
          title="Pending Actions"
          value={stats.pendingActions}
          icon={Zap}
          isLoading={isLoading && !errors.humanInputs}
          error={errors.humanInputs}
          onRetry={refetch}
        />
      </div>

      {/* Recent runs */}
      <section aria-label="Recent runs" aria-busy={isLoading && !errors.runs}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Recent Runs</h2>
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

      {/* Quick actions */}
      <section aria-label="Quick actions">
        <h2 className="text-lg font-semibold tracking-tight mb-4">Quick Actions</h2>
        <QuickActions />
      </section>
    </div>
  );
}
