import type {
  OperatorActionStatus,
  OperatorActionView,
  OperatorCommandName,
  OperatorMessageView,
} from '@sentris/shared';
import {
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  ExternalLink,
  Loader2,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';

const ACTION_STATUS_LABELS: Record<OperatorActionStatus, string> = {
  proposed: 'Proposed',
  pending_approval: 'Needs approval',
  approved: 'Approved',
  rejected: 'Rejected',
  executing: 'Running',
  succeeded: 'Completed',
  failed: 'Failed',
};

const ACTION_STATUS_STYLES: Record<OperatorActionStatus, string> = {
  proposed: 'border-border text-muted-foreground',
  pending_approval: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  approved: 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300',
  rejected: 'border-border bg-muted/30 text-muted-foreground',
  executing: 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300',
  succeeded: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const COMMAND_LABELS: Record<OperatorCommandName, string> = {
  list_workflows: 'List workflows',
  get_workflow: 'Inspect workflow',
  list_runs: 'List runs',
  get_run: 'Inspect run',
  run_workflow: 'Run workflow',
  cancel_run: 'Cancel run',
  list_findings: 'List findings',
  get_finding: 'Inspect finding',
  update_finding_triage: 'Update finding triage',
  list_mcp_servers: 'List MCP servers',
  list_mcp_capabilities: 'Inspect MCP capabilities',
  invoke_mcp_tool: 'Run MCP tool',
  read_mcp_resource: 'Read MCP resource',
  get_mcp_prompt: 'Get MCP prompt',
};

type TimelineEvent =
  | { kind: 'message'; at: string; sequence: number; value: OperatorMessageView }
  | { kind: 'action'; at: string; sequence: number; value: OperatorActionView };

function toTimelineEvents(
  messages: OperatorMessageView[],
  actions: OperatorActionView[],
): TimelineEvent[] {
  return [
    ...messages.map(
      (message): TimelineEvent => ({
        kind: 'message',
        at: message.createdAt,
        sequence: message.sequence,
        value: message,
      }),
    ),
    ...actions.map(
      (action, index): TimelineEvent => ({
        kind: 'action',
        at: action.createdAt,
        sequence: Number.MAX_SAFE_INTEGER - actions.length + index,
        value: action,
      }),
    ),
  ].sort((left, right) => {
    const timeDelta = new Date(left.at).getTime() - new Date(right.at).getTime();
    return timeDelta || left.sequence - right.sequence;
  });
}

function formatPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!formatted) return null;
  return formatted.length > 600 ? `${formatted.slice(0, 600)}…` : formatted;
}

function getResultStatus(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const status = (result as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}

function MessageEvent({ message }: { message: OperatorMessageView }) {
  if (message.role === 'user') {
    return (
      <article className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground shadow-sm md:max-w-[72%]">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </article>
    );
  }

  return (
    <article className="flex max-w-[92%] items-start gap-2.5 md:max-w-[82%]">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 rounded-xl rounded-tl-sm border border-border/70 bg-card/70 px-3.5 py-2.5 shadow-sm">
        <MarkdownView
          content={message.content}
          dataTestId={`operator-message-${message.id}`}
          className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-p:my-1 prose-pre:my-2 prose-pre:max-w-full prose-pre:overflow-auto"
        />
      </div>
    </article>
  );
}

interface ActionEventProps {
  action: OperatorActionView;
  pendingDecision: boolean;
  onDecision: (action: OperatorActionView, decision: 'approved' | 'rejected') => void;
}

function ActionEvent({ action, pendingDecision, onDecision }: ActionEventProps) {
  const argumentsPreview = formatPreview(action.arguments);
  const resultPreview = action.status === 'failed' ? action.error : formatPreview(action.result);
  const resultStatus = getResultStatus(action.result);
  const isActive = action.status === 'executing' || action.status === 'approved';

  return (
    <article
      className={cn(
        'ml-9 max-w-[calc(100%-2.25rem)] overflow-hidden rounded-lg border bg-card/50',
        action.status === 'pending_approval' && 'border-amber-500/40 bg-amber-500/[0.04]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        {isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        ) : action.status === 'succeeded' ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : action.status === 'pending_approval' ? (
          <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
        ) : (
          <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold">{COMMAND_LABELS[action.commandName]}</span>
        <Badge
          variant="outline"
          className={cn('ml-auto h-5 px-1.5 text-[10px]', ACTION_STATUS_STYLES[action.status])}
        >
          {ACTION_STATUS_LABELS[action.status]}
        </Badge>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        {action.status === 'pending_approval' ? (
          <p className="text-xs text-muted-foreground">
            Operator wants to perform a consequential action. Review it before continuing.
          </p>
        ) : null}

        {argumentsPreview ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium">Command input</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2 font-mono text-[11px] text-foreground">
              {argumentsPreview}
            </pre>
          </details>
        ) : null}

        {resultPreview ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium">
              {action.status === 'failed' ? 'Error' : 'Result'}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2 font-mono text-[11px] text-foreground">
              {resultPreview}
            </pre>
          </details>
        ) : null}

        {action.runId ? (
          <Link
            to={`/runs/${encodeURIComponent(action.runId)}`}
            className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-2 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <Play className="h-3.5 w-3.5 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">Workflow run</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                {action.runId}
              </span>
            </span>
            {resultStatus ? (
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                {resultStatus}
              </span>
            ) : null}
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>
        ) : null}

        {action.status === 'pending_approval' ? (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs"
              onClick={() => onDecision(action, 'approved')}
              disabled={pendingDecision}
            >
              {pendingDecision ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2.5 text-xs"
              onClick={() => onDecision(action, 'rejected')}
              disabled={pendingDecision}
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

interface OperatorTimelineProps {
  messages: OperatorMessageView[];
  actions: OperatorActionView[];
  isActive: boolean;
  pendingDecisionActionId?: string;
  onDecision: (action: OperatorActionView, decision: 'approved' | 'rejected') => void;
}

export function OperatorTimeline({
  messages,
  actions,
  isActive,
  pendingDecisionActionId,
  onDecision,
}: OperatorTimelineProps) {
  const events = toTimelineEvents(messages, actions);

  return (
    <div className="space-y-3">
      {events.map((event) =>
        event.kind === 'message' ? (
          <MessageEvent key={`message-${event.value.id}`} message={event.value} />
        ) : (
          <ActionEvent
            key={`action-${event.value.id}`}
            action={event.value}
            pendingDecision={pendingDecisionActionId === event.value.id}
            onDecision={onDecision}
          />
        ),
      )}

      {isActive ? (
        <div className="ml-9 flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Operator is working
          <ChevronRight className="h-3 w-3 animate-pulse" />
        </div>
      ) : null}

      {events.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
            <Clock3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Ready when you are</p>
            <p className="mt-1 max-w-sm text-xs">
              Ask about workflows or runs, or tell Operator to launch an existing workflow.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
