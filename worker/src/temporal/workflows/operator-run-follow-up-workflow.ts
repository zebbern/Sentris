import { proxyActivities } from '@temporalio/workflow';

import type {
  OperatorRunFollowUpActivityInput,
  operatorCreateRunFollowUpActivity as operatorCreateRunFollowUpActivityType,
} from '../activities/operator.activity';

export type OperatorRunFollowUpWorkflowInput = OperatorRunFollowUpActivityInput;

const { operatorCreateRunFollowUpActivity } = proxyActivities<{
  operatorCreateRunFollowUpActivity: typeof operatorCreateRunFollowUpActivityType;
}>({
  startToCloseTimeout: '30 seconds',
  scheduleToCloseTimeout: '6 days',
  heartbeatTimeout: '20 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
  },
});

export async function operatorRunFollowUpWorkflow(
  input: OperatorRunFollowUpWorkflowInput,
): Promise<void> {
  await operatorCreateRunFollowUpActivity(input);
}
