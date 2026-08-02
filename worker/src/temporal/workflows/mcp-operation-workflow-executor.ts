import { ApplicationFailure, CancellationScope, isCancellation } from '@temporalio/workflow';

import {
  McpOperationInvocationRequestSchema,
  McpOperationResultSchema,
  type McpOperationDispatchPlan,
  type McpOperationInvocationRequest,
  type McpOperationResult,
  type PreparedMcpOperationRef,
} from '@sentris/shared/mcp-invocation';

export interface McpOperationWorkflowActivities {
  prepareMcpOperationActivity(
    request: McpOperationInvocationRequest,
  ): Promise<
    | { kind: 'prepared'; plan: McpOperationDispatchPlan }
    | { kind: 'terminal'; result: McpOperationResult }
  >;
  dispatchMcpOperationActivity(plan: McpOperationDispatchPlan): Promise<McpOperationResult>;
  reconcileMcpOperationActivity(input: {
    ref: PreparedMcpOperationRef;
    cause: 'failure' | 'deadline' | 'cancelled';
    message: string;
    completedAt: string;
  }): Promise<McpOperationResult>;
}

export interface McpOperationExecutionRuntime {
  now(): number;
  withTimeout<T>(timeout: number, callback: () => Promise<T>): Promise<T>;
  nonCancellable<T>(callback: () => Promise<T>): Promise<T>;
  isCancellation(error: unknown): boolean;
  failure(message: string, type: string): Error;
}

const temporalRuntime: McpOperationExecutionRuntime = {
  now: Date.now,
  withTimeout: (timeout, callback) => CancellationScope.withTimeout(timeout, callback),
  nonCancellable: (callback) => CancellationScope.nonCancellable(callback),
  isCancellation,
  failure: (message, type) => ApplicationFailure.nonRetryable(message, type),
};

export async function executeDurableMcpOperation(
  rawRequest: McpOperationInvocationRequest,
  activities: McpOperationWorkflowActivities,
  runtime: McpOperationExecutionRuntime = temporalRuntime,
): Promise<McpOperationResult> {
  const parsed = McpOperationInvocationRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    throw runtime.failure('MCP operation request validation failed', 'McpOperationValidation');
  }
  const request = parsed.data;
  const deadline = Date.parse(request.deadlineAt);
  if (deadline <= runtime.now()) {
    return McpOperationResultSchema.parse({
      operationId: request.invocationId,
      kind: 'remote-failure',
      message: 'MCP operation deadline expired before dispatch',
      retryable: false,
      completedAt: new Date(runtime.now()).toISOString(),
    });
  }

  let prepared:
    | { kind: 'prepared'; plan: McpOperationDispatchPlan }
    | { kind: 'terminal'; result: McpOperationResult };
  try {
    prepared = await activities.prepareMcpOperationActivity(request);
  } catch {
    throw runtime.failure('MCP operation preflight failed', 'McpOperationPreflightFailure');
  }
  if (prepared.kind === 'terminal') {
    return parseResult(prepared.result, 'MCP operation preflight returned invalid state', runtime);
  }

  const remainingMs = deadline - runtime.now();
  if (remainingMs <= 0) {
    return reconcile(prepared.plan.ref, 'deadline', activities, runtime);
  }
  try {
    const result = await runtime.withTimeout(remainingMs, () =>
      activities.dispatchMcpOperationActivity(prepared.plan),
    );
    return parseResult(result, 'MCP operation dispatch returned invalid state', runtime);
  } catch (error: unknown) {
    const cause =
      runtime.now() >= deadline
        ? 'deadline'
        : runtime.isCancellation(error)
          ? 'cancelled'
          : 'failure';
    return reconcile(prepared.plan.ref, cause, activities, runtime);
  }
}

async function reconcile(
  ref: PreparedMcpOperationRef,
  cause: 'failure' | 'deadline' | 'cancelled',
  activities: McpOperationWorkflowActivities,
  runtime: McpOperationExecutionRuntime,
): Promise<McpOperationResult> {
  try {
    const result = await runtime.nonCancellable(() =>
      activities.reconcileMcpOperationActivity({
        ref,
        cause,
        message: reconciliationMessage(cause),
        completedAt: new Date(runtime.now()).toISOString(),
      }),
    );
    return parseResult(result, 'MCP operation reconciliation returned invalid state', runtime);
  } catch {
    throw runtime.failure(
      'MCP operation reconciliation failed',
      'McpOperationReconciliationFailure',
    );
  }
}

function parseResult(
  result: unknown,
  message: string,
  runtime: McpOperationExecutionRuntime,
): McpOperationResult {
  const parsed = McpOperationResultSchema.safeParse(result);
  if (!parsed.success) {
    throw runtime.failure(message, 'McpOperationStateFailure');
  }
  return parsed.data;
}

function reconciliationMessage(cause: 'failure' | 'deadline' | 'cancelled'): string {
  switch (cause) {
    case 'deadline':
      return 'MCP operation dispatch exceeded its deadline without a confirmed response';
    case 'cancelled':
      return 'MCP operation dispatch was cancelled without a confirmed response';
    case 'failure':
      return 'MCP operation dispatch did not confirm a terminal result';
  }
}
