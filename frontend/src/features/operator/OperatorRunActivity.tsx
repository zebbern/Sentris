import { useEffect, useMemo, useState } from 'react';
import { TERMINAL_STATUSES, type OperatorCreateTurn } from '@sentris/shared';
import { ExternalLink, Loader2, RefreshCw, Search, Square } from 'lucide-react';
import { Link } from 'react-router-dom';

import { AgentRunCard } from '@/components/timeline/agent-trace/AgentRunCard';
import { extractAgentRunId } from '@/components/timeline/agent-trace/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getOperatorRunTraceRefetchInterval,
  useOperatorRunStatus,
  useOperatorRunTrace,
} from '@/hooks/queries/useOperatorQueries';
import { cn } from '@/lib/utils';

const TERMINAL_RUN_STATUSES = new Set<string>(TERMINAL_STATUSES);

type DirectCommand = NonNullable<OperatorCreateTurn['directCommand']>;

export interface OperatorRunCommandRequest {
  message: string;
  directCommand: DirectCommand;
}

interface OperatorRunActivityProps {
  runId: string;
  disabled: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
}

interface AgentEntry {
  nodeId: string;
  agentRunId: string;
}

export function OperatorRunActivity({ runId, disabled, onCommand }: OperatorRunActivityProps) {
  const [agentActivityRequested, setAgentActivityRequested] = useState(false);
  const statusQuery = useOperatorRunStatus(runId);
  const status = readStatus(statusQuery.data);
  const live = Boolean(status && !TERMINAL_RUN_STATUSES.has(status));
  const traceRequested = live || agentActivityRequested;
  const statusUpdatedAt = readStatusUpdatedAt(statusQuery.data) ?? statusQuery.dataUpdatedAt;
  const traceQuery = useOperatorRunTrace(traceRequested ? runId : null, status, statusUpdatedAt);
  const followAgents =
    traceRequested && getOperatorRunTraceRefetchInterval(status, statusUpdatedAt) !== false;
  const agents = useMemo(() => extractAgentEntries(traceQuery.data), [traceQuery.data]);

  const runAgainLabel = status === 'COMPLETED' ? 'Run again' : 'Retry';

  useEffect(() => {
    if (live) setAgentActivityRequested(true);
  }, [live]);

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-background/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
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
            <span className="block font-medium text-foreground">Workflow run</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {runId}
            </span>
          </span>
        </Link>
        {status ? (
          <Badge
            variant="outline"
            className={cn(
              'h-5 px-1.5 text-[10px]',
              live
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                : status === 'COMPLETED'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'border-border bg-muted/30 text-muted-foreground',
            )}
          >
            {status}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {live ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-[11px]"
              disabled={disabled}
              onClick={() =>
                onCommand({
                  message: `Inspect run ${runId} and summarize its result and useful next steps`,
                  directCommand: { commandName: 'get_run', arguments: { runId } },
                })
              }
            >
              <Search className="h-3 w-3" />
              Review result
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-[11px]"
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
          className="group border-t border-border/50 pt-2"
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
    </div>
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
