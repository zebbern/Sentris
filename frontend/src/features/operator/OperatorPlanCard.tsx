import {
  type OperatorActionView,
  type OperatorPlanProposalResult,
  type OperatorTurnView,
} from '@sentris/shared';
import { Check, Circle, Loader2, Pencil, Play, Square, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OperatorRunCommandRequest } from './OperatorRunActivity';

const ACTIVE_TURN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);

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

export function OperatorPlanCard({
  plan,
  turns,
  actions,
  disabled,
  pendingCancelTurnId,
  onCommand,
  onCancelTurn,
}: {
  plan: OperatorPlanProposalResult;
  turns: OperatorTurnView[];
  actions: OperatorActionView[];
  disabled: boolean;
  pendingCancelTurnId?: string;
  onCommand: (request: OperatorRunCommandRequest) => void;
  onCancelTurn: (turnId: string) => void;
}) {
  const executionTurn = [...turns]
    .reverse()
    .find(
      (turn) => turn.journey?.kind === 'execute_plan' && turn.journey.planActionId === plan.planId,
    );
  const active = Boolean(executionTurn && ACTIVE_TURN_STATUSES.has(executionTurn.status));
  const completedSteps = plan.steps.filter(
    (step) => stepAction(plan.planId, step.id, executionTurn?.id, actions)?.status === 'succeeded',
  ).length;
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

  return (
    <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.03] p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{plan.title}</p>
          {plan.summary ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{plan.summary}</p>
          ) : null}
        </div>
        <Badge variant="outline" className="h-5 text-[10px]">
          {executionTurn
            ? active
              ? `${completedSteps}/${plan.steps.length} complete`
              : executionTurn.status
            : 'Ready to review'}
        </Badge>
      </div>

      <ol className="space-y-1.5">
        {plan.steps.map((step, index) => {
          const action = stepAction(plan.planId, step.id, executionTurn?.id, actions);
          const running = action?.status === 'executing' || action?.status === 'approved';
          const succeeded = action?.status === 'succeeded';
          const failed = action?.status === 'failed' || action?.status === 'rejected';
          return (
            <li
              key={step.id}
              className={cn(
                'flex items-start gap-2 rounded-md border border-border/60 bg-background/45 px-2.5 py-2',
                running && 'border-blue-500/35 bg-blue-500/[0.04]',
                failed && 'border-destructive/35 bg-destructive/[0.04]',
              )}
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                ) : succeeded ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : failed ? (
                  <X className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Circle className="h-3 w-3 text-muted-foreground" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {index + 1}. {step.label}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {step.commandName}
                  {step.effect === 'consequential' ? ' · may ask for approval' : ''}
                </p>
                {(step.bindings ?? []).map((binding) => (
                  <p
                    key={`${binding.sourceStepId}:${binding.sourcePointer}:${binding.targetPointer}`}
                    className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80"
                    title={`${binding.sourceStepId}${binding.sourcePointer} → ${binding.targetPointer}`}
                  >
                    uses {binding.sourceStepId}
                    {binding.sourcePointer} → {binding.targetPointer}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        {!executionTurn ? (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-xs"
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
            className="h-8 gap-1.5 text-xs"
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
            className="h-8 gap-1.5 text-xs"
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
    </div>
  );
}
