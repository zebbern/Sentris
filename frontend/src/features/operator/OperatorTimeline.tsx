import {
  FindingTriageStatusSchema,
  OperatorGetFindingInputSchema,
  OperatorGetRunInputSchema,
  OperatorListWorkflowsResultSchema,
  OperatorUpdateFindingTriageInputSchema,
  OperatorWorkflowInspectionResultSchema,
  OperatorWorkflowApplyResultSchema,
  OperatorWorkflowDraftResultSchema,
  OperatorWorkflowPromotionResultSchema,
  OperatorRunComparisonResultSchema,
  OperatorRunInputProposalResultSchema,
  OperatorPlanProposalResultSchema,
  OperatorRunWorkflowInputSchema,
  OperatorUserInputResultSchema,
  type OperatorActionStatus,
  type OperatorActionView,
  type FindingTriageStatus,
  type OperatorMessageView,
  type OperatorTurnView,
  type OperatorUserInputResponse,
  type OperatorWorkflowDraftDetail,
} from '@sentris/shared';
import {
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { OperatorRunActivity, type OperatorRunCommandRequest } from './OperatorRunActivity';
import { OperatorRunEvidenceCard } from './OperatorRunEvidenceCard';
import { OperatorRunComparisonCard } from './OperatorRunComparisonCard';
import { OperatorRunInputProposalCard } from './OperatorRunInputProposalCard';
import { OperatorSavedWorkflowCard } from './OperatorSavedWorkflowCard';
import { OperatorPlanCard } from './OperatorPlanCard';
import { OperatorWorkflowDraftCard } from './OperatorWorkflowDraftCard';
import type { OperatorWorkflowRunSelection } from './OperatorWorkflowRunDialog';
import { OperatorDecisionCard } from './OperatorDecisionCard';

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

interface TimelineTurnGroup {
  turnId: string;
  events: TimelineEvent[];
}

type TimelineSegment =
  | { kind: 'message'; event: Extract<TimelineEvent, { kind: 'message' }> }
  | { kind: 'actions'; events: Extract<TimelineEvent, { kind: 'action' }>[] };

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

function groupEventsByTurn(events: TimelineEvent[]): TimelineTurnGroup[] {
  const groups = new Map<string, TimelineTurnGroup>();
  for (const event of events) {
    const turnId = event.value.turnId;
    const existing = groups.get(turnId);
    if (existing) existing.events.push(event);
    else groups.set(turnId, { turnId, events: [event] });
  }
  return [...groups.values()];
}

function segmentTurnEvents(events: TimelineEvent[]): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (const event of events) {
    if (event.kind === 'message') {
      segments.push({ kind: 'message', event });
      continue;
    }

    const previous = segments[segments.length - 1];
    if (previous?.kind === 'actions') previous.events.push(event);
    else segments.push({ kind: 'actions', events: [event] });
  }
  return segments;
}

function formatPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!formatted) return null;
  return formatted.length > 600 ? `${formatted.slice(0, 600)}…` : formatted;
}

function MessageEvent({
  message,
  workflowListCount,
}: {
  message: OperatorMessageView;
  workflowListCount?: number;
}) {
  if (message.role === 'user') {
    return (
      <article
        data-operator-turn-id={message.turnId}
        className="ml-auto max-w-[88%] rounded-[18px] rounded-br-md bg-muted/80 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground shadow-sm md:max-w-[360px]"
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </article>
    );
  }

  const workflowListTransition =
    workflowListCount === undefined
      ? null
      : workflowListCount === 0
        ? 'No saved workflows matched.'
        : `${workflowListCount} saved workflow${workflowListCount === 1 ? ' is' : 's are'} shown above. Choose Configure & run to continue.`;

  return (
    <article data-operator-turn-id={message.turnId} className="flex max-w-full items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/75 text-primary shadow-sm">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 px-1 py-1">
        {workflowListTransition ? (
          <>
            <p className="text-sm text-foreground">{workflowListTransition}</p>
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none font-medium">
                Show Operator summary
              </summary>
              <MarkdownView
                content={message.content}
                dataTestId={`operator-message-${message.id}`}
                className="prose prose-sm mt-2 max-w-none break-words border-t border-border/60 pt-2 text-[13px] leading-relaxed text-foreground dark:prose-invert prose-headings:my-4 prose-headings:text-base prose-headings:leading-snug prose-p:my-1.5 prose-pre:my-2 prose-pre:max-w-full prose-pre:overflow-auto"
              />
            </details>
          </>
        ) : (
          <MarkdownView
            content={message.content}
            dataTestId={`operator-message-${message.id}`}
            className="prose prose-sm max-w-none break-words text-[13px] leading-relaxed text-foreground dark:prose-invert prose-headings:my-4 prose-headings:text-base prose-headings:leading-snug prose-p:my-1.5 prose-pre:my-2 prose-pre:max-w-full prose-pre:overflow-auto"
          />
        )}
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
      <div className="max-w-full space-y-2 rounded-xl border border-border/70 bg-background/65 p-3 shadow-sm">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Run details
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
    <div className="max-w-full space-y-2 rounded-xl border border-border/70 bg-background/65 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <ListChecks className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        Finding actions
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
  pendingDecisionActionId?: string;
  runCommandDisabled: boolean;
  onDecision: (
    action: OperatorActionView,
    decision: 'approved' | 'rejected',
    response?: OperatorUserInputResponse,
  ) => void;
  onRunCommand: (request: OperatorRunCommandRequest) => void;
  onRunSavedWorkflow: (workflow: OperatorWorkflowRunSelection) => void;
  workflowDrafts: OperatorWorkflowDraftDetail[];
  appliedDraftIds: ReadonlySet<string>;
  keptVersionIds: ReadonlySet<string>;
  turns?: OperatorTurnView[];
  pendingCancelTurnId?: string;
  onCancelTurn: (turnId: string) => void;
  elevatedDecisionActionId?: string;
  embedded?: boolean;
}

function ActionEvent({
  action,
  actions,
  pendingDecision,
  pendingDecisionActionId,
  runCommandDisabled,
  onDecision,
  onRunCommand,
  onRunSavedWorkflow,
  workflowDrafts,
  appliedDraftIds,
  keptVersionIds,
  turns = [],
  pendingCancelTurnId,
  onCancelTurn,
  elevatedDecisionActionId,
  embedded = false,
}: ActionEventProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const isUserInput = action.commandName === 'request_user_input';
  const argumentsPreview = isUserInput ? null : formatPreview(action.arguments);
  const draftResult = OperatorWorkflowDraftResultSchema.safeParse(action.result);
  const applyResult = OperatorWorkflowApplyResultSchema.safeParse(action.result);
  const listedWorkflows =
    action.status === 'succeeded' && action.commandName === 'list_workflows'
      ? OperatorListWorkflowsResultSchema.safeParse(action.result)
      : null;
  const inspectedWorkflow =
    action.status === 'succeeded' && action.commandName === 'get_workflow'
      ? OperatorWorkflowInspectionResultSchema.safeParse(action.result)
      : null;
  const runComparison = OperatorRunComparisonResultSchema.safeParse(action.result);
  const runInputProposal = OperatorRunInputProposalResultSchema.safeParse(action.result);
  const planProposal = OperatorPlanProposalResultSchema.safeParse(action.result);
  const userInputResult = OperatorUserInputResultSchema.safeParse(action.result);
  const runWorkflowInput =
    action.commandName === 'run_workflow'
      ? OperatorRunWorkflowInputSchema.safeParse(action.arguments)
      : null;

  if (planProposal.success) {
    return (
      <OperatorPlanCard
        plan={planProposal.data}
        proposalTurnId={action.turnId}
        turns={turns}
        actions={actions}
        disabled={runCommandDisabled}
        pendingDecisionActionId={pendingDecisionActionId}
        pendingCancelTurnId={pendingCancelTurnId}
        elevatedDecisionActionId={elevatedDecisionActionId}
        embedded={embedded}
        onCommand={onRunCommand}
        onDecision={onDecision}
        onCancelTurn={onCancelTurn}
      />
    );
  }

  if (action.runId && action.commandName === 'run_workflow') {
    return (
      <div data-operator-turn-id={action.turnId}>
        <OperatorRunActivity
          runId={action.runId}
          sourceRunId={runWorkflowInput?.success ? runWorkflowInput.data.sourceRunId : undefined}
          allowSourceComparison={
            runWorkflowInput?.success ? !runWorkflowInput.data.inputChanges : true
          }
          embedded={embedded}
          disabled={runCommandDisabled}
          onCommand={onRunCommand}
        />
      </div>
    );
  }

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
        : listedWorkflows?.success
          ? null
          : inspectedWorkflow?.success
            ? null
            : runComparison.success
              ? null
              : runInputProposal.success
                ? null
                : planProposal.success
                  ? null
                  : userInputResult.success
                    ? null
                    : formatPreview(action.result);
  const isActive = action.status === 'executing' || action.status === 'approved';
  const workflowDraft = draftResult.success
    ? workflowDrafts.find(
        (draft) =>
          draft.draftId === draftResult.data.draftId && draft.proposalActionId === action.id,
      )
    : undefined;
  const collapsibleResultPreview = action.status === 'failed' ? null : resultPreview;
  const hasTechnicalDetails = Boolean(argumentsPreview || collapsibleResultPreview);
  const decisionElevated =
    action.status === 'pending_approval' && action.id === elevatedDecisionActionId;
  const hasStructuredContent = Boolean(
    workflowAuthoringResult ||
    listedWorkflows?.success ||
    inspectedWorkflow?.success ||
    runComparison.success ||
    runInputProposal.success ||
    (action.runId && action.commandName !== 'run_workflow') ||
    action.status === 'pending_approval' ||
    userInputResult.success,
  );
  const hasCollapsibleStructuredResult = Boolean(
    listedWorkflows?.success || inspectedWorkflow?.success,
  );
  const detailsExpandable = hasTechnicalDetails || hasCollapsibleStructuredResult;
  const showStructuredContent =
    hasStructuredContent && (!hasCollapsibleStructuredResult || detailsExpanded);
  const headerContent = (
    <>
      {isActive ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
      ) : action.status === 'succeeded' ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : action.status === 'pending_approval' && isUserInput ? (
        <MessageCircleQuestion className="h-3.5 w-3.5 text-blue-400" />
      ) : action.status === 'pending_approval' ? (
        <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
      ) : (
        <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="font-mono text-xs font-semibold">{action.commandName}</span>
      <Badge
        variant="outline"
        className={cn(
          'ml-auto h-5 px-1.5 text-[10px]',
          action.status === 'pending_approval' && isUserInput
            ? 'border-blue-500/35 bg-blue-500/10 text-blue-400'
            : ACTION_STATUS_STYLES[action.status],
        )}
      >
        {action.status === 'pending_approval' && isUserInput
          ? 'Needs input'
          : ACTION_STATUS_LABELS[action.status]}
      </Badge>
      {detailsExpandable ? (
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            detailsExpanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <article
      data-operator-turn-id={action.turnId}
      className={cn(
        'max-w-full overflow-hidden bg-background/75',
        embedded
          ? 'border-b border-border/45 last:border-b-0'
          : 'rounded-2xl border border-border/70 shadow-[0_10px_32px_rgba(0,0,0,0.2)]',
        action.status === 'pending_approval' &&
          (isUserInput
            ? 'border-blue-500/35 bg-blue-500/[0.035]'
            : 'border-amber-500/40 bg-amber-500/[0.04]'),
      )}
    >
      {detailsExpandable ? (
        <button
          type="button"
          className={cn(
            'flex min-h-11 w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/25',
            (detailsExpanded ||
              (hasStructuredContent && !hasCollapsibleStructuredResult) ||
              resultPreview) &&
              'border-b border-border/50',
          )}
          aria-expanded={detailsExpanded}
          aria-label={`${detailsExpanded ? 'Hide' : 'Show'} details for ${action.commandName}`}
          onClick={() => setDetailsExpanded((value) => !value)}
        >
          {headerContent}
        </button>
      ) : (
        <div
          className={cn(
            'flex min-h-11 flex-wrap items-center gap-2 px-4 py-2.5',
            (hasStructuredContent || resultPreview) && 'border-b border-border/50',
          )}
        >
          {headerContent}
        </div>
      )}

      {detailsExpanded ? (
        <div className="grid gap-2.5 border-b border-border/40 px-4 py-3 sm:grid-cols-2">
          {argumentsPreview ? (
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Input
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2 font-mono text-[10px] text-foreground">
                {argumentsPreview}
              </pre>
            </div>
          ) : null}
          {collapsibleResultPreview ? (
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Output
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2 font-mono text-[10px] text-foreground">
                {collapsibleResultPreview}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {action.status === 'failed' && resultPreview ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 font-mono text-[10px] text-destructive">
          {resultPreview}
        </pre>
      ) : null}

      {showStructuredContent ? (
        <div className="space-y-2.5 px-4 py-3">
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
              onRunSavedVersion={onRunSavedWorkflow}
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

          {listedWorkflows?.success ? (
            <OperatorSavedWorkflowCard
              kind="list"
              result={listedWorkflows.data}
              disabled={runCommandDisabled}
              onRun={onRunSavedWorkflow}
            />
          ) : null}

          {inspectedWorkflow?.success ? (
            <OperatorSavedWorkflowCard
              kind="inspection"
              result={inspectedWorkflow.data}
              disabled={runCommandDisabled}
              onRun={onRunSavedWorkflow}
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

          {action.runId && action.commandName !== 'run_workflow' ? (
            <OperatorRunActivity
              runId={action.runId}
              disabled={runCommandDisabled}
              onCommand={onRunCommand}
            />
          ) : null}

          {decisionElevated ? (
            <p className="text-xs text-muted-foreground">
              {isUserInput
                ? 'Answer in the pinned question below to continue.'
                : 'Review the pinned approval below to continue.'}
            </p>
          ) : action.status === 'pending_approval' || userInputResult.success ? (
            <OperatorDecisionCard
              action={action}
              pending={pendingDecision}
              onDecision={onDecision}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

interface ActionSegmentProps extends Omit<ActionEventProps, 'action' | 'embedded'> {
  events: Extract<TimelineEvent, { kind: 'action' }>[];
  collapseCompleted: boolean;
}

function ActionSegment({ events, collapseCompleted, ...actionProps }: ActionSegmentProps) {
  const canCollapse =
    collapseCompleted &&
    events.every(({ value }) => value.status === 'succeeded') &&
    events.every(({ value }) => !value.runId) &&
    events.every(({ value }) => !OperatorPlanProposalResultSchema.safeParse(value.result).success);
  const actionCountLabel = `${events.length} recorded ${events.length === 1 ? 'action' : 'actions'}`;
  const content = (
    <div
      className="overflow-hidden rounded-2xl border border-border/70 bg-background/75 shadow-[0_10px_32px_rgba(0,0,0,0.2)]"
      aria-label={actionCountLabel}
    >
      {events.map(({ value }) => (
        <ActionEvent key={value.id} action={value} embedded {...actionProps} />
      ))}
    </div>
  );

  if (!canCollapse) return content;

  return (
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-border/60 bg-background/55 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        <span className="font-medium">{actionCountLabel}</span>
        <span className="ml-auto text-[10px]">Show activity</span>
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-2">{content}</div>
    </details>
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
  onDecision: (
    action: OperatorActionView,
    decision: 'approved' | 'rejected',
    response?: OperatorUserInputResponse,
  ) => void;
  onRunCommand?: (request: OperatorRunCommandRequest) => void;
  onRunSavedWorkflow?: (workflow: OperatorWorkflowRunSelection) => void;
  pendingCancelTurnId?: string;
  onCancelTurn?: (turnId: string) => void;
  elevatedDecisionActionId?: string;
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
  onRunSavedWorkflow = () => {},
  pendingCancelTurnId,
  onCancelTurn = () => {},
  elevatedDecisionActionId,
}: OperatorTimelineProps) {
  const planIds = actions.flatMap((action) => {
    const plan = OperatorPlanProposalResultSchema.safeParse(action.result);
    return plan.success ? [plan.data.planId] : [];
  });
  const planStepActionIds = new Set(
    actions.flatMap((action) =>
      planIds.some((planId) => action.toolCallId.includes(`:plan:${planId}:`)) ? [action.id] : [],
    ),
  );
  const events = toTimelineEvents(messages, actions).filter(
    (event) =>
      event.kind === 'message' ||
      !planStepActionIds.has(event.value.id) ||
      (event.value.commandName === 'run_workflow' && Boolean(event.value.runId)),
  );
  const turnGroups = groupEventsByTurn(events);
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const latestTurnId = turnGroups[turnGroups.length - 1]?.turnId;
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
  const workflowListCountsByTurn = new Map<string, number>();
  const lastActionsByTurn = new Map<string, OperatorActionView>();
  for (const action of actions) lastActionsByTurn.set(action.turnId, action);
  for (const [turnId, action] of lastActionsByTurn) {
    if (action.status !== 'succeeded' || action.commandName !== 'list_workflows') continue;
    const result = OperatorListWorkflowsResultSchema.safeParse(action.result);
    if (result.success) workflowListCountsByTurn.set(turnId, result.data.length);
  }

  return (
    <div className="space-y-7">
      {turnGroups.map((group) => {
        const turn = turnsById.get(group.turnId);
        const collapseCompleted = group.turnId !== latestTurnId && turn?.status === 'completed';

        return (
          <section
            key={group.turnId}
            data-operator-turn-group={group.turnId}
            aria-label="Operator turn"
            className="space-y-3"
          >
            {segmentTurnEvents(group.events).map((segment, index) =>
              segment.kind === 'message' ? (
                <MessageEvent
                  key={`message-${segment.event.value.id}`}
                  message={segment.event.value}
                  workflowListCount={workflowListCountsByTurn.get(segment.event.value.turnId)}
                />
              ) : (
                <ActionSegment
                  key={`actions-${group.turnId}-${index}`}
                  events={segment.events}
                  collapseCompleted={collapseCompleted}
                  actions={actions}
                  pendingDecision={segment.events.some(
                    ({ value }) => pendingDecisionActionId === value.id,
                  )}
                  pendingDecisionActionId={pendingDecisionActionId}
                  runCommandDisabled={runCommandDisabled}
                  onDecision={onDecision}
                  onRunCommand={onRunCommand}
                  onRunSavedWorkflow={onRunSavedWorkflow}
                  workflowDrafts={workflowDrafts}
                  appliedDraftIds={appliedDraftIds}
                  keptVersionIds={keptVersionIds}
                  turns={turns}
                  pendingCancelTurnId={pendingCancelTurnId}
                  onCancelTurn={onCancelTurn}
                  elevatedDecisionActionId={elevatedDecisionActionId}
                />
              ),
            )}
          </section>
        );
      })}

      {latestInvestigationAction && investigationAnswered ? (
        <InvestigationFollowUps
          action={latestInvestigationAction}
          actions={actions}
          disabled={runCommandDisabled}
          onCommand={onRunCommand}
        />
      ) : null}

      {events.length === 0 && !isActive ? (
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
