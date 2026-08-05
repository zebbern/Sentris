import {
  type OperatorActionStatus,
  type OperatorActionView,
  type OperatorPlanProposalResult,
  type OperatorTurnView,
  type OperatorUserInputResponse,
} from '@sentris/shared';
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  Loader2,
  Pencil,
  Play,
  Square,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OperatorDecisionCard } from './OperatorDecisionCard';
import type { OperatorRunCommandRequest } from './OperatorRunActivity';

const ACTIVE_TURN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);
const SETTLED_ACTION_STATUSES = new Set<OperatorActionStatus>(['succeeded', 'failed', 'rejected']);

type StepState = 'pending' | 'active' | 'attention' | 'completed' | 'failed';

function stepAction(
  planId: string,
  stepId: string,
  turnId: string | undefined,
  actions: OperatorActionView[],
): OperatorActionView | undefined {
  if (!turnId) return undefined;
  const suffix = `:plan:${planId}:${stepId}`;
  return actions.find((action) => action.turnId === turnId && action.toolCallId.endsWith(suffix));
}

function stepState(action: OperatorActionView | undefined, current: boolean): StepState {
  if (!action) return current ? 'active' : 'pending';
  switch (action.status) {
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'rejected':
      return 'failed';
    case 'pending_approval':
      return 'attention';
    case 'proposed':
    case 'approved':
    case 'executing':
      return 'active';
    default: {
      const exhaustive: never = action.status;
      throw new Error(`Unsupported Operator action status: ${String(exhaustive)}`);
    }
  }
}

function actionPreview(action: OperatorActionView | undefined): string | null {
  if (!action) return null;
  const value = action.status === 'failed' ? action.error : action.result;
  if (value === null || value === undefined) return null;
  const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!formatted) return null;
  return formatted.length > 1_200 ? `${formatted.slice(0, 1_200)}…` : formatted;
}

function StateIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'completed':
      return <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />;
    case 'failed':
      return <X className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />;
    case 'attention':
      return <CircleAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />;
    case 'active':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" aria-hidden="true" />;
    case 'pending':
      return <Circle className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />;
    default: {
      const exhaustive: never = state;
      throw new Error(`Unsupported plan step state: ${String(exhaustive)}`);
    }
  }
}

export function OperatorPlanCard({
  plan,
  proposalTurnId,
  turns,
  actions,
  disabled,
  pendingDecisionActionId,
  pendingCancelTurnId,
  elevatedDecisionActionId,
  embedded = false,
  onCommand,
  onDecision,
  onCancelTurn,
}: {
  plan: OperatorPlanProposalResult;
  proposalTurnId: string;
  turns: OperatorTurnView[];
  actions: OperatorActionView[];
  disabled: boolean;
  pendingDecisionActionId?: string;
  pendingCancelTurnId?: string;
  elevatedDecisionActionId?: string;
  embedded?: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
  onDecision: (
    action: OperatorActionView,
    decision: 'approved' | 'rejected',
    response?: OperatorUserInputResponse,
  ) => void;
  onCancelTurn: (turnId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [expandedResultStepId, setExpandedResultStepId] = useState<string | null>(null);
  const executionTurn = [...turns]
    .reverse()
    .find(
      (turn) => turn.journey?.kind === 'execute_plan' && turn.journey.planActionId === plan.planId,
    );
  const active = Boolean(executionTurn && ACTIVE_TURN_STATUSES.has(executionTurn.status));
  const stepActions = plan.steps.map((step) =>
    stepAction(plan.planId, step.id, executionTurn?.id, actions),
  );
  const unsettledStepIndex = stepActions.findIndex(
    (action) => !action || !SETTLED_ACTION_STATUSES.has(action.status),
  );
  const currentStepIndex = active
    ? unsettledStepIndex === -1
      ? plan.steps.length - 1
      : unsettledStepIndex
    : -1;
  const revisionSummary = plan.steps
    .map((step, index) => {
      const bindings = (step.bindings ?? [])
        .map(
          (binding) =>
            `${binding.sourceStepId}${binding.sourcePointer} -> ${binding.targetPointer}`,
        )
        .join(', ');
      return `${index + 1}. ${step.label} (${step.commandName})${bindings ? ` using ${bindings}` : ''}`;
    })
    .join('\n');
  const phaseLabel = executionTurn
    ? active
      ? `Step ${Math.min(plan.steps.length, currentStepIndex + 1)} of ${plan.steps.length}`
      : executionTurn.status === 'completed'
        ? 'Completed'
        : executionTurn.status === 'failed'
          ? 'Failed'
          : executionTurn.status === 'cancelled'
            ? 'Stopped'
            : executionTurn.status
    : 'Ready to review';

  return (
    <article
      data-operator-turn-id={proposalTurnId}
      className={cn(
        'max-w-full overflow-hidden bg-background/75',
        embedded
          ? 'border-b border-border/45 last:border-b-0'
          : 'rounded-2xl border border-border/70 shadow-[0_10px_32px_rgba(0,0,0,0.2)]',
      )}
    >
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{plan.title}</p>
          {!expanded && plan.summary ? (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{plan.summary}</p>
          ) : null}
        </div>
        <Badge
          variant="outline"
          className={cn(
            'h-5 shrink-0 px-1.5 text-[10px] font-medium',
            active && 'border-blue-500/40 bg-blue-500/10 text-blue-400',
            executionTurn?.status === 'completed' &&
              'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
            executionTurn?.status === 'failed' &&
              'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {phaseLabel}
        </Badge>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <>
          {plan.summary ? (
            <p className="border-b border-border/40 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {plan.summary}
            </p>
          ) : null}
          <ol aria-live="polite">
            {plan.steps.map((step, index) => {
              const action = stepActions[index];
              const state = stepState(action, currentStepIndex === index);
              const highlighted = state === 'active' || state === 'attention' || state === 'failed';
              const preview = actionPreview(action);
              const resultExpanded = expandedResultStepId === step.id;
              const rowContent = (
                <>
                  <span className="relative flex h-5 w-5 items-center justify-center">
                    {index < plan.steps.length - 1 ? (
                      <span
                        className={cn(
                          'absolute left-1/2 top-4 h-[calc(100%+18px)] w-px -translate-x-1/2 bg-border/70',
                          state === 'completed' && 'bg-emerald-500/35',
                        )}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background/90">
                      <StateIcon state={state} />
                    </span>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-medium text-foreground">
                      {step.commandName}
                    </p>
                    {highlighted && (step.bindings?.length || step.effect === 'consequential') ? (
                      <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                        {step.effect === 'consequential' ? <p>Approval may be required</p> : null}
                        {(step.bindings ?? []).map((binding) => (
                          <p
                            key={`${binding.sourceStepId}:${binding.sourcePointer}:${binding.targetPointer}`}
                            className="truncate font-mono"
                            title={`${binding.sourceStepId}${binding.sourcePointer} → ${binding.targetPointer}`}
                          >
                            uses {binding.sourceStepId}
                            {binding.sourcePointer} → {binding.targetPointer}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="flex items-center gap-1.5 pt-0.5">
                    <span
                      className={cn(
                        'text-[10px] font-medium text-muted-foreground',
                        state === 'active' && 'text-blue-400',
                        state === 'attention' && 'text-amber-400',
                        state === 'completed' && 'text-emerald-400',
                        state === 'failed' && 'text-destructive',
                      )}
                    >
                      {state === 'attention'
                        ? 'Approval'
                        : state === 'active'
                          ? 'Running'
                          : state === 'completed'
                            ? 'Done'
                            : state === 'failed'
                              ? 'Failed'
                              : 'Queued'}
                    </span>
                    {preview ? (
                      <ChevronDown
                        className={cn(
                          'h-3 w-3 text-muted-foreground transition-transform',
                          resultExpanded && 'rotate-180',
                        )}
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                </>
              );
              return (
                <li
                  key={step.id}
                  className={cn(
                    'relative border-b border-border/35 last:border-b-0',
                    state === 'active' && 'bg-blue-500/[0.055]',
                    state === 'attention' && 'bg-amber-500/[0.05]',
                    state === 'failed' && 'bg-destructive/[0.045]',
                    state === 'pending' && 'opacity-55',
                  )}
                >
                  {highlighted ? (
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 w-0.5',
                        state === 'active' && 'bg-blue-500',
                        state === 'attention' && 'bg-amber-500',
                        state === 'failed' && 'bg-destructive',
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                  {preview ? (
                    <button
                      type="button"
                      className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/25"
                      aria-expanded={resultExpanded}
                      aria-label={`${resultExpanded ? 'Hide' : 'Show'} result for ${step.commandName}`}
                      onClick={() =>
                        setExpandedResultStepId((current) => (current === step.id ? null : step.id))
                      }
                    >
                      {rowContent}
                    </button>
                  ) : (
                    <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 px-4 py-2.5">
                      {rowContent}
                    </div>
                  )}

                  {action?.status === 'pending_approval' &&
                  action.id === elevatedDecisionActionId ? (
                    <p className="border-t border-border/35 px-4 py-3 pl-[54px] text-xs text-muted-foreground">
                      {action.commandName === 'request_user_input'
                        ? 'Answer in the pinned question below to continue.'
                        : 'Review the pinned approval below to continue.'}
                    </p>
                  ) : action?.status === 'pending_approval' ? (
                    <div className="border-t border-border/35 px-4 py-3 pl-[54px]">
                      <OperatorDecisionCard
                        action={action}
                        pending={pendingDecisionActionId === action.id}
                        onDecision={onDecision}
                      />
                    </div>
                  ) : preview && resultExpanded ? (
                    <div
                      className={cn(
                        'border-t px-4 py-2 pl-[54px]',
                        state === 'failed' ? 'border-destructive/15' : 'border-border/30',
                      )}
                    >
                      <pre
                        className={cn(
                          'max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-card/60 p-2 font-mono text-[10px]',
                          state === 'failed' ? 'text-destructive' : 'text-foreground',
                        )}
                      >
                        {preview}
                      </pre>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-3">
            {!executionTurn ? (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-4 text-xs"
                disabled={disabled}
                onClick={() =>
                  onCommand({
                    message: `Run Operator plan ${plan.planId}: ${plan.title}`,
                    journey: { kind: 'execute_plan', planActionId: plan.planId },
                  })
                }
              >
                <Play className="h-3.5 w-3.5" />
                Run plan
              </Button>
            ) : null}
            {active && executionTurn ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-full px-4 text-xs"
                disabled={pendingCancelTurnId === executionTurn.id}
                onClick={() => onCancelTurn(executionTurn.id)}
              >
                {pendingCancelTurnId === executionTurn.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                Stop
              </Button>
            ) : null}
            {!active ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 rounded-full px-4 text-xs"
                disabled={disabled}
                onClick={() =>
                  onCommand({
                    message: `Revise Operator plan ${plan.planId} (${plan.title}). Keep what is still useful, resolve exact arguments again, and propose a replacement plan without executing it.\n\nCurrent steps:\n${revisionSummary}`,
                  })
                }
              >
                <Pencil className="h-3.5 w-3.5" />
                Revise
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </article>
  );
}
