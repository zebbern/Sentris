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
  OperatorWorkflowApplyResultSchema,
  OperatorWorkflowDraftResultSchema,
  type OperatorCommandName,
  type OperatorJourney,
  type OperatorRunObservation,
} from '@sentris/shared';

import type {
  OperatorActivityInput,
  OperatorExecuteActionInput,
  OperatorExecuteActionOutput,
  OperatorModelStepInput,
  OperatorModelStepOutput,
  OperatorModelToolCall,
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
const MAX_IMPROVEMENT_PROPOSAL_STEPS = 6;
const DEFAULT_COMPLETION = 'I could not produce a useful answer for this turn.';
const APPROVAL_RECONCILE_INTERVAL = '5 seconds';

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
  | { disposition: 'rejected' }
  | { disposition: 'already_completed' };

async function prepareAndExecuteOperatorAction(input: {
  base: OperatorActivityInput;
  toolCall: OperatorModelToolCall;
  decisions: OperatorDecisionMap;
  userConfirmed?: boolean;
}): Promise<OperatorActionExecutionOutcome> {
  const prepared = await shortActivities.operatorPrepareActionActivity({
    ...input.base,
    ...input.toolCall,
    ...(input.userConfirmed ? { userConfirmed: true } : {}),
  });
  if (prepared.disposition === 'already_completed') {
    return { disposition: 'already_completed' };
  }
  if (prepared.disposition === 'rejected') return { disposition: 'rejected' };

  if (prepared.disposition === 'wait_for_approval') {
    await shortActivities.operatorSetTurnStatusActivity({
      ...input.base,
      status: 'awaiting_approval',
    });
    let approvalOutcome: 'execute' | 'rejected' | 'already_completed' | undefined;
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
      }
    }
    await shortActivities.operatorSetTurnStatusActivity({ ...input.base, status: 'running' });
    if (approvalOutcome === 'rejected') return { disposition: 'rejected' };
    if (approvalOutcome === 'already_completed') {
      return { disposition: 'already_completed' };
    }
  }

  return {
    disposition: 'executed',
    executed: await operatorExecuteActionActivity({
      ...input.base,
      actionId: prepared.actionId,
    }),
  };
}

async function runImproveRunJourney(input: {
  base: OperatorActivityInput;
  journey: Extract<OperatorJourney, { kind: 'improve_run' }>;
  decisions: OperatorDecisionMap;
}): Promise<void> {
  const sourceRunId = input.journey.sourceRunId;
  const toolCallHistory: OperatorModelToolCall[] = [];
  let lastText = '';

  const sourceInspection = await prepareAndExecuteOperatorAction({
    base: input.base,
    decisions: input.decisions,
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

export async function operatorTurnWorkflow(input: OperatorTurnWorkflowInput): Promise<void> {
  const detachedRunFollowing = patched('operator-detached-run-following-v1');
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
      await runImproveRunJourney({ base, journey: input.journey, decisions });
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
      for (const toolCall of modelStep.toolCalls) {
        const outcome = await prepareAndExecuteOperatorAction({
          base,
          toolCall,
          decisions,
          userConfirmed: Boolean(directToolCall),
        });
        if (outcome.disposition === 'already_completed') {
          reusedCompletedAction = true;
          continue;
        }
        if (outcome.disposition === 'rejected') continue;

        const executed = outcome.executed;
        executedAction = true;
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
      await shortActivities.operatorFailTurnActivity({
        ...base,
        error: isCancellation(error)
          ? 'Operator turn cancelled; any launched workflow continues independently.'
          : error instanceof Error
            ? error.message
            : String(error),
      });
      await condition(allHandlersFinished);
    });
    throw error;
  }
}
