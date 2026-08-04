import {
  ActivityCancellationType,
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  executeChild,
  proxyActivities,
} from '@temporalio/workflow';

import type {
  WorkflowAgentActivities,
  WorkflowAgentFollowUpWorkflowInput,
} from '../workflow-agent-types.js';
import { durableAiAgentWorkflow } from './durable-ai-agent-workflow.js';

const { workflowAgentFollowUpSetupActivity, workflowAgentFailActivity } = proxyActivities<
  Pick<WorkflowAgentActivities, 'workflowAgentFollowUpSetupActivity' | 'workflowAgentFailActivity'>
>({
  startToCloseTimeout: '3 minutes',
  heartbeatTimeout: '30 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 3 },
});

export async function workflowAgentFollowUpWorkflow(input: WorkflowAgentFollowUpWorkflowInput) {
  const turnInput = {
    component: input.component,
    agentRunId: input.agentRunId,
    recordNodeLifecycle: false,
  } as const;
  try {
    const setup = await workflowAgentFollowUpSetupActivity({
      ...turnInput,
      sourceAgentRunId: input.sourceAgentRunId,
      sourceState: input.sourceState,
      userInput: input.userInput,
      initialStateFileId: input.initialStateFileId,
    });
    return await executeChild(durableAiAgentWorkflow, {
      workflowId: `sentris-agent-turn:${input.turnId}`,
      args: [{ ...turnInput, setup }],
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: ParentClosePolicy.TERMINATE,
      retry: { maximumAttempts: 1 },
    });
  } catch (error: unknown) {
    await workflowAgentFailActivity({
      ...turnInput,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
