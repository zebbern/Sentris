import { ApplicationFailure, CancellationScope, isCancellation } from '@temporalio/workflow';

import type {
  McpOperationInvocationRequest,
  McpOperationResult,
} from '@sentris/shared/mcp-invocation';
import {
  executeMcpOperation,
  type McpOperationActivities,
  type McpOperationExecutionRuntime,
} from '../mcp-operation-executor.js';

export type { McpOperationExecutionRuntime } from '../mcp-operation-executor.js';

export type McpOperationWorkflowActivities = McpOperationActivities;

const temporalRuntime: McpOperationExecutionRuntime = {
  now: Date.now,
  withTimeout: (timeout, callback) => CancellationScope.withTimeout(timeout, callback),
  nonCancellable: (callback) => CancellationScope.nonCancellable(callback),
  isCancellation,
  failure: (message, type) => ApplicationFailure.nonRetryable(message, type),
};

export function executeDurableMcpOperation(
  request: McpOperationInvocationRequest,
  activities: McpOperationWorkflowActivities,
  runtime: McpOperationExecutionRuntime = temporalRuntime,
): Promise<McpOperationResult> {
  return executeMcpOperation(request, activities, runtime);
}
