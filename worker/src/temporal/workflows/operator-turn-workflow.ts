import {
  ActivityCancellationType,
  CancellationScope,
  allHandlersFinished,
  condition,
  defineUpdate,
  isCancellation,
  patched,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

import {
  OperatorRunComparisonResultSchema,
  OperatorRunInputProposalResultSchema,
  OperatorPlanProposalResultSchema,
  resolveOperatorPlanStepArguments,
  OperatorWorkflowApplyResultSchema,
  OperatorWorkflowDraftResultSchema,
  OperatorWorkflowPromotionResultSchema,
  type OperatorCommandName,
  type OperatorJourney,
  type OperatorRunObservation,
  type OperatorWorkflowDraftResult,
} from '@sentris/shared';

import type {
  OperatorActivityInput,
  OperatorExecuteActionInput,
  OperatorExecuteActionOutput,
  OperatorModelStepInput,
  OperatorModelStepOutput,
  OperatorModelToolCall,
  OperatorLoadPlanInput,
  OperatorObserveRunInput,
  OperatorPrepareActionInput,
  OperatorPreparedActionOutput,
  OperatorSettleMcpActionInput,
} from '../activities/operator.activity';
import {
  executeDurableMcpOperation,
  type McpOperationWorkflowActivities,
} from './mcp-operation-workflow-executor';

const MAX_OPERATOR_STEPS = 8;
const MAX_AUTOMATIC_DRAFT_REPAIR_STEPS = 6;
const MAX_IMPROVEMENT_PROPOSAL_STEPS = 6;
const AUTOMATIC_DRAFT_REPAIR_PATCH_ID = 'operator-automatic-draft-repair-v1';
const DEFAULT_COMPLETION = 'I could not produce a useful answer for this turn.';
const APPROVAL_RECONCILE_INTERVAL = '5 seconds';
const MAX_PLAN_FAILURE_DETAIL_LENGTH = 400;
const MAX_PLAN_RESULT_LINKS = 4;
const MAX_PLAN_COMPLETION_LENGTH = 2_400;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getStructuredActionCompletionMessage(result: unknown): string | undefined {
  const kind =
    typeof result === 'object' && result !== null && 'kind' in result ? result.kind : undefined;

  switch (kind) {
    case 'operator-plan':
      return OperatorPlanProposalResultSchema.safeParse(result).success
        ? 'Plan ready for review. Select Run plan or Revise.'
        : undefined;
    case 'workflow-draft': {
      const draft = OperatorWorkflowDraftResultSchema.safeParse(result);
      if (!draft.success) return undefined;
      return draft.data.validation.valid
        ? 'Workflow draft ready for review. Select Save version when it is ready.'
        : 'Workflow draft needs revision. Review the validation errors shown in the card.';
    }
    case 'run-input-proposal':
      return OperatorRunInputProposalResultSchema.safeParse(result).success
        ? 'Input changes ready for review. Select Run with changes or ask for a revision.'
        : undefined;
    case 'run-comparison': {
      const comparison = OperatorRunComparisonResultSchema.safeParse(result);
      if (!comparison.success) return undefined;
      return comparison.data.source.workflowVersionId && comparison.data.candidate.workflowVersionId
        ? 'Comparison ready for review. Select Keep candidate or Revise again.'
        : 'Comparison ready for review. Select Revise again if another improvement is needed.';
    }
    default:
      return undefined;
  }
}

function getControlActionCompletionMessage(input: {
  commandName: OperatorCommandName;
  result: unknown;
  launchedRunId?: string;
}): string | undefined {
  const applied = OperatorWorkflowApplyResultSchema.safeParse(input.result);
  if (input.commandName === 'apply_workflow_draft' && applied.success) {
    if (applied.data.staged) {
      return 'Candidate workflow version saved. Run it when ready.';
    }
    return applied.data.created
      ? 'Workflow saved. Open it in Builder when ready.'
      : 'Workflow version saved.';
  }

  const promoted = OperatorWorkflowPromotionResultSchema.safeParse(input.result);
  if (input.commandName === 'promote_workflow_version' && promoted.success) {
    return promoted.data.alreadyCurrent
      ? 'Candidate workflow version was already active.'
      : 'Candidate workflow version is now active.';
  }

  const resultRecord =
    typeof input.result === 'object' && input.result !== null
      ? (input.result as Record<string, unknown>)
      : undefined;
  const runId =
    input.launchedRunId ??
    (typeof resultRecord?.runId === 'string' ? resultRecord.runId : undefined);
  if (input.commandName === 'run_workflow' && runId) {
    return 'Workflow run started. Follow progress in the run card.';
  }
  if (input.commandName === 'retry_run' && runId) {
    return 'Retry started as a new workflow run. Follow progress in the run card.';
  }
  if (input.commandName === 'cancel_run') {
    if (resultRecord?.alreadyTerminal === true) {
      const status = typeof resultRecord.status === 'string' ? resultRecord.status : 'terminal';
      return `The run was already ${status}; no cancellation was needed.`;
    }
    return resultRecord?.cancelled === true
      ? 'Cancellation requested. Follow the run card for its terminal status.'
      : undefined;
  }
  if (input.commandName === 'update_finding_triage') {
    return 'Finding triage updated.';
  }

  return undefined;
}

export interface OperatorTurnWorkflowInput {
  sessionId: string;
  turnId: string;
  organizationId: string;
  journey?: OperatorJourney;
  directCommand?: {
    toolCallId: string;
    commandName: OperatorCommandName;
    arguments: Record<string, unknown>;
  };
}

export interface OperatorActionDecisionUpdate {
  actionId: string;
  decision: 'approved' | 'rejected';
  expectedVersion: number;
}

export interface OperatorActionDecisionUpdateResult {
  accepted: true;
  actionId: string;
}

export const OPERATOR_ACTION_DECISION_UPDATE_NAME = 'operatorActionDecision';
export const operatorActionDecisionUpdate = defineUpdate<
  OperatorActionDecisionUpdateResult,
  [OperatorActionDecisionUpdate]
>(OPERATOR_ACTION_DECISION_UPDATE_NAME);

const shortActivities = proxyActivities<{
  operatorSetTurnStatusActivity(
    input: OperatorActivityInput & { status: 'running' | 'awaiting_approval' },
  ): Promise<void>;
  operatorPrepareActionActivity(
    input: OperatorPrepareActionInput,
  ): Promise<OperatorPreparedActionOutput>;
  operatorSettleMcpActionActivity(input: OperatorSettleMcpActionInput): Promise<void>;
  operatorCompleteTurnActivity(input: OperatorActivityInput & { message: string }): Promise<void>;
  operatorFailTurnActivity(input: OperatorActivityInput & { error: string }): Promise<void>;
  operatorCancelTurnActivity(input: OperatorActivityInput & { message: string }): Promise<void>;
  operatorLoadPlanActivity(
    input: OperatorLoadPlanInput,
  ): Promise<ReturnType<typeof OperatorPlanProposalResultSchema.parse>>;
}>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '20 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    maximumInterval: '20 seconds',
    backoffCoefficient: 2,
  },
});

const { operatorExecuteActionActivity } = proxyActivities<{
  operatorExecuteActionActivity(
    input: OperatorExecuteActionInput,
  ): Promise<OperatorExecuteActionOutput>;
}>({
  // Capability discovery can legitimately wait on its durable child workflow for up to
  // 150 seconds. Keep it outside the short-control activity budget so the backend owns
  // the discovery deadline and Temporal does not fan out duplicate HTTP retries.
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '20 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    maximumInterval: '20 seconds',
    backoffCoefficient: 2,
  },
});

const { operatorModelStepActivity } = proxyActivities<{
  operatorModelStepActivity(input: OperatorModelStepInput): Promise<OperatorModelStepOutput>;
}>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2,
  },
});

const { operatorObserveRunActivity } = proxyActivities<{
  operatorObserveRunActivity(input: OperatorObserveRunInput): Promise<{
    runId: string;
    workflowId: string;
    status: string;
    terminal: boolean;
    result?: unknown;
  }>;
}>({
  startToCloseTimeout: '24 hours',
  scheduleToCloseTimeout: '24 hours',
  heartbeatTimeout: '20 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: '2 seconds',
    maximumInterval: '1 minute',
    backoffCoefficient: 2,
  },
});

const { operatorAwaitRunActivity } = proxyActivities<{
  operatorAwaitRunActivity(input: OperatorObserveRunInput): Promise<OperatorRunObservation>;
}>({
  startToCloseTimeout: '2 minutes',
  scheduleToCloseTimeout: '24 hours',
  heartbeatTimeout: '20 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
    backoffCoefficient: 1.5,
  },
});

const { prepareMcpOperationActivity, reconcileMcpOperationActivity } = proxyActivities<
  Pick<
    McpOperationWorkflowActivities,
    'prepareMcpOperationActivity' | 'reconcileMcpOperationActivity'
  >
>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

const { dispatchMcpOperationActivity } = proxyActivities<
  Pick<McpOperationWorkflowActivities, 'dispatchMcpOperationActivity'>
>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});

const mcpOperationActivities: McpOperationWorkflowActivities = {
  prepareMcpOperationActivity,
  dispatchMcpOperationActivity,
  reconcileMcpOperationActivity,
};

type OperatorDecisionMap = Map<string, OperatorActionDecisionUpdate>;

type OperatorActionExecutionOutcome =
  | { disposition: 'executed'; executed: OperatorExecuteActionOutput }
  | {
      disposition: 'rejected';
      reason: 'user_rejected' | 'action_failed';
      error?: string;
    }
  | { disposition: 'already_completed'; result?: unknown };

function rejectedActionOutcome(input: {
  interpretActionStatus: boolean;
  actionStatus: OperatorPreparedActionOutput['actionStatus'];
  actionError?: string;
}): Extract<OperatorActionExecutionOutcome, { disposition: 'rejected' }> {
  if (input.interpretActionStatus && input.actionStatus === 'failed') {
    return {
      disposition: 'rejected',
      reason: 'action_failed',
      ...(input.actionError ? { error: input.actionError } : {}),
    };
  }
  return { disposition: 'rejected', reason: 'user_rejected' };
}

async function prepareAndExecuteOperatorAction(input: {
  base: OperatorActivityInput;
  toolCall: OperatorModelToolCall;
  decisions: OperatorDecisionMap;
  interpretActionStatus: boolean;
  userConfirmed?: boolean;
}): Promise<OperatorActionExecutionOutcome> {
  const prepared = await shortActivities.operatorPrepareActionActivity({
    ...input.base,
    ...input.toolCall,
    ...(input.userConfirmed ? { userConfirmed: true } : {}),
  });
  if (prepared.disposition === 'already_completed') {
    return {
      disposition: 'already_completed',
      ...(prepared.completedResult !== undefined ? { result: prepared.completedResult } : {}),
    };
  }
  if (prepared.disposition === 'rejected') {
    return rejectedActionOutcome({
      interpretActionStatus: input.interpretActionStatus,
      actionStatus: prepared.actionStatus,
      ...(prepared.actionError ? { actionError: prepared.actionError } : {}),
    });
  }

  if (prepared.disposition === 'wait_for_approval') {
    await shortActivities.operatorSetTurnStatusActivity({
      ...input.base,
      status: 'awaiting_approval',
    });
    let approvalOutcome: 'execute' | 'rejected' | 'already_completed' | undefined;
    let reconciledCompletedResult: unknown;
    let reconciledAction: OperatorPreparedActionOutput | undefined;
    while (!approvalOutcome) {
      const updateArrived = await condition(() => {
        const decision = input.decisions.get(prepared.actionId);
        return decision?.expectedVersion === prepared.actionVersion;
      }, APPROVAL_RECONCILE_INTERVAL);
      if (updateArrived) {
        const decision = input.decisions.get(prepared.actionId)!;
        input.decisions.delete(prepared.actionId);
        approvalOutcome = decision.decision === 'approved' ? 'execute' : 'rejected';
        break;
      }

      const reconciled = await shortActivities.operatorPrepareActionActivity({
        ...input.base,
        ...input.toolCall,
      });
      if (reconciled.actionId !== prepared.actionId) {
        throw new Error('Operator approval reconciliation returned a different action');
      }
      if (reconciled.disposition !== 'wait_for_approval') {
        approvalOutcome = reconciled.disposition;
        reconciledCompletedResult = reconciled.completedResult;
        reconciledAction = reconciled;
      }
    }
    await shortActivities.operatorSetTurnStatusActivity({ ...input.base, status: 'running' });
    if (approvalOutcome === 'rejected') {
      return reconciledAction
        ? rejectedActionOutcome({
            interpretActionStatus: input.interpretActionStatus,
            actionStatus: reconciledAction.actionStatus,
            ...(reconciledAction.actionError ? { actionError: reconciledAction.actionError } : {}),
          })
        : { disposition: 'rejected', reason: 'user_rejected' };
    }
    if (approvalOutcome === 'already_completed') {
      return {
        disposition: 'already_completed',
        ...(reconciledCompletedResult !== undefined ? { result: reconciledCompletedResult } : {}),
      };
    }
  }

  const executed = await operatorExecuteActionActivity({
    ...input.base,
    actionId: prepared.actionId,
  });
  if (input.interpretActionStatus && executed.actionStatus === 'failed') {
    return {
      disposition: 'rejected',
      reason: 'action_failed',
      ...(executed.actionError ? { error: executed.actionError } : {}),
    };
  }
  if (
    input.interpretActionStatus &&
    executed.actionStatus !== 'succeeded' &&
    !executed.mcpOperationRequest
  ) {
    throw new Error(
      `Operator action ${executed.actionId} returned unexpected status ${executed.actionStatus}`,
    );
  }
  return { disposition: 'executed', executed };
}

const AUTOMATIC_DRAFT_REPAIR_COMMANDS = new Set<OperatorCommandName>([
  'list_components',
  'get_component',
  'revise_workflow_draft',
]);

async function runAutomaticWorkflowDraftRepair(input: {
  base: OperatorActivityInput;
  draft: OperatorWorkflowDraftResult;
  decisions: OperatorDecisionMap;
  interpretActionStatus: boolean;
  toolCallHistory: OperatorModelToolCall[];
}): Promise<string | undefined> {
  const inspection = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
    userConfirmed: true,
    toolCall: {
      toolCallId: `${input.base.turnId}:auto-repair:inspect:${input.draft.draftId}`,
      commandName: 'get_workflow_draft',
      arguments: { draftId: input.draft.draftId },
    },
  });
  if (inspection.disposition === 'rejected') return undefined;

  for (let repairStep = 0; repairStep < MAX_AUTOMATIC_DRAFT_REPAIR_STEPS; repairStep += 1) {
    const modelStep = await operatorModelStepActivity({
      ...input.base,
      step: MAX_OPERATOR_STEPS + repairStep,
      mode: 'workflow_draft_repair',
      sourceDraftId: input.draft.draftId,
      toolCallHistory: input.toolCallHistory.slice(),
    });
    if (modelStep.toolCalls.length === 0) return undefined;
    input.toolCallHistory.push(...modelStep.toolCalls);

    for (const toolCall of modelStep.toolCalls) {
      if (!AUTOMATIC_DRAFT_REPAIR_COMMANDS.has(toolCall.commandName)) return undefined;
      const isRevision = toolCall.commandName === 'revise_workflow_draft';
      if (isRevision && toolCall.arguments.draftId !== input.draft.draftId) return undefined;

      const outcome = await prepareAndExecuteOperatorAction({
        base: input.base,
        toolCall,
        decisions: input.decisions,
        interpretActionStatus: input.interpretActionStatus,
      });
      if (!isRevision) continue;
      if (outcome.disposition === 'rejected') return undefined;

      const result = outcome.disposition === 'executed' ? outcome.executed.result : outcome.result;
      const revised = OperatorWorkflowDraftResultSchema.safeParse(result);
      if (!revised.success || revised.data.parentDraftId !== input.draft.draftId) return undefined;
      return getStructuredActionCompletionMessage(revised.data);
    }
  }

  return undefined;
}

async function runImproveRunJourney(input: {
  base: OperatorActivityInput;
  journey: Extract<OperatorJourney, { kind: 'improve_run' }>;
  decisions: OperatorDecisionMap;
  interpretActionStatus: boolean;
}): Promise<void> {
  const sourceRunId = input.journey.sourceRunId;
  const toolCallHistory: OperatorModelToolCall[] = [];
  let lastText = '';

  const sourceInspection = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
    userConfirmed: true,
    toolCall: {
      toolCallId: `${input.base.turnId}:journey:inspect-source`,
      commandName: 'get_run',
      arguments: { runId: sourceRunId },
    },
  });
  if (sourceInspection.disposition !== 'executed') {
    throw new Error('The improvement journey could not inspect its source run');
  }

  let proposal: ReturnType<typeof OperatorWorkflowDraftResultSchema.parse> | undefined;
  for (let step = 0; step < MAX_IMPROVEMENT_PROPOSAL_STEPS && !proposal; step += 1) {
    const modelStep = await operatorModelStepActivity({
      ...input.base,
      step,
      mode: 'improve_run_proposal',
      sourceRunId,
      ...(toolCallHistory.length > 0 ? { toolCallHistory: toolCallHistory.slice() } : {}),
    });
    if (modelStep.text.trim()) lastText = modelStep.text.trim();
    if (modelStep.toolCalls.length === 0) break;
    toolCallHistory.push(...modelStep.toolCalls);

    for (const toolCall of modelStep.toolCalls) {
      const outcome = await prepareAndExecuteOperatorAction({
        base: input.base,
        toolCall,
        decisions: input.decisions,
        interpretActionStatus: input.interpretActionStatus,
      });
      if (outcome.disposition !== 'executed') continue;

      const parsed = OperatorWorkflowDraftResultSchema.safeParse(outcome.executed.result);
      if (
        parsed.success &&
        parsed.data.mode === 'update' &&
        parsed.data.sourceRunId === sourceRunId &&
        parsed.data.validation.valid
      ) {
        proposal = parsed.data;
        break;
      }
    }
  }

  if (!proposal) {
    await shortActivities.operatorCompleteTurnActivity({
      ...input.base,
      message:
        lastText ||
        'The recorded run evidence did not produce a valid, evidence-supported workflow revision.',
    });
    return;
  }

  const appliedOutcome = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
    toolCall: {
      toolCallId: `${input.base.turnId}:journey:apply`,
      commandName: 'apply_workflow_draft',
      arguments: { draftId: proposal.draftId },
    },
  });
  if (appliedOutcome.disposition === 'rejected') {
    await shortActivities.operatorCompleteTurnActivity({
      ...input.base,
      message: 'The proposed revision was not approved, so the workflow was left unchanged.',
    });
    return;
  }
  if (appliedOutcome.disposition !== 'executed') {
    throw new Error('The improvement journey could not resolve its saved workflow version');
  }

  const applied = OperatorWorkflowApplyResultSchema.parse(appliedOutcome.executed.result);
  if (applied.created || applied.sourceRunId !== sourceRunId) {
    throw new Error('The improvement journey applied a workflow version outside its source run');
  }

  const runOutcome = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
    userConfirmed: true,
    toolCall: {
      toolCallId: `${input.base.turnId}:journey:run`,
      commandName: 'run_workflow',
      arguments: {
        workflowId: applied.workflowId,
        versionId: applied.versionId,
        sourceRunId,
        inputs: {},
      },
    },
  });
  if (runOutcome.disposition !== 'executed' || !runOutcome.executed.launchedRunId) {
    throw new Error('The improvement journey could not launch its candidate run');
  }

  const candidateRunId = runOutcome.executed.launchedRunId;
  const observation = await operatorAwaitRunActivity({
    ...input.base,
    runId: candidateRunId,
  });

  const comparisonOutcome = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
    userConfirmed: true,
    toolCall: {
      toolCallId: `${input.base.turnId}:journey:compare`,
      commandName: 'compare_runs',
      arguments: { sourceRunId, candidateRunId },
    },
  });
  if (comparisonOutcome.disposition !== 'executed') {
    throw new Error('The improvement journey could not compare its candidate run');
  }

  const comparison = OperatorRunComparisonResultSchema.parse(comparisonOutcome.executed.result);
  const summary = await operatorModelStepActivity({
    ...input.base,
    step: MAX_IMPROVEMENT_PROPOSAL_STEPS,
    mode: 'improve_run_summary',
    sourceRunId,
    observations: [observation],
    ...(toolCallHistory.length > 0 ? { toolCallHistory } : {}),
  });
  await shortActivities.operatorCompleteTurnActivity({
    ...input.base,
    message:
      summary.text.trim() ||
      `The candidate run ${candidateRunId} was ${comparison.assessment} against source run ${sourceRunId}.`,
  });
}

interface OperatorPlanResultLink {
  label: string;
  href: string;
}

function addOperatorPlanResultLink(
  links: Map<string, OperatorPlanResultLink>,
  link: OperatorPlanResultLink,
): void {
  if (links.size < MAX_PLAN_RESULT_LINKS && !links.has(link.href)) {
    links.set(link.href, link);
  }
}

function collectOperatorPlanResultLinks(
  commandName: OperatorCommandName,
  result: unknown,
  links: Map<string, OperatorPlanResultLink>,
): void {
  if (links.size >= MAX_PLAN_RESULT_LINKS) return;

  const addWorkflow = (workflowId: unknown): void => {
    if (typeof workflowId !== 'string' || !UUID_PATTERN.test(workflowId)) return;
    addOperatorPlanResultLink(links, {
      label: 'Open workflow',
      href: `/workflows/${workflowId}`,
    });
  };

  if (commandName === 'list_workflows' && Array.isArray(result)) {
    for (const item of result.slice(0, MAX_PLAN_RESULT_LINKS)) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        addWorkflow((item as Record<string, unknown>).id);
      }
    }
  } else if (
    commandName === 'get_workflow' &&
    result &&
    typeof result === 'object' &&
    !Array.isArray(result)
  ) {
    addWorkflow((result as Record<string, unknown>).id);
  }

  let visited = 0;
  const visit = (value: unknown, depth: number): void => {
    if (links.size >= MAX_PLAN_RESULT_LINKS || depth > 3 || visited >= 100) return;
    visited += 1;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    const workflowId =
      typeof record.workflowId === 'string' && UUID_PATTERN.test(record.workflowId)
        ? record.workflowId
        : undefined;
    if (workflowId) addWorkflow(workflowId);

    const runIdCandidate = record.runId ?? record.id;
    if (
      workflowId &&
      typeof runIdCandidate === 'string' &&
      runIdCandidate.startsWith('sentris-run-')
    ) {
      addOperatorPlanResultLink(links, {
        label: `Open run ${runIdCandidate.slice('sentris-run-'.length, 'sentris-run-'.length + 8)}`,
        href: `/workflows/${workflowId}/runs/${encodeURIComponent(runIdCandidate)}`,
      });
    }

    for (const nested of Object.values(record).slice(0, 20)) visit(nested, depth + 1);
  };
  visit(result, 0);
}

function appendOperatorPlanResultLinks(
  message: string,
  links: Iterable<OperatorPlanResultLink>,
): string {
  const missingLinks = [...links].filter((link) => !message.includes(link.href));
  if (missingLinks.length === 0) return message.slice(0, MAX_PLAN_COMPLETION_LENGTH);

  const linkLine = missingLinks.map((link) => `[${link.label}](${link.href})`).join(' · ');
  const availableMessageLength = Math.max(0, MAX_PLAN_COMPLETION_LENGTH - linkLine.length - 2);
  const boundedMessage =
    message.length > availableMessageLength
      ? `${message.slice(0, Math.max(0, availableMessageLength - 1)).trimEnd()}…`
      : message;
  return `${boundedMessage}\n\n${linkLine}`;
}

async function runOperatorPlanJourney(input: {
  base: OperatorActivityInput;
  journey: Extract<OperatorJourney, { kind: 'execute_plan' }>;
  decisions: OperatorDecisionMap;
  interpretActionStatus: boolean;
}): Promise<void> {
  const plan = await shortActivities.operatorLoadPlanActivity({
    ...input.base,
    planActionId: input.journey.planActionId,
  });
  const resultsByStepId = new Map<string, unknown>();
  const resultLinks = new Map<string, OperatorPlanResultLink>();
  for (const [index, step] of plan.steps.entries()) {
    const arguments_ = resolveOperatorPlanStepArguments(step, resultsByStepId);
    const outcome = await prepareAndExecuteOperatorAction({
      base: input.base,
      decisions: input.decisions,
      interpretActionStatus: input.interpretActionStatus,
      toolCall: {
        toolCallId: `${input.base.turnId}:plan:${plan.planId}:${step.id}`,
        commandName: step.commandName,
        arguments: arguments_,
      },
    });
    if (outcome.disposition === 'rejected') {
      const failureDetail = outcome.error?.replace(/\s+/g, ' ').trim();
      const boundedDetail = failureDetail
        ? `${failureDetail.slice(0, MAX_PLAN_FAILURE_DETAIL_LENGTH)}${failureDetail.length > MAX_PLAN_FAILURE_DETAIL_LENGTH ? '…' : ''}`
        : undefined;
      await shortActivities.operatorCompleteTurnActivity({
        ...input.base,
        message:
          outcome.reason === 'action_failed'
            ? `Plan "${plan.title}" stopped at step ${index + 1} of ${plan.steps.length} because "${step.label}" failed.${boundedDetail ? ` Error: ${boundedDetail}` : ''} Earlier completed actions remain recorded; later steps were not run.`
            : `Plan "${plan.title}" stopped at step ${index + 1} of ${plan.steps.length} because "${step.label}" was rejected. Completed actions remain recorded; later steps were not run.`,
      });
      return;
    }
    if (outcome.disposition === 'executed' && outcome.executed.mcpOperationRequest) {
      throw new Error('Operator plans cannot execute turn-scoped MCP operations');
    }
    if (outcome.disposition === 'executed') {
      resultsByStepId.set(step.id, outcome.executed.result);
      collectOperatorPlanResultLinks(step.commandName, outcome.executed.result, resultLinks);
    } else if (outcome.disposition === 'already_completed' && outcome.result !== undefined) {
      resultsByStepId.set(step.id, outcome.result);
      collectOperatorPlanResultLinks(step.commandName, outcome.result, resultLinks);
    }
  }
  let message = `Completed all ${plan.steps.length} steps in plan "${plan.title}".`;
  if (patched('operator-plan-outcome-summary-v1')) {
    try {
      const summary = await operatorModelStepActivity({
        ...input.base,
        step: plan.steps.length,
        mode: 'plan_summary',
        planTitle: plan.title,
      });
      if (summary.finishReason === 'stop' && summary.text.trim()) {
        message = summary.text.trim();
      }
    } catch (error: unknown) {
      if (isCancellation(error)) throw error;
    }
  }
  message = appendOperatorPlanResultLinks(message, resultLinks.values());
  await shortActivities.operatorCompleteTurnActivity({ ...input.base, message });
}

async function runRunFollowUpJourney(input: {
  base: OperatorActivityInput;
  journey: Extract<OperatorJourney, { kind: 'run_follow_up' }>;
  decisions: OperatorDecisionMap;
  interpretActionStatus: boolean;
  allowQuestion: boolean;
}): Promise<void> {
  const inspection = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
    userConfirmed: true,
    toolCall: {
      toolCallId: `${input.base.turnId}:journey:inspect-run`,
      commandName: 'get_run',
      arguments: { runId: input.journey.runId },
    },
  });
  if (inspection.disposition !== 'executed') {
    throw new Error('The run follow-up could not inspect its terminal run');
  }

  if (!input.allowQuestion) {
    const summary = await operatorModelStepActivity({
      ...input.base,
      step: 1,
      mode: 'run_follow_up_summary',
      sourceRunId: input.journey.runId,
    });
    await shortActivities.operatorCompleteTurnActivity({
      ...input.base,
      message:
        summary.text.trim() ||
        `Workflow run ${input.journey.runId} is terminal. Its durable inspection is recorded above.`,
    });
    return;
  }

  const review = await operatorModelStepActivity({
    ...input.base,
    step: 1,
    mode: 'run_follow_up_review',
    sourceRunId: input.journey.runId,
  });
  const question = review.toolCalls.find(
    (toolCall) => toolCall.commandName === 'request_user_input',
  );
  if (!question) {
    await shortActivities.operatorCompleteTurnActivity({
      ...input.base,
      message:
        review.text.trim() ||
        `Workflow run ${input.journey.runId} is terminal. Its durable inspection is recorded above.`,
    });
    return;
  }

  const questionOutcome = await prepareAndExecuteOperatorAction({
    base: input.base,
    toolCall: question,
    decisions: input.decisions,
    interpretActionStatus: input.interpretActionStatus,
  });
  if (questionOutcome.disposition === 'rejected') {
    await shortActivities.operatorCompleteTurnActivity({
      ...input.base,
      message:
        questionOutcome.reason === 'action_failed'
          ? 'The terminal run inspection is recorded above, but the follow-up answer could not be recorded.'
          : 'The terminal run inspection is recorded above. The follow-up question was cancelled, so no tailored recommendation was added.',
    });
    return;
  }

  const summary = await operatorModelStepActivity({
    ...input.base,
    step: 2,
    mode: 'run_follow_up_summary',
    sourceRunId: input.journey.runId,
    toolCallHistory: [question],
  });
  await shortActivities.operatorCompleteTurnActivity({
    ...input.base,
    message:
      summary.text.trim() ||
      `Workflow run ${input.journey.runId} is terminal. Its durable inspection is recorded above.`,
  });
}

export async function operatorTurnWorkflow(input: OperatorTurnWorkflowInput): Promise<void> {
  const detachedRunFollowing = patched('operator-detached-run-following-v1');
  const actionStatusOutcomes = patched('operator-action-status-outcome-v1');
  const compactStructuredCompletions = patched('operator-compact-structured-completions-v1');
  const compactControlCompletions = patched('operator-compact-control-completions-v1');
  const automaticDraftRepair = patched(AUTOMATIC_DRAFT_REPAIR_PATCH_ID);
  const runFollowUpQuestions = patched('operator-run-follow-up-question-v1');
  const decisions = new Map<string, OperatorActionDecisionUpdate>();

  // Updates can arrive before the workflow reaches its approval wait. Retain the latest
  // decision per durable action ID so early approvals are never lost.
  setHandler(operatorActionDecisionUpdate, (update) => {
    if (!update.actionId || update.expectedVersion < 0) {
      throw new Error('Invalid Operator action decision update');
    }
    decisions.set(update.actionId, update);
    return { accepted: true, actionId: update.actionId };
  });

  const base: OperatorActivityInput = {
    sessionId: input.sessionId,
    turnId: input.turnId,
    organizationId: input.organizationId,
  };
  const observations: Awaited<ReturnType<typeof operatorObserveRunActivity>>[] = [];
  const toolCallHistory: OperatorModelToolCall[] = [];
  let lastText = '';

  try {
    await shortActivities.operatorSetTurnStatusActivity({ ...base, status: 'running' });

    if (input.journey?.kind === 'improve_run' && patched('operator-improve-run-journey-v1')) {
      await runImproveRunJourney({
        base,
        journey: input.journey,
        decisions,
        interpretActionStatus: actionStatusOutcomes,
      });
      await condition(allHandlersFinished);
      return;
    }

    if (input.journey?.kind === 'execute_plan' && patched('operator-execute-plan-journey-v1')) {
      await runOperatorPlanJourney({
        base,
        journey: input.journey,
        decisions,
        interpretActionStatus: actionStatusOutcomes,
      });
      await condition(allHandlersFinished);
      return;
    }

    if (input.journey?.kind === 'run_follow_up') {
      await runRunFollowUpJourney({
        base,
        journey: input.journey,
        decisions,
        interpretActionStatus: actionStatusOutcomes,
        allowQuestion: runFollowUpQuestions,
      });
      await condition(allHandlersFinished);
      return;
    }

    for (let step = 0; step < MAX_OPERATOR_STEPS; step += 1) {
      const directToolCall = step === 0 ? input.directCommand : undefined;
      const modelStep = directToolCall
        ? {
            text: '',
            finishReason: 'tool-calls',
            toolCalls: [directToolCall],
          }
        : await operatorModelStepActivity({
            ...base,
            step,
            ...(observations.length > 0 ? { observations: observations.slice(-4) } : {}),
            ...(toolCallHistory.length > 0 ? { toolCallHistory: toolCallHistory.slice() } : {}),
          });
      if (modelStep.text.trim()) lastText = modelStep.text.trim();

      if (modelStep.toolCalls.length === 0) {
        await shortActivities.operatorCompleteTurnActivity({
          ...base,
          message: lastText || DEFAULT_COMPLETION,
        });
        await condition(allHandlersFinished);
        return;
      }
      toolCallHistory.push(...modelStep.toolCalls);

      let executedAction = false;
      let reusedCompletedAction = false;
      let structuredCompletionMessage: string | undefined;
      let controlCompletionMessage: string | undefined;
      let invalidDraftToRepair: OperatorWorkflowDraftResult | undefined;
      let validDraftProduced = false;
      for (const toolCall of modelStep.toolCalls) {
        const outcome = await prepareAndExecuteOperatorAction({
          base,
          toolCall,
          decisions,
          interpretActionStatus: actionStatusOutcomes,
          userConfirmed: Boolean(directToolCall),
        });
        if (outcome.disposition === 'already_completed') {
          reusedCompletedAction = true;
          structuredCompletionMessage ??= getStructuredActionCompletionMessage(outcome.result);
          const draft = OperatorWorkflowDraftResultSchema.safeParse(outcome.result);
          if (draft.success) {
            if (draft.data.validation.valid) validDraftProduced = true;
            else invalidDraftToRepair ??= draft.data;
          }
          controlCompletionMessage ??= getControlActionCompletionMessage({
            commandName: toolCall.commandName,
            result: outcome.result,
          });
          continue;
        }
        if (outcome.disposition === 'rejected') continue;

        const executed = outcome.executed;
        executedAction = true;
        structuredCompletionMessage ??= getStructuredActionCompletionMessage(executed.result);
        const draft = OperatorWorkflowDraftResultSchema.safeParse(executed.result);
        if (draft.success) {
          if (draft.data.validation.valid) validDraftProduced = true;
          else invalidDraftToRepair ??= draft.data;
        }
        controlCompletionMessage ??= getControlActionCompletionMessage({
          commandName: toolCall.commandName,
          result: executed.result,
          ...(executed.launchedRunId ? { launchedRunId: executed.launchedRunId } : {}),
        });
        if (executed.mcpOperationRequest) {
          const result = await executeDurableMcpOperation(
            executed.mcpOperationRequest,
            mcpOperationActivities,
          );
          await CancellationScope.nonCancellable(() =>
            shortActivities.operatorSettleMcpActionActivity({
              ...base,
              actionId: executed.actionId,
              result,
            }),
          );
        }
        if (executed.launchedRunId) {
          // New histories follow the run and its durable child agents through the product's
          // canonical run/trace streams. Only old histories retain the blocking observer.
          if (!detachedRunFollowing) {
            // Replay compatibility for histories that began before live Operator run cards.
            observations.push(
              await operatorObserveRunActivity({
                ...base,
                runId: executed.launchedRunId,
              }),
            );
          }
        }
      }

      if (automaticDraftRepair && invalidDraftToRepair && !validDraftProduced) {
        const repairCompletion = await runAutomaticWorkflowDraftRepair({
          base,
          draft: invalidDraftToRepair,
          decisions,
          interpretActionStatus: actionStatusOutcomes,
          toolCallHistory,
        });
        await shortActivities.operatorCompleteTurnActivity({
          ...base,
          message:
            repairCompletion ??
            'Workflow draft needs revision. Review the validation errors shown in the card.',
        });
        await condition(allHandlersFinished);
        return;
      }

      const compactCompletionMessage =
        (compactStructuredCompletions ? structuredCompletionMessage : undefined) ??
        (compactControlCompletions ? controlCompletionMessage : undefined);
      if (compactCompletionMessage) {
        await shortActivities.operatorCompleteTurnActivity({
          ...base,
          message: compactCompletionMessage,
        });
        await condition(allHandlersFinished);
        return;
      }

      if (reusedCompletedAction && !executedAction) {
        const latestObservation = observations.at(-1);
        await shortActivities.operatorCompleteTurnActivity({
          ...base,
          message:
            lastText ||
            (latestObservation
              ? `Workflow run ${latestObservation.runId} completed with status ${latestObservation.status}. Its durable result is available above.`
              : 'The requested action was already completed in this turn. Its durable result is available above.'),
        });
        await condition(allHandlersFinished);
        return;
      }
    }

    await shortActivities.operatorCompleteTurnActivity({
      ...base,
      message:
        lastText || 'The Operator reached its step limit after executing the requested actions.',
    });
    await condition(allHandlersFinished);
  } catch (error: unknown) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await shortActivities.operatorCancelTurnActivity({
          ...base,
          message:
            'Operator turn stopped. Completed actions remain recorded, and any launched workflow continues independently.',
        });
      } else {
        await shortActivities.operatorFailTurnActivity({
          ...base,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await condition(allHandlersFinished);
    });
    throw error;
  }
}
