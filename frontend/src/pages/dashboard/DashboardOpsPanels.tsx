import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SeverityBadge } from '@/features/findings/SeverityBadge';
import { formatStartTime } from '@/utils/timeFormat';
import { formatStatusText, getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';
import type { FindingItem } from '@/services/api/findings';
import type { HumanInputRequest } from '@/components/workflow/HumanInputResolutionView';
import type { WorkflowSchedule } from '@sentris/shared';
import type { DashboardSectionLoading } from '@/hooks/queries/useDashboardQueries';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

const SEVERITY_BAR_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  info: 'bg-muted-foreground/40',
  none: 'bg-muted-foreground/30',
};

function formatUpcomingAt(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return '—';
  if (diff < 0) return 'Overdue';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${Math.max(mins, 1)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

function PanelHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
      >
        <Link to={href}>
          {linkLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}

function AttentionRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {children}
    </button>
  );
}

function AttentionGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <span className="text-[11px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

interface NeedsAttentionCardProps {
  failedRuns: ExecutionRun[];
  pendingActions: HumanInputRequest[];
  attentionFindings: FindingItem[];
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
}

export function NeedsAttentionCard({
  failedRuns,
  pendingActions,
  attentionFindings,
  isLoading,
  error,
  onRetry,
}: NeedsAttentionCardProps) {
  const navigate = useNavigate();
  const total = failedRuns.length + pendingActions.slice(0, 5).length + attentionFindings.length;

  return (
    <Card className="h-full">
      <CardContent className="p-3">
        <PanelHeader title="Needs attention" href="/action-center" linkLabel="Action Center" />

        {error ? (
          <ErrorBanner message="Failed to load attention items" onRetry={onRetry} />
        ) : isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            All clear — no failed runs, pending actions, or critical findings.
          </div>
        ) : (
          <div className="space-y-2">
            <AttentionGroup title="Failed runs" count={failedRuns.length}>
              {failedRuns.map((run) => (
                <AttentionRow
                  key={run.id}
                  onClick={() => navigate(`/workflows/${run.workflowId}/runs/${run.id}`)}
                >
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {run.workflowName || 'Unknown workflow'}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {formatStartTime(run.startTime)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={getStatusBadgeClassFromStatus(run.status, 'text-[10px]')}
                  >
                    {formatStatusText(run.status)}
                  </Badge>
                </AttentionRow>
              ))}
            </AttentionGroup>

            <AttentionGroup title="Pending actions" count={Math.min(pendingActions.length, 5)}>
              {pendingActions.slice(0, 5).map((action) => (
                <AttentionRow key={action.id} onClick={() => navigate('/action-center')}>
                  <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {action.title || 'Pending action'}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground capitalize">
                      {action.inputType}
                    </p>
                  </div>
                </AttentionRow>
              ))}
            </AttentionGroup>

            <AttentionGroup title="Open findings" count={attentionFindings.length}>
              {attentionFindings.map((finding) => (
                <AttentionRow
                  key={finding.id}
                  onClick={() => navigate(`/findings?severity=${finding.severity ?? ''}`)}
                >
                  <ShieldAlert
                    className="h-3.5 w-3.5 shrink-0 text-orange-500"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {finding.name || finding.asset_key || 'Untitled finding'}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {finding.workflow_name || 'Unknown workflow'}
                    </p>
                  </div>
                  <SeverityBadge severity={finding.severity} />
                </AttentionRow>
              ))}
            </AttentionGroup>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface FindingsSnapshotCardProps {
  severityCounts: { severity: string; count: number }[];
  total: number;
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
}

export function FindingsSnapshotCard({
  severityCounts,
  total,
  isLoading,
  error,
  onRetry,
}: FindingsSnapshotCardProps) {
  const countsBySeverity = toSeverityCountMap(severityCounts);
  const maxCount = Math.max(1, ...SEVERITY_ORDER.map((s) => countsBySeverity[s] ?? 0));

  return (
    <Card>
      <CardContent className="p-3">
        <PanelHeader title="Findings" href="/findings" linkLabel="View all" />

        {error ? (
          <ErrorBanner message="Failed to load findings" onRetry={onRetry} />
        ) : isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">No open findings</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{total}</span> open
            </p>
            {SEVERITY_ORDER.map((severity) => {
              const count = countsBySeverity[severity] ?? 0;
              const width = `${Math.round((count / maxCount) * 100)}%`;
              return (
                <Link
                  key={severity}
                  to={`/findings?severity=${severity}`}
                  className="grid grid-cols-[4.5rem_1fr_1.5rem] items-center gap-2 rounded-sm px-0.5 py-0.5 hover:bg-muted/40"
                >
                  <span className="truncate text-[11px] capitalize text-muted-foreground">
                    {severity}
                  </span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${SEVERITY_BAR_COLORS[severity] ?? 'bg-muted-foreground/40'}`}
                      style={{ width: count === 0 ? '0%' : width }}
                    />
                  </div>
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function toSeverityCountMap(severityCounts: { severity: string; count: number }[]) {
  const map: Record<string, number> = {};
  for (const row of severityCounts) {
    map[row.severity.toLowerCase()] = row.count;
  }
  return map;
}

interface UpcomingSchedulesCardProps {
  schedules: WorkflowSchedule[];
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
}

export function UpcomingSchedulesCard({
  schedules,
  isLoading,
  error,
  onRetry,
}: UpcomingSchedulesCardProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardContent className="p-3">
        <PanelHeader title="Coming up" href="/schedules" linkLabel="Schedules" />

        {error ? (
          <ErrorBanner message="Failed to load schedules" onRetry={onRetry} />
        ) : isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-start gap-1.5 py-2">
            <p className="text-xs text-muted-foreground">No upcoming scheduled runs</p>
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <Link to="/schedules">Create a schedule</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {schedules.map((schedule) => (
              <AttentionRow
                key={schedule.id}
                onClick={() => navigate(`/workflows/${schedule.workflowId}`)}
              >
                <CalendarClock
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{schedule.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {schedule.humanLabel || schedule.cronExpression}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {schedule.nextRunAt ? formatUpcomingAt(schedule.nextRunAt) : '—'}
                </span>
              </AttentionRow>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface DashboardOpsPanelsProps {
  failedRuns: ExecutionRun[];
  pendingActions: HumanInputRequest[];
  attentionFindings: FindingItem[];
  findingsSeverityCounts: { severity: string; count: number }[];
  openFindingsTotal: number;
  upcomingSchedules: WorkflowSchedule[];
  sectionLoading: DashboardSectionLoading;
  errors: {
    failedRuns?: Error;
    humanInputs?: Error;
    findings?: Error;
    schedules?: Error;
  };
  onRetry: () => void;
}

export function DashboardOpsPanels({
  failedRuns,
  pendingActions,
  attentionFindings,
  findingsSeverityCounts,
  openFindingsTotal,
  upcomingSchedules,
  sectionLoading,
  errors,
  onRetry,
}: DashboardOpsPanelsProps) {
  const attentionLoading =
    sectionLoading.failedRuns || sectionLoading.humanInputs || sectionLoading.findings;
  const attentionError = errors.failedRuns || errors.humanInputs || errors.findings;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <NeedsAttentionCard
          failedRuns={failedRuns}
          pendingActions={pendingActions}
          attentionFindings={attentionFindings}
          isLoading={attentionLoading}
          error={attentionError}
          onRetry={onRetry}
        />
      </div>
      <div className="flex flex-col gap-3">
        <FindingsSnapshotCard
          severityCounts={findingsSeverityCounts}
          total={openFindingsTotal}
          isLoading={sectionLoading.findings}
          error={errors.findings}
          onRetry={onRetry}
        />
        <UpcomingSchedulesCard
          schedules={upcomingSchedules}
          isLoading={sectionLoading.schedules}
          error={errors.schedules}
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}
