import {
  FindingTriageStatusSchema,
  OperatorGetFindingInputSchema,
  OperatorGetRunInputSchema,
  OperatorUpdateFindingTriageInputSchema,
  OperatorWorkflowApplyResultSchema,
  OperatorWorkflowDraftResultSchema,
  OperatorWorkflowPromotionResultSchema,
  OperatorRunComparisonResultSchema,
  OperatorRunInputProposalResultSchema,
  OperatorPlanProposalResultSchema,
  OperatorRunWorkflowInputSchema,
  type OperatorActionStatus,
  type OperatorActionView,
  type FindingTriageStatus,
  type OperatorMessageView,
  type OperatorTurnView,
  type OperatorWorkflowDraftDetail,
} from '@sentris/shared';
import {
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  ListChecks,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { OperatorRunActivity, type OperatorRunCommandRequest } from './OperatorRunActivity';
import { OperatorRunEvidenceCard } from './OperatorRunEvidenceCard';
import { OperatorRunComparisonCard } from './OperatorRunComparisonCard';
import { OperatorRunInputProposalCard } from './OperatorRunInputProposalCard';
import { OperatorPlanCard } from './OperatorPlanCard';
import { OperatorWorkflowDraftCard } from './OperatorWorkflowDraftCard';
import { OPERATOR_COMMAND_LABELS } from './operatorCommandLabels';

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

function MessageEvent({ message }: { message: OperatorMessageView }) {
  if (message.role === 'user') {
    return (
      <article
        data-operator-turn-id={message.turnId}
        className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground shadow-sm md:max-w-[72%]"
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </article>
    );
  }

  return (
    <article
      data-operator-turn-id={message.turnId}
      className="flex max-w-[92%] items-start gap-2.5 md:max-w-[82%]"
    >
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readFindingStatus(result: unknown): FindingTriageStatus | null {
  const resultRecord = asRecord(result);
  if (!resultRecord) return null;
  if (resultRecord.triage === null || resultRecord.triage === undefined) return 'new';
  const triage = asRecord(resultRecord.triage);
  const parsed = FindingTriageStatusSchema.safeParse(triage?.status);
  return parsed.success ? parsed.data : null;
}

function readFindingRunId(result: unknown): string | null {
  const runId = asRecord(result)?.run_id;
  return typeof runId === 'string' && runId.length > 0 ? runId : null;
}

function currentFindingStatus(
  findingId: string,
  inspectionResult: unknown,
  actions: OperatorActionView[],
): FindingTriageStatus | null {
  let status = readFindingStatus(inspectionResult);
  for (const action of actions) {
    if (action.status !== 'succeeded' || action.commandName !== 'update_finding_triage') continue;
    const update = OperatorUpdateFindingTriageInputSchema.safeParse(action.arguments);
    if (update.success && update.data.findingId === findingId && update.data.status) {
      status = update.data.status;
    }
  }
  return status;
}

function InvestigationFollowUps({
  action,
  actions,
  disabled,
  onCommand,
}: {
  action: OperatorActionView;
  actions: OperatorActionView[];
  disabled: boolean;
  onCommand: (request: OperatorRunCommandRequest) => void;
}) {
  const runInput =
    action.commandName === 'get_run' ? OperatorGetRunInputSchema.safeParse(action.arguments) : null;
  const findingInput =
    action.commandName === 'get_finding'
      ? OperatorGetFindingInputSchema.safeParse(action.arguments)
      : null;

  if (runInput?.success) {
    return (
      <div className="ml-9 max-w-[calc(100%-2.25rem)] space-y-2 rounded-lg border border-primary/20 bg-primary/[0.03] p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Suggested follow-ups
        </div>
        <OperatorRunEvidenceCard
          runId={runInput.data.runId}
          result={action.result}
          disabled={disabled}
          onCommand={onCommand}
        />
        <OperatorRunActivity
          runId={runInput.data.runId}
          disabled={disabled}
          onCommand={onCommand}
        />
      </div>
    );
  }

  if (!findingInput?.success) return null;

  const findingId = findingInput.data.findingId;
  const status = currentFindingStatus(findingId, action.result, actions);
  const nextStatus =
    status === 'new'
      ? ({ status: 'triaged', label: 'Mark triaged' } as const)
      : status === 'triaged'
        ? ({ status: 'in_progress', label: 'Start work' } as const)
        : null;
  const sourceRunId = readFindingRunId(action.result);

  if (!nextStatus && !sourceRunId) return null;

  return (
    <div className="ml-9 max-w-[calc(100%-2.25rem)] space-y-2 rounded-lg border border-primary/20 bg-primary/[0.03] p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <ListChecks className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        Suggested follow-ups
      </div>
      {nextStatus ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={disabled}
          onClick={() =>
            onCommand({
              message: `${nextStatus.label} for finding ${findingId}`,
              directCommand: {
                commandName: 'update_finding_triage',
                arguments: { findingId, status: nextStatus.status },
              },
            })
          }
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          {nextStatus.label}
        </Button>
      ) : null}
      {sourceRunId ? (
        <OperatorRunActivity
          runId={sourceRunId}
          label="Source workflow run"
          disabled={disabled}
          onCommand={onCommand}
        />
      ) : null}
    </div>
  );
}

interface ActionEventProps {
  action: OperatorActionView;
  actions: OperatorActionView[];
  pendingDecision: boolean;
  runCommandDisabled: boolean;
  onDecision: (action: OperatorActionView, decision: 'approved' | 'rejected') => void;
  onRunCommand: (request: OperatorRunCommandRequest) => void;
  workflowDrafts: OperatorWorkflowDraftDetail[];
  appliedDraftIds: ReadonlySet<string>;
  keptVersionIds: ReadonlySet<string>;
  turns?: OperatorTurnView[];
  pendingCancelTurnId?: string;
  onCancelTurn: (turnId: string) => void;
}

function ActionEvent({
  action,
  actions,
  pendingDecision,
  runCommandDisabled,
  onDecision,
  onRunCommand,
  workflowDrafts,
  appliedDraftIds,
  keptVersionIds,
  turns = [],
  pendingCancelTurnId,
  onCancelTurn,
}: ActionEventProps) {
  const argumentsPreview = formatPreview(action.arguments);
  const draftResult = OperatorWorkflowDraftResultSchema.safeParse(action.result);
  const applyResult = OperatorWorkflowApplyResultSchema.safeParse(action.result);
  const runComparison = OperatorRunComparisonResultSchema.safeParse(action.result);
  const runInputProposal = OperatorRunInputProposalResultSchema.safeParse(action.result);
  const planProposal = OperatorPlanProposalResultSchema.safeParse(action.result);
  const runWorkflowInput =
    action.commandName === 'run_workflow'
      ? OperatorRunWorkflowInputSchema.safeParse(action.arguments)
      : null;
  const workflowAuthoringResult = draftResult.success
    ? draftResult.data
    : applyResult.success
      ? applyResult.data
      : null;
  const resultPreview =
    action.status === 'failed'
      ? action.error
      : workflowAuthoringResult
        ? null
        : runComparison.success
          ? null
          : runInputProposal.success
            ? null
            : planProposal.success
              ? null
              : formatPreview(action.result);
  const isActive = action.status === 'executing' || action.status === 'approved';
  const workflowDraft = draftResult.success
    ? workflowDrafts.find(
        (draft) =>
          draft.draftId === draftResult.data.draftId && draft.proposalActionId === action.id,
      )
    : undefined;

  return (
    <article
      data-operator-turn-id={action.turnId}
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
        <span className="text-xs font-semibold">{OPERATOR_COMMAND_LABELS[action.commandName]}</span>
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

        {workflowAuthoringResult ? (
          <OperatorWorkflowDraftCard
            sessionId={action.sessionId}
            result={workflowAuthoringResult}
            detail={workflowDraft}
            disabled={runCommandDisabled}
            applied={draftResult.success && appliedDraftIds.has(draftResult.data.draftId)}
            onApply={(draft) =>
              onRunCommand({
                message: `Save workflow draft ${draft.draftId} as a new immutable workflow version`,
                directCommand: {
                  commandName: 'apply_workflow_draft',
                  arguments: { draftId: draft.draftId },
                },
              })
            }
            onRunImprovedVersion={(savedWorkflow) =>
              onRunCommand({
                message: `Run improved workflow version ${savedWorkflow.versionId} using inputs from run ${savedWorkflow.sourceRunId}`,
                directCommand: {
                  commandName: 'run_workflow',
                  arguments: {
                    workflowId: savedWorkflow.workflowId,
                    versionId: savedWorkflow.versionId,
                    sourceRunId: savedWorkflow.sourceRunId,
                    inputs: {},
                  },
                },
              })
            }
          />
        ) : null}

        {runComparison.success ? (
          <OperatorRunComparisonCard
            result={runComparison.data}
            disabled={runCommandDisabled}
            kept={
              Boolean(runComparison.data.candidate.workflowVersionId) &&
              keptVersionIds.has(runComparison.data.candidate.workflowVersionId ?? '')
            }
            onCommand={onRunCommand}
          />
        ) : null}

        {runInputProposal.success ? (
          <OperatorRunInputProposalCard
            result={runInputProposal.data}
            disabled={runCommandDisabled}
            onCommand={onRunCommand}
          />
        ) : null}

        {planProposal.success ? (
          <OperatorPlanCard
            plan={planProposal.data}
            turns={turns}
            actions={actions}
            disabled={runCommandDisabled}
            pendingCancelTurnId={pendingCancelTurnId}
            onCommand={onRunCommand}
            onCancelTurn={onCancelTurn}
          />
        ) : null}

        {action.runId ? (
          <OperatorRunActivity
            runId={action.runId}
            sourceRunId={runWorkflowInput?.success ? runWorkflowInput.data.sourceRunId : undefined}
            allowSourceComparison={
              runWorkflowInput?.success ? !runWorkflowInput.data.inputChanges : true
            }
            disabled={runCommandDisabled}
            onCommand={onRunCommand}
          />
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
  turns?: OperatorTurnView[];
  isActive: boolean;
  pendingDecisionActionId?: string;
  runCommandDisabled?: boolean;
  workflowDrafts?: OperatorWorkflowDraftDetail[];
  onDecision: (action: OperatorActionView, decision: 'approved' | 'rejected') => void;
  onRunCommand?: (request: OperatorRunCommandRequest) => void;
  pendingCancelTurnId?: string;
  onCancelTurn?: (turnId: string) => void;
}

export function OperatorTimeline({
  messages,
  actions,
  turns = [],
  isActive,
  pendingDecisionActionId,
  runCommandDisabled = false,
  workflowDrafts = [],
  onDecision,
  onRunCommand = () => {},
  pendingCancelTurnId,
  onCancelTurn = () => {},
}: OperatorTimelineProps) {
  const events = toTimelineEvents(messages, actions);
  const latestInvestigationAction = [...actions]
    .reverse()
    .find(
      (action) =>
        action.status === 'succeeded' &&
        (action.commandName === 'get_run' || action.commandName === 'get_finding'),
    );
  const investigationAnswered = latestInvestigationAction
    ? messages.some(
        (message) =>
          message.turnId === latestInvestigationAction.turnId && message.role === 'assistant',
      )
    : false;
  const appliedDraftIds = new Set(
    actions.flatMap((action) => {
      if (action.status !== 'succeeded') return [];
      const parsed = OperatorWorkflowApplyResultSchema.safeParse(action.result);
      return parsed.success ? [parsed.data.draftId] : [];
    }),
  );
  const keptVersionIds = new Set(
    actions.flatMap((action) => {
      if (action.status !== 'succeeded') return [];
      const parsed = OperatorWorkflowPromotionResultSchema.safeParse(action.result);
      return parsed.success ? [parsed.data.versionId] : [];
    }),
  );

  return (
    <div className="space-y-3">
      {events.map((event) =>
        event.kind === 'message' ? (
          <MessageEvent key={`message-${event.value.id}`} message={event.value} />
        ) : (
          <ActionEvent
            key={`action-${event.value.id}`}
            action={event.value}
            actions={actions}
            pendingDecision={pendingDecisionActionId === event.value.id}
            runCommandDisabled={runCommandDisabled}
            onDecision={onDecision}
            onRunCommand={onRunCommand}
            workflowDrafts={workflowDrafts}
            appliedDraftIds={appliedDraftIds}
            keptVersionIds={keptVersionIds}
            turns={turns}
            pendingCancelTurnId={pendingCancelTurnId}
            onCancelTurn={onCancelTurn}
          />
        ),
      )}

      {latestInvestigationAction && investigationAnswered ? (
        <InvestigationFollowUps
          action={latestInvestigationAction}
          actions={actions}
          disabled={runCommandDisabled}
          onCommand={onRunCommand}
        />
      ) : null}

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
