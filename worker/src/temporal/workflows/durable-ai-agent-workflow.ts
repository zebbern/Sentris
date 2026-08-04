import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  ContinueAsNew,
  continueAsNew,
  isCancellation,
  log,
  patched,
  proxyActivities,
  uuid4,
  workflowInfo,
} from '@temporalio/workflow';

import type {
  WorkflowAgentActivities,
  WorkflowAgentChildInput,
  WorkflowAgentToolDispatchInput,
  WorkflowAgentToolExecutionOutput,
} from '../workflow-agent-types.js';

const TOOL_CONCURRENCY = 4;
const AGENT_CONTINUE_AS_NEW_PATCH_ID = 'sentris-agent-continue-as-new-v1';
const AGENT_STEPS_PER_TEMPORAL_RUN = 32;

const lifecycleActivities = proxyActivities<
  Pick<
    WorkflowAgentActivities,
    | 'workflowAgentCheckpointActivity'
    | 'workflowAgentFinalizeActivity'
    | 'workflowAgentFailActivity'
  >
>({
  startToCloseTimeout: '3 minutes',
  heartbeatTimeout: '30 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 3 },
});

const { workflowAgentPrepareToolActivity, workflowAgentReconcileToolActivity } = proxyActivities<
  Pick<
    WorkflowAgentActivities,
    'workflowAgentPrepareToolActivity' | 'workflowAgentReconcileToolActivity'
  >
>({
  startToCloseTimeout: '3 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    initialInterval: '2 seconds',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

const { workflowAgentDispatchToolActivity } = proxyActivities<
  Pick<WorkflowAgentActivities, 'workflowAgentDispatchToolActivity'>
>({
  startToCloseTimeout: '135 minutes',
  heartbeatTimeout: '30 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: '2 seconds',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 1,
  },
});

export async function durableAiAgentWorkflow(input: WorkflowAgentChildInput) {
  const modelActivities = proxyActivities<
    Pick<WorkflowAgentActivities, 'workflowAgentModelStepActivity'>
  >({
    // Histories recorded before modelActivityTimeout was propagated used investigate's
    // 45-minute timeout. Preserve that replay-compatible behavior for those histories.
    startToCloseTimeout: input.setup.modelActivityTimeout ?? '45 minutes',
    heartbeatTimeout: '30 seconds',
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    // Model activities publish live transcript parts before Temporal accepts their result.
    // A provider retry could therefore publish a different transcript under the same durable
    // event IDs. Keep one attempt here; users can retry the whole run through its stable inputs.
    retry: {
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
      backoffCoefficient: 2,
      maximumAttempts: 1,
    },
  });

  try {
    const setup = input.setup;
    const continueAsNewEnabled = patched(AGENT_CONTINUE_AS_NEW_PATCH_ID);
    const startStep = continueAsNewEnabled ? (input.continuation?.nextStep ?? 0) : 0;
    let state = continueAsNewEnabled ? (input.continuation?.state ?? setup.state) : setup.state;
    let completedStepsInRun = 0;

    if (!Number.isInteger(startStep) || startStep < 0 || startStep > setup.stepLimit) {
      throw ApplicationFailure.nonRetryable(
        `AI Agent continuation step ${startStep} is outside the configured step limit.`,
        'AgentContinuationInvalid',
      );
    }

    for (let step = startStep; step < setup.stepLimit; step += 1) {
      const modelStep = await modelActivities.workflowAgentModelStepActivity({
        ...input,
        state,
        outputStateFileId: uuid4(),
        step,
      });
      state = modelStep.state;
      if (modelStep.toolCalls.length === 0) {
        return lifecycleActivities.workflowAgentFinalizeActivity({
          ...input,
          state,
          toolStatus: setup.toolStatus,
          outputFileId: uuid4(),
        });
      }
      if (!setup.authority) {
        throw ApplicationFailure.nonRetryable(
          'AI Agent requested a tool without a durable capability authority.',
          'AgentCapabilityUnavailable',
        );
      }

      const requestedAtMs = Date.now();
      const requestedAt = new Date(requestedAtMs).toISOString();
      const deadlineAt = new Date(requestedAtMs + setup.toolTimeoutMs).toISOString();
      const executions: WorkflowAgentToolExecutionOutput[] = [];
      for (let offset = 0; offset < modelStep.toolCalls.length; offset += TOOL_CONCURRENCY) {
        const batch = modelStep.toolCalls.slice(offset, offset + TOOL_CONCURRENCY);
        const settledResults = await Promise.allSettled(
          batch.map(async (_toolCall, batchIndex) => {
            const toolInput = {
              ...input,
              state,
              authority: setup.authority!,
              invocationId: uuid4(),
              requestedAt,
              deadlineAt,
              planFileId: uuid4(),
              resultFileId: uuid4(),
              step,
              toolIndex: offset + batchIndex,
            };
            const prepared = await workflowAgentPrepareToolActivity(toolInput);
            if (prepared.kind === 'terminal') return prepared.result;
            const dispatchInput: WorkflowAgentToolDispatchInput = {
              ...input,
              state,
              planFileId: prepared.planFileId,
              resultFileId: prepared.resultFileId,
              step,
              toolIndex: offset + batchIndex,
            };
            try {
              const remainingMs = Math.max(1, Date.parse(deadlineAt) - Date.now());
              return await CancellationScope.withTimeout(remainingMs, () =>
                workflowAgentDispatchToolActivity(dispatchInput),
              );
            } catch (error: unknown) {
              const cause =
                Date.now() >= Date.parse(deadlineAt)
                  ? 'deadline'
                  : isCancellation(error)
                    ? 'cancelled'
                    : 'failure';
              const reconciled = await CancellationScope.nonCancellable(() =>
                workflowAgentReconcileToolActivity({ ...dispatchInput, cause }),
              );
              if (cause === 'cancelled') throw error;
              return reconciled;
            }
          }),
        );
        const failedResult =
          settledResults.find(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected' && isCancellation(result.reason),
          ) ??
          settledResults.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
        if (failedResult) throw failedResult.reason;
        executions.push(
          ...settledResults.map((result) => {
            if (result.status === 'rejected') throw result.reason;
            return result.value;
          }),
        );
      }
      state = await lifecycleActivities.workflowAgentCheckpointActivity({
        ...input,
        state,
        outputStateFileId: uuid4(),
        step,
        executions,
      });
      completedStepsInRun += 1;

      const nextStep = step + 1;
      if (continueAsNewEnabled && nextStep < setup.stepLimit) {
        const info = workflowInfo();
        const reason = info.continueAsNewSuggested
          ? 'server-suggested'
          : completedStepsInRun >= AGENT_STEPS_PER_TEMPORAL_RUN
            ? 'step-threshold'
            : undefined;
        if (reason) {
          log.info('Continuing durable AI Agent with a fresh Temporal history', {
            agentRunId: input.agentRunId,
            completedStepsInRun,
            historyLength: info.historyLength,
            historySize: info.historySize,
            nextStep,
            reason,
          });
          await continueAsNew<typeof durableAiAgentWorkflow>({
            ...input,
            continuation: { state, nextStep },
          });
        }
      }
    }

    return lifecycleActivities.workflowAgentFinalizeActivity({
      ...input,
      state,
      toolStatus: setup.toolStatus,
      outputFileId: uuid4(),
    });
  } catch (error: unknown) {
    if (error instanceof ContinueAsNew) throw error;
    const cancelled = isCancellation(error);
    await CancellationScope.nonCancellable(() =>
      lifecycleActivities.workflowAgentFailActivity({
        ...input,
        error: cancelled
          ? 'AI Agent turn cancelled.'
          : error instanceof Error
            ? error.message
            : String(error),
        ...(cancelled ? { cancelled: true } : {}),
      }),
    );
    throw error;
  }
}
