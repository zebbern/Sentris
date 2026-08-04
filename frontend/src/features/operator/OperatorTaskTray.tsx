import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Ban,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Loader2,
  RotateCcw,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  OperatorLatestTurnSummary,
  OperatorSessionSummary,
  OperatorTurnStatus,
} from '@sentris/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import {
  useCancelOperatorTurn,
  useDecideOperatorAction,
  useOperatorSessions,
  useRetryOperatorTurn,
} from '@/hooks/queries/useOperatorQueries';
import { cn } from '@/lib/utils';
import { OPERATOR_COMMAND_LABELS } from './operatorCommandLabels';

const ACTIVE_TURN_STATUSES = new Set<OperatorTurnStatus>([
  'queued',
  'running',
  'awaiting_approval',
]);
const MAX_RECENT_TASKS = 4;

interface OperatorTask {
  session: OperatorSessionSummary;
  turn: OperatorLatestTurnSummary;
}

interface TurnStatusPresentation {
  label: string;
  icon: LucideIcon;
  className: string;
}

function turnStatusPresentation(status: OperatorTurnStatus): TurnStatusPresentation {
  switch (status) {
    case 'queued':
      return { label: 'Queued', icon: Clock3, className: 'text-muted-foreground' };
    case 'running':
      return { label: 'Running', icon: Loader2, className: 'text-blue-500' };
    case 'awaiting_approval':
      return { label: 'Needs approval', icon: CircleAlert, className: 'text-amber-500' };
    case 'completed':
      return { label: 'Completed', icon: Check, className: 'text-emerald-500' };
    case 'failed':
      return { label: 'Failed', icon: X, className: 'text-destructive' };
    case 'cancelled':
      return { label: 'Cancelled', icon: Ban, className: 'text-muted-foreground' };
    default: {
      const exhaustive: never = status;
      throw new Error(`Unsupported Operator turn status: ${String(exhaustive)}`);
    }
  }
}

function taskProgress(turn: OperatorLatestTurnSummary): string {
  const actionCount = turn.actionCount ?? 0;
  const settledActionCount = turn.settledActionCount ?? 0;
  const currentAction = turn.currentAction ?? null;
  const currentLabel = currentAction ? OPERATOR_COMMAND_LABELS[currentAction.commandName] : null;

  switch (turn.status) {
    case 'queued':
      return 'Waiting for a worker';
    case 'running':
      if (currentLabel) {
        return `${currentLabel} · ${settledActionCount} of ${actionCount} recorded actions finished`;
      }
      if (actionCount > 0 && settledActionCount === actionCount) {
        return `${settledActionCount} recorded ${settledActionCount === 1 ? 'action' : 'actions'} finished · Finalizing response`;
      }
      return 'Planning the next action';
    case 'awaiting_approval':
      return currentLabel ? `Approval needed: ${currentLabel}` : 'Waiting for your decision';
    case 'completed':
      return actionCount > 0
        ? `${settledActionCount} recorded ${settledActionCount === 1 ? 'action' : 'actions'} finished`
        : 'Task finished';
    case 'failed':
      return turn.error ?? 'Task stopped with an error';
    case 'cancelled':
      return 'Task was stopped';
    default: {
      const exhaustive: never = turn.status;
      throw new Error(`Unsupported Operator turn status: ${String(exhaustive)}`);
    }
  }
}

function selectTrayTasks(sessions: OperatorSessionSummary[]): OperatorTask[] {
  const active: OperatorTask[] = [];
  const recent: OperatorTask[] = [];
  for (const session of sessions) {
    const turn = session.latestTurn ?? null;
    if (!turn) continue;
    const task = { session, turn };
    if (ACTIVE_TURN_STATUSES.has(turn.status)) active.push(task);
    else if (recent.length < MAX_RECENT_TASKS) recent.push(task);
  }
  return [...active, ...recent];
}

function taskHref(task: OperatorTask): string {
  return `/operator/${task.session.id}?turnId=${task.turn.id}`;
}

export function OperatorTaskTray({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: sessions = [], isLoading } = useOperatorSessions();
  const cancelTurn = useCancelOperatorTurn();
  const decideAction = useDecideOperatorAction();
  const retryTurn = useRetryOperatorTurn();
  const [open, setOpen] = useState(false);
  const tasks = useMemo(() => selectTrayTasks(sessions), [sessions]);
  const activeCount = useMemo(
    () => tasks.filter((task) => ACTIVE_TURN_STATUSES.has(task.turn.status)).length,
    [tasks],
  );
  const approvalCount = useMemo(
    () => tasks.filter((task) => task.turn.status === 'awaiting_approval').length,
    [tasks],
  );

  const openTask = (task: OperatorTask) => {
    setOpen(false);
    navigate(taskHref(task));
  };

  const decide = async (task: OperatorTask, decision: 'approved' | 'rejected') => {
    const action = task.turn.currentAction;
    if (!action || action.status !== 'pending_approval') return;
    try {
      await decideAction.mutateAsync({
        sessionId: task.session.id,
        actionId: action.id,
        input: { decision, expectedVersion: action.version },
      });
    } catch (error) {
      toast({
        title: `Could not ${decision === 'approved' ? 'approve' : 'reject'} Operator action`,
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const cancel = async (task: OperatorTask) => {
    try {
      await cancelTurn.mutateAsync({ sessionId: task.session.id, turnId: task.turn.id });
    } catch (error) {
      toast({
        title: 'Could not stop Operator task',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const retry = async (task: OperatorTask) => {
    try {
      const retried = await retryTurn.mutateAsync({
        sessionId: task.session.id,
        turnId: task.turn.id,
        input: { clientTurnId: crypto.randomUUID() },
      });
      setOpen(false);
      navigate(`/operator/${task.session.id}?turnId=${retried.turnId}`);
    } catch (error) {
      toast({
        title: 'Could not retry Operator task',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const triggerLabel =
    activeCount === 0
      ? 'Operator tasks'
      : `Operator tasks — ${activeCount} active${approvalCount > 0 ? `, ${approvalCount} awaiting approval` : ''}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            className,
          )}
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <Bot className="h-4 w-4" />
          {activeCount > 0 ? (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold leading-none text-white',
                approvalCount > 0 ? 'bg-amber-500' : 'bg-blue-500',
              )}
              aria-hidden="true"
            >
              {activeCount > 9 ? '9+' : activeCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-1rem))] p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div>
            <h2 className="text-sm font-semibold">Operator tasks</h2>
            <p className="text-[11px] text-muted-foreground">
              {activeCount > 0
                ? `${activeCount} active${approvalCount > 0 ? ` · ${approvalCount} need approval` : ''}`
                : 'No active tasks'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              setOpen(false);
              navigate('/operator');
            }}
          >
            View all
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>

        <div className="max-h-[min(32rem,70vh)] overflow-y-auto p-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tasks
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bot className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-xs font-medium">No Operator activity yet</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Start a task in Operator and it will remain visible here.
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <OperatorTaskItem
                key={task.turn.id}
                task={task}
                isCancelling={cancelTurn.isPending && cancelTurn.variables?.turnId === task.turn.id}
                isDeciding={
                  decideAction.isPending &&
                  decideAction.variables?.actionId === task.turn.currentAction?.id
                }
                isRetrying={retryTurn.isPending && retryTurn.variables?.turnId === task.turn.id}
                onOpen={() => openTask(task)}
                onDecision={(decision) => void decide(task, decision)}
                onCancel={() => void cancel(task)}
                onRetry={() => void retry(task)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OperatorTaskItem({
  task,
  isCancelling,
  isDeciding,
  isRetrying,
  onOpen,
  onDecision,
  onCancel,
  onRetry,
}: {
  task: OperatorTask;
  isCancelling: boolean;
  isDeciding: boolean;
  isRetrying: boolean;
  onOpen: () => void;
  onDecision: (decision: 'approved' | 'rejected') => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const presentation = turnStatusPresentation(task.turn.status);
  const StatusIcon = presentation.icon;
  const isActive = ACTIVE_TURN_STATUSES.has(task.turn.status);
  const canDecide =
    task.turn.status === 'awaiting_approval' &&
    task.turn.currentAction?.status === 'pending_approval';

  return (
    <article className="rounded-md border border-transparent px-2.5 py-2.5 hover:border-border hover:bg-muted/30">
      <div className="flex min-w-0 items-start gap-2">
        <StatusIcon
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0',
            presentation.className,
            task.turn.status === 'running' && 'animate-spin',
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium" title={task.session.title}>
                {task.session.title}
              </p>
              <p className={cn('text-[10px] font-medium', presentation.className)}>
                {presentation.label}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpen}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Open ${task.session.title}`}
              title="Open exact turn"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {taskProgress(task.turn)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            {formatDistanceToNowStrict(new Date(task.turn.createdAt), { addSuffix: true })}
          </p>

          {canDecide ? (
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => onDecision('rejected')}
                disabled={isDeciding}
              >
                Reject
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => onDecision('approved')}
                disabled={isDeciding}
              >
                {isDeciding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Approve
              </Button>
            </div>
          ) : null}

          {isActive && !canDecide ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 gap-1.5 px-2 text-xs"
              onClick={onCancel}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              Stop
            </Button>
          ) : null}

          {task.turn.status === 'failed' || task.turn.status === 'cancelled' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 gap-1.5 px-2 text-xs"
              onClick={onRetry}
              disabled={isRetrying}
            >
              {isRetrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
