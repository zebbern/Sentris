import {
  ActivityCancellationType,
  CancellationScope,
  allHandlersFinished,
  condition,
  defineUpdate,
  isCancellation,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

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
const DEFAULT_COMPLETION = 'I could not produce a useful answer for this turn.';
const APPROVAL_RECONCILE_INTERVAL = '5 seconds';

export interface OperatorTurnWorkflowInput {
  sessionId: string;
  turnId: string;
  organizationId: string;
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

export async function operatorTurnWorkflow(input: OperatorTurnWorkflowInput): Promise<void> {
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

    for (let step = 0; step < MAX_OPERATOR_STEPS; step += 1) {
      const modelStep = await operatorModelStepActivity({
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
        const prepared = await shortActivities.operatorPrepareActionActivity({
          ...base,
          ...toolCall,
        });
        if (prepared.disposition === 'already_completed') {
          reusedCompletedAction = true;
          continue;
        }
        if (prepared.disposition === 'rejected') continue;

        if (prepared.disposition === 'wait_for_approval') {
          await shortActivities.operatorSetTurnStatusActivity({
            ...base,
            status: 'awaiting_approval',
          });
          let approvalOutcome: 'execute' | 'rejected' | 'already_completed' | undefined;
          while (!approvalOutcome) {
            const updateArrived = await condition(() => {
              const decision = decisions.get(prepared.actionId);
              return decision?.expectedVersion === prepared.actionVersion;
            }, APPROVAL_RECONCILE_INTERVAL);
            if (updateArrived) {
              const decision = decisions.get(prepared.actionId)!;
              decisions.delete(prepared.actionId);
              approvalOutcome = decision.decision === 'approved' ? 'execute' : 'rejected';
              break;
            }

            // The user decision is committed in Postgres before the Update is sent. If Update
            // delivery fails, replay the same idempotent prepare request to reconcile that
            // durable state rather than leaving the turn blocked forever.
            const reconciled = await shortActivities.operatorPrepareActionActivity({
              ...base,
              ...toolCall,
            });
            if (reconciled.actionId !== prepared.actionId) {
              throw new Error('Operator approval reconciliation returned a different action');
            }
            if (reconciled.disposition !== 'wait_for_approval') {
              approvalOutcome = reconciled.disposition;
            }
          }
          await shortActivities.operatorSetTurnStatusActivity({ ...base, status: 'running' });
          if (approvalOutcome === 'rejected') continue;
          if (approvalOutcome === 'already_completed') {
            reusedCompletedAction = true;
            continue;
          }
        }

        const executed = await operatorExecuteActionActivity({
          ...base,
          actionId: prepared.actionId,
        });
        executedAction = true;
        if (executed.mcpOperationRequest) {
          const result = await executeDurableMcpOperation(
            executed.mcpOperationRequest,
            mcpOperationActivities,
          );
          await CancellationScope.nonCancellable(() =>
            shortActivities.operatorSettleMcpActionActivity({
              ...base,
              actionId: prepared.actionId,
              result,
            }),
          );
        }
        if (executed.launchedRunId) {
          // Cancellation stops only this observer. The launched workflow run is deliberately
          // independent and is never cancelled as a side effect of cancelling an Operator turn.
          observations.push(
            await operatorObserveRunActivity({
              ...base,
              runId: executed.launchedRunId,
            }),
          );
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
