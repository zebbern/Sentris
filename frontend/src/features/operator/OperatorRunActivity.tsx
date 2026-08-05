import { useEffect, useMemo, useState } from 'react';
import { TERMINAL_STATUSES, type OperatorCreateTurn } from '@sentris/shared';
import {
  Check,
  Circle,
  CircleAlert,
  ExternalLink,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { AgentRunCard } from '@/components/timeline/agent-trace/AgentRunCard';
import { extractAgentRunId } from '@/components/timeline/agent-trace/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getOperatorRunTraceRefetchInterval,
  useOperatorRunQueryStream,
  useOperatorRunTrace,
} from '@/hooks/queries/useOperatorQueries';
import { cn } from '@/lib/utils';

const TERMINAL_RUN_STATUSES = new Set<string>(TERMINAL_STATUSES);

type DirectCommand = NonNullable<OperatorCreateTurn['directCommand']>;
type Journey = NonNullable<OperatorCreateTurn['journey']>;

export interface OperatorRunCommandRequest {
  message: string;
  directCommand?: DirectCommand;
  journey?: Journey;
}

interface OperatorRunActivityProps {
  runId: string;
  sourceRunId?: string;
  allowSourceComparison?: boolean;
  label?: string;
  embedded?: boolean;
  disabled: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
}

interface AgentEntry {
  nodeId: string;
  agentRunId: string;
}

type RunStepState = 'active' | 'attention' | 'completed' | 'failed' | 'skipped';

interface RunStep {
  nodeId: string;
  label: string;
  detail: string | null;
  state: RunStepState;
}

export function OperatorRunActivity({
  runId,
  sourceRunId,
  allowSourceComparison = true,
  label = 'Workflow run',
  embedded = false,
  disabled,
  onCommand,
}: OperatorRunActivityProps) {
  const [agentActivityRequested, setAgentActivityRequested] = useState(false);
  const { statusQuery, streamState } = useOperatorRunQueryStream(runId);
  const status = readStatus(statusQuery.data);
  const live = Boolean(status && !TERMINAL_RUN_STATUSES.has(status));
  const traceRequested = live || agentActivityRequested;
  const statusUpdatedAt = readStatusUpdatedAt(statusQuery.data) ?? statusQuery.dataUpdatedAt;
  const traceQuery = useOperatorRunTrace(
    traceRequested ? runId : null,
    status,
    statusUpdatedAt,
    streamState,
  );
  const followAgents =
    traceRequested &&
    getOperatorRunTraceRefetchInterval(status, statusUpdatedAt, Date.now(), streamState) !== false;
  const agents = useMemo(() => extractAgentEntries(traceQuery.data), [traceQuery.data]);
  const runSteps = useMemo(() => readRunSteps(traceQuery.data), [traceQuery.data]);
  const currentStep = useMemo(() => readCurrentStep(traceQuery.data), [traceQuery.data]);
  const progress = readProgress(statusQuery.data);
  const failureReason = readFailureReason(statusQuery.data);

  const runAgainLabel = status === 'COMPLETED' ? 'Run again' : 'Retry';

  useEffect(() => {
    if (live) setAgentActivityRequested(true);
  }, [live]);

  const remainingSteps = progress ? Math.max(0, progress.totalActions - runSteps.length) : 0;

  return (
    <section
      className={cn(
        'max-w-full overflow-hidden bg-background/75',
        embedded
          ? 'border-b border-border/45 last:border-b-0'
          : 'rounded-2xl border border-border/70 shadow-[0_10px_32px_rgba(0,0,0,0.2)]',
      )}
    >
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5">
        <Link
          to={`/runs/${encodeURIComponent(runId)}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-xs transition-colors hover:text-primary"
        >
          {statusQuery.isLoading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
          )}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{label}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {runId}
            </span>
          </span>
        </Link>
        {progress && live ? (
          <span className="text-[10px] text-muted-foreground">
            Step {Math.min(progress.totalActions, progress.completedActions + 1)} of{' '}
            {progress.totalActions}
          </span>
        ) : null}
        {status ? (
          <Badge
            variant="outline"
            className={cn(
              'h-5 px-1.5 text-[10px]',
              live
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                : status === 'COMPLETED'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : status === 'FAILED'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-border bg-muted/30 text-muted-foreground',
            )}
          >
            {live ? 'Live' : status}
          </Badge>
        ) : null}
      </div>

      {live ? (
        <div aria-live="polite">
          <div className="flex items-center justify-between gap-2 border-b border-border/35 px-4 py-2 text-[10px] text-muted-foreground">
            <span>{status === 'QUEUED' ? 'Preparing workflow' : 'Workflow in progress'}</span>
            <span className="flex shrink-0 items-center gap-1">
              {streamState === 'live' ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              ) : streamState === 'connecting' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
              ) : null}
              {streamState === 'live'
                ? 'Live updates'
                : streamState === 'connecting'
                  ? 'Connecting'
                  : 'Updating every few seconds'}
            </span>
          </div>

          {runSteps.length > 0 ? (
            <ol aria-label="Workflow steps">
              {runSteps.map((step) => (
                <li
                  key={step.nodeId}
                  className={cn(
                    'relative grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 border-b border-border/30 px-4 py-2.5 last:border-b-0',
                    step.state === 'active' && 'bg-blue-500/[0.055]',
                    step.state === 'attention' && 'bg-amber-500/[0.05]',
                    step.state === 'failed' && 'bg-destructive/[0.045]',
                  )}
                >
                  {step.state === 'active' ||
                  step.state === 'attention' ||
                  step.state === 'failed' ? (
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 w-0.5',
                        step.state === 'active' && 'bg-blue-500',
                        step.state === 'attention' && 'bg-amber-500',
                        step.state === 'failed' && 'bg-destructive',
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="flex h-5 w-5 items-center justify-center">
                    {step.state === 'completed' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                    ) : step.state === 'failed' ? (
                      <X className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                    ) : step.state === 'attention' ? (
                      <CircleAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                    ) : step.state === 'active' ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-blue-500"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="truncate text-xs font-medium text-foreground">{step.label}</p>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {step.nodeId}
                      </span>
                    </div>
                    {step.detail && (step.state === 'active' || step.state === 'attention') ? (
                      <p
                        className="mt-1 truncate text-[10px] text-muted-foreground"
                        title={step.detail}
                      >
                        {step.detail}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      'pt-0.5 text-[10px] font-medium text-muted-foreground',
                      step.state === 'active' && 'text-blue-400',
                      step.state === 'attention' && 'text-amber-400',
                      step.state === 'completed' && 'text-emerald-400',
                      step.state === 'failed' && 'text-destructive',
                    )}
                  >
                    {step.state === 'active'
                      ? 'Running'
                      : step.state === 'attention'
                        ? 'Waiting'
                        : step.state === 'completed'
                          ? 'Done'
                          : step.state === 'failed'
                            ? 'Failed'
                            : 'Skipped'}
                  </span>
                </li>
              ))}
              {remainingSteps > 0 ? (
                <li className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 opacity-55">
                  <span className="flex h-5 w-5 items-center justify-center">
                    <Circle className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {remainingSteps} {remainingSteps === 1 ? 'step' : 'steps'} queued
                  </span>
                  <span className="text-[10px] text-muted-foreground">Queued</span>
                </li>
              ) : null}
            </ol>
          ) : currentStep ? (
            <div className="border-b border-border/35 bg-blue-500/[0.055] px-4 py-2.5">
              <p className="truncate text-xs text-foreground" title={currentStep}>
                {currentStep}
              </p>
            </div>
          ) : null}

          {progress ? (
            <div className="space-y-1.5 border-t border-border/35 px-4 py-2">
              <div
                role="progressbar"
                aria-label="Workflow progress"
                aria-valuemin={0}
                aria-valuemax={progress.totalActions}
                aria-valuenow={progress.completedActions}
                className="h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{
                    width: `${Math.min(
                      100,
                      (progress.completedActions / progress.totalActions) * 100,
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {progress.completedActions} of {progress.totalActions} steps complete
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {failureReason ? (
        <p className="border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 text-[11px] text-destructive">
          {failureReason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 px-4 py-3">
        {live ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full px-4 text-[11px]"
            disabled={disabled}
            onClick={() =>
              onCommand({
                message: `Cancel run ${runId}`,
                directCommand: { commandName: 'cancel_run', arguments: { runId } },
              })
            }
          >
            <Square className="h-3 w-3" />
            Cancel
          </Button>
        ) : null}
        {status && TERMINAL_RUN_STATUSES.has(status) ? (
          <>
            {sourceRunId && allowSourceComparison ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-full px-3 text-[11px]"
                disabled={disabled}
                onClick={() =>
                  onCommand({
                    message: `Compare improved run ${runId} with source run ${sourceRunId} using recorded execution evidence`,
                    directCommand: {
                      commandName: 'compare_runs',
                      arguments: { sourceRunId, candidateRunId: runId },
                    },
                  })
                }
              >
                <GitCompareArrows className="h-3 w-3" />
                Compare with source
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full px-3 text-[11px]"
              disabled={disabled}
              onClick={() =>
                onCommand({
                  message: `Improve run ${runId}: inspect its recorded evidence, propose the smallest justified workflow revision, save it under my approval mode, rerun the same inputs, and compare the result.`,
                  journey: { kind: 'improve_run', sourceRunId: runId },
                })
              }
            >
              <Search className="h-3 w-3" />
              Improve with Operator
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full px-3 text-[11px]"
              disabled={disabled}
              onClick={() =>
                onCommand({
                  message: `Propose a reviewed, schema-valid input-change rerun for ${runId}. Inspect its recorded evidence and exact immutable workflow version, change only justified non-secret declared inputs, and do not launch the run until I select Run with changes.`,
                })
              }
            >
              <SlidersHorizontal className="h-3 w-3" />
              Change inputs
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full px-3 text-[11px]"
              disabled={disabled}
              onClick={() =>
                onCommand({
                  message: `Retry run ${runId} with the same workflow version and inputs`,
                  directCommand: { commandName: 'retry_run', arguments: { runId } },
                })
              }
            >
              <RefreshCw className="h-3 w-3" />
              {runAgainLabel}
            </Button>
          </>
        ) : null}
      </div>

      {live || (status && TERMINAL_RUN_STATUSES.has(status)) ? (
        <details
          open={live || undefined}
          className="group border-t border-border/50 px-4 py-2.5"
          onToggle={(event) => {
            if (event.currentTarget.open) setAgentActivityRequested(true);
          }}
        >
          <summary className="cursor-pointer select-none text-[11px] font-medium text-muted-foreground">
            {agents.length > 0
              ? `${agents.length} agent turn${agents.length === 1 ? '' : 's'} ${live ? 'live' : 'captured'}`
              : live
                ? 'Agent activity live'
                : 'Agent activity'}
          </summary>
          {agents.length > 0 ? (
            <div className="mt-2 space-y-2">
              {agents.map((agent) => (
                <AgentRunCard
                  key={agent.agentRunId}
                  nodeId={agent.nodeId}
                  agentRunId={agent.agentRunId}
                  runId={runId}
                  live={live}
                  follow={followAgents}
                />
              ))}
            </div>
          ) : traceQuery.isFetching ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading agent activity…
            </p>
          ) : traceQuery.isError ? (
            <p className="mt-2 text-[11px] text-destructive">Could not load agent activity.</p>
          ) : traceRequested && !live ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No agent activity was recorded for this run.
            </p>
          ) : live ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Following this run. Agent activity will appear when an AI Agent node starts.
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function readStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' ? status.toUpperCase() : null;
}

function readStatusUpdatedAt(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  if (typeof updatedAt !== 'string') return null;
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readProgress(value: unknown): { completedActions: number; totalActions: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const progress = (value as { progress?: unknown }).progress;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null;
  const { completedActions, totalActions } = progress as {
    completedActions?: unknown;
    totalActions?: unknown;
  };
  if (
    typeof completedActions !== 'number' ||
    !Number.isFinite(completedActions) ||
    typeof totalActions !== 'number' ||
    !Number.isFinite(totalActions) ||
    totalActions <= 0
  ) {
    return null;
  }
  return {
    completedActions: Math.max(0, Math.min(completedActions, totalActions)),
    totalActions,
  };
}

function readFailureReason(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const failure = (value as { failure?: unknown }).failure;
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return null;
  const reason = (failure as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}

function humanizeNodeId(nodeId: string): string {
  const normalized = nodeId.replace(/[-_]+/g, ' ').trim();
  if (!normalized) return nodeId;
  return `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
}

function readRunSteps(value: unknown): RunStep[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const steps = new Map<string, RunStep>();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const record = event as {
      nodeId?: unknown;
      type?: unknown;
      message?: unknown;
      error?: unknown;
      data?: unknown;
    };
    if (typeof record.nodeId !== 'string' || typeof record.type !== 'string') continue;
    const data =
      record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? (record.data as { title?: unknown })
        : null;
    const error =
      record.error && typeof record.error === 'object' && !Array.isArray(record.error)
        ? (record.error as { message?: unknown })
        : null;
    const existing = steps.get(record.nodeId);
    const label =
      typeof data?.title === 'string' && data.title.trim()
        ? data.title
        : (existing?.label ?? humanizeNodeId(record.nodeId));
    const message =
      typeof record.message === 'string' && record.message.trim()
        ? record.message
        : typeof error?.message === 'string' && error.message.trim()
          ? error.message
          : (existing?.detail ?? null);

    switch (record.type) {
      case 'STARTED':
      case 'PROGRESS':
        steps.set(record.nodeId, {
          nodeId: record.nodeId,
          label,
          detail: message,
          state: 'active',
        });
        break;
      case 'AWAITING_INPUT':
        steps.set(record.nodeId, {
          nodeId: record.nodeId,
          label,
          detail: message,
          state: 'attention',
        });
        break;
      case 'COMPLETED':
        steps.set(record.nodeId, {
          nodeId: record.nodeId,
          label,
          detail: message,
          state: 'completed',
        });
        break;
      case 'FAILED':
        steps.set(record.nodeId, {
          nodeId: record.nodeId,
          label,
          detail: message,
          state: 'failed',
        });
        break;
      case 'SKIPPED':
        steps.set(record.nodeId, {
          nodeId: record.nodeId,
          label,
          detail: message,
          state: 'skipped',
        });
        break;
      case 'HTTP_REQUEST_SENT':
      case 'HTTP_RESPONSE_RECEIVED':
      case 'HTTP_REQUEST_ERROR':
        break;
      default:
        break;
    }
  }
  return [...steps.values()];
}

function readCurrentStep(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;

  const active = new Map<string, string>();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const record = event as { nodeId?: unknown; type?: unknown; message?: unknown };
    if (typeof record.nodeId !== 'string' || typeof record.type !== 'string') continue;
    switch (record.type) {
      case 'STARTED':
      case 'PROGRESS':
      case 'AWAITING_INPUT': {
        const label =
          typeof record.message === 'string' && record.message.trim()
            ? record.message
            : record.nodeId;
        active.delete(record.nodeId);
        active.set(record.nodeId, label);
        break;
      }
      case 'COMPLETED':
      case 'FAILED':
      case 'SKIPPED':
        active.delete(record.nodeId);
        break;
      default:
        break;
    }
  }

  const activeSteps = [...active.values()];
  return activeSteps[activeSteps.length - 1] ?? null;
}

function extractAgentEntries(value: unknown): AgentEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const entries = new Map<string, AgentEntry>();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const record = event as { nodeId?: unknown; data?: unknown };
    if (typeof record.nodeId !== 'string') continue;
    const agentRunId = extractAgentRunId(record.data);
    if (!agentRunId) continue;
    entries.set(agentRunId, { nodeId: record.nodeId, agentRunId });
  }
  return [...entries.values()];
}
