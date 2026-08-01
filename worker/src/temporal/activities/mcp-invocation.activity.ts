import { Context } from '@temporalio/activity';
import { createHash } from 'node:crypto';
import {
  ClaimMcpOperationDispatchOutcomeSchema,
  ClaimComponentDispatchOutcomeSchema,
  McpOperationDispatchPlanSchema,
  McpOperationInvocationRequestSchema,
  McpOperationResultSchema,
  PrepareMcpOperationOutcomeSchema,
  PrepareToolInvocationOutcomeSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  type JsonValue,
  type McpOperationDispatchPlan,
  type McpOperationInvocationRequest,
  type McpOperationResult,
  type McpRuntimeAcquisition,
  type PreparedInvocationRef,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@sentris/shared';
import { z, type ZodType } from 'zod';

import { buildBackendApiUrl } from '../../common/backend-url';
import type { RunComponentActivityInput } from '../types';
import { runComponentActivity } from './run-component.activity';
import { InputRequiredUnsupportedError } from '../../mcp-runtime/mcp-client-adapter';
import type { McpRuntimeOperation, McpRuntimeRouter } from '../../mcp-runtime/mcp-runtime-router';

export type PrepareToolInvocationActivityOutcome =
  | { kind: 'prepared'; ref: PreparedInvocationRef }
  | { kind: 'terminal'; result: ToolInvocationResult };

export interface ReconcileToolInvocationActivityInput {
  ref: PreparedInvocationRef;
  cause: 'failure' | 'deadline' | 'cancelled';
  message: string;
  completedAt: string;
}

export interface ReconcileRunToolInvocationsActivityInput {
  runId: string;
  message: string;
  completedAt: string;
}

const reconcileRunResponseSchema = z.object({ success: z.literal(true) }).strict();
const MCP_OPERATION_RELEASE_TIMEOUT_MS = 5_000;
let mcpRuntimeRouter: McpRuntimeRouter | undefined;

export function initializeMcpInvocationActivities(router: McpRuntimeRouter): void {
  mcpRuntimeRouter = router;
}

async function callInternalInvocationApi<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new Error('Internal MCP invocation authentication is not configured');
  }

  const context = Context.current();
  context.heartbeat(`mcp-invocation:${path}:request`);
  const apiPath = path.startsWith('operations/')
    ? `internal/mcp/${path}`
    : `internal/mcp/invocations/${path}`;
  const response = await fetch(buildBackendApiUrl(apiPath), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
    signal: signal ?? context.cancellationSignal,
  });
  context.heartbeat(`mcp-invocation:${path}:response`);

  if (!response.ok) {
    throw new Error(`Internal MCP invocation ${path} failed with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Internal MCP invocation ${path} returned invalid JSON`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Internal MCP invocation ${path} returned an invalid response`);
  }
  return parsed.data;
}

export type PrepareMcpOperationActivityOutcome =
  | { kind: 'prepared'; plan: McpOperationDispatchPlan }
  | { kind: 'terminal'; result: McpOperationResult };

export async function prepareMcpOperationActivity(
  input: McpOperationInvocationRequest,
): Promise<PrepareMcpOperationActivityOutcome> {
  const request = McpOperationInvocationRequestSchema.parse(input);
  const outcome = await callInternalInvocationApi(
    'operations/prepare',
    { request },
    PrepareMcpOperationOutcomeSchema,
  );
  return outcome.kind === 'terminal'
    ? { kind: 'terminal', result: outcome.result }
    : { kind: 'prepared', plan: outcome.plan };
}

export async function dispatchMcpOperationActivity(
  input: McpOperationDispatchPlan,
): Promise<McpOperationResult> {
  const plan = McpOperationDispatchPlanSchema.parse(input);
  const context = Context.current();
  if (Date.now() >= Date.parse(plan.deadlineAt)) {
    return reconcileMcpOperationActivity({
      ref: plan.ref,
      cause: 'deadline',
      message: 'MCP operation deadline expired before dispatch',
      completedAt: new Date().toISOString(),
    });
  }
  if (plan.ref.destination === 'component-activity') {
    return dispatchComponentMcpOperation(plan);
  }
  if (!mcpRuntimeRouter || !('runtimeBinding' in plan)) {
    throw new Error('MCP invocation activities are not initialized');
  }

  const holderId = mcpOperationHolderId(plan.ref.invocationId, plan.ref.attemptNumber);
  let acquisition: McpRuntimeAcquisition | undefined;
  const heartbeatTimer = setInterval(() => context.heartbeat('mcp-operation:dispatching'), 5_000);
  heartbeatTimer.unref?.();
  try {
    context.heartbeat('mcp-operation:acquire');
    acquisition = await mcpRuntimeRouter.acquire(
      plan.runtimeBinding.runtimeKey,
      holderId,
      context.cancellationSignal,
    );
    if (
      acquisition.ref.protocolEra !== plan.runtimeBinding.protocolEra ||
      acquisition.ref.protocolVersion !== plan.runtimeBinding.protocolVersion ||
      acquisition.ref.capabilityFingerprint !== plan.runtimeBinding.capabilityFingerprint
    ) {
      throw new Error('Acquired MCP runtime does not match the immutable snapshot binding');
    }
    context.heartbeat('mcp-operation:claim');
    const claim = await callInternalInvocationApi(
      'operations/claim',
      { plan, runtimeRef: acquisition.ref },
      ClaimMcpOperationDispatchOutcomeSchema,
    );
    if (claim.kind === 'terminal') return claim.result;
    if (claim.kind !== 'claimed') {
      throw new Error('Outbound MCP operation returned a component dispatch claim');
    }

    let result: McpOperationResult;
    try {
      context.heartbeat(`mcp-operation:${plan.operation.kind}`);
      const output = await mcpRuntimeRouter.execute(
        acquisition,
        routedOperation(plan),
        context.cancellationSignal,
      );
      result = completedMcpOperation(plan, output);
    } catch (error: unknown) {
      result = failedMcpOperation(plan, error, context.cancellationSignal);
    }
    context.heartbeat('mcp-operation:settle');
    const stored = await callInternalInvocationApi(
      'operations/settle',
      { ref: plan.ref, fence: acquisition.ref.fence, result },
      McpOperationResultSchema,
      AbortSignal.timeout(MCP_OPERATION_RELEASE_TIMEOUT_MS),
    );
    return stored;
  } finally {
    clearInterval(heartbeatTimer);
    if (acquisition) {
      try {
        context.heartbeat('mcp-operation:release');
        await mcpRuntimeRouter.execute(
          acquisition,
          { kind: 'release' },
          AbortSignal.timeout(MCP_OPERATION_RELEASE_TIMEOUT_MS),
        );
      } catch (releaseError: unknown) {
        console.error(
          '[MCP Operation] Fenced release failed after operation completion:',
          releaseError instanceof Error ? releaseError.name : 'UnknownError',
        );
      }
    }
  }
}

async function dispatchComponentMcpOperation(
  plan: McpOperationDispatchPlan,
): Promise<McpOperationResult> {
  const claim = await callInternalInvocationApi(
    'operations/claim',
    { plan },
    ClaimMcpOperationDispatchOutcomeSchema,
  );
  if (claim.kind === 'terminal') return claim.result;
  if (claim.kind !== 'component-dispatch') {
    throw new Error('Component MCP operation did not return dispatch context');
  }
  const { context } = claim;
  const credentials = context.component.credentials ?? {};
  let output: unknown;
  try {
    output = (
      await runComponentActivity({
        runId: context.run.runId,
        workflowId: context.run.workflowId,
        workflowVersionId: context.run.workflowVersionId,
        organizationId: context.run.organizationId,
        scopeId: context.run.scopeId,
        action: {
          ref: `mcp-operation:${context.ref.invocationId}`,
          componentId: context.component.componentId,
        },
        inputs: { ...credentials, ...context.component.arguments },
        params: context.component.parameters,
        inputOverrides: credentials,
        rawParams: context.component.parameters,
        metadata: { streamId: context.ref.invocationId },
      })
    ).output;
  } catch {
    return reconcileMcpOperationActivity({
      ref: plan.ref,
      cause: Context.current().cancellationSignal.aborted ? 'cancelled' : 'failure',
      message: 'Component operation ended after dispatch without a confirmed response',
      completedAt: new Date().toISOString(),
    });
  }
  const result = isReturnedComponentFailure(output)
    ? McpOperationResultSchema.parse({
        operationId: plan.ref.invocationId,
        kind: 'remote-failure',
        message: 'Component reported execution failure',
        retryable: false,
        completedAt: new Date().toISOString(),
      })
    : completedMcpOperation(plan, output === undefined ? null : output);
  return callInternalInvocationApi(
    'operations/settle',
    { ref: plan.ref, fence: null, result },
    McpOperationResultSchema,
    AbortSignal.timeout(MCP_OPERATION_RELEASE_TIMEOUT_MS),
  );
}

export function reconcileMcpOperationActivity(input: {
  ref: McpOperationDispatchPlan['ref'];
  cause: 'failure' | 'deadline' | 'cancelled';
  message: string;
  completedAt: string;
}): Promise<McpOperationResult> {
  return callInternalInvocationApi(
    'operations/reconcile',
    input,
    McpOperationResultSchema,
    AbortSignal.timeout(MCP_OPERATION_RELEASE_TIMEOUT_MS),
  );
}

export async function prepareToolInvocationActivity(
  input: ToolInvocationRequest,
): Promise<PrepareToolInvocationActivityOutcome> {
  const request = ToolInvocationRequestSchema.parse(input);
  const outcome = await callInternalInvocationApi(
    'prepare',
    { request },
    PrepareToolInvocationOutcomeSchema,
  );

  if (outcome.kind === 'terminal') {
    return { kind: 'terminal', result: outcome.result };
  }
  return { kind: 'prepared', ref: outcome.ref };
}

export async function dispatchToolInvocationActivity(
  input: PreparedInvocationRef,
): Promise<ToolInvocationResult> {
  const claim = await callInternalInvocationApi(
    'claim',
    { ref: input },
    ClaimComponentDispatchOutcomeSchema,
  );
  if (claim.kind === 'terminal') {
    return claim.result;
  }

  const { context } = claim;
  const credentials = context.component.credentials ?? {};
  const componentInput: RunComponentActivityInput = {
    runId: context.run.runId,
    workflowId: context.run.workflowId,
    workflowVersionId: context.run.workflowVersionId,
    organizationId: context.run.organizationId,
    scopeId: context.run.scopeId,
    action: {
      ref: `tool-invocation:${context.ref.invocationId}`,
      componentId: context.component.componentId,
    },
    inputs: {
      ...credentials,
      ...context.component.arguments,
    },
    params: context.component.parameters,
    inputOverrides: credentials,
    rawParams: context.component.parameters,
    metadata: {
      streamId: context.ref.invocationId,
    },
  };

  const activityContext = Context.current();
  activityContext.heartbeat('mcp-invocation:component:dispatch');
  let activityOutput: Awaited<ReturnType<typeof runComponentActivity>>;
  try {
    activityOutput = await runComponentActivity(componentInput);
  } catch (error: unknown) {
    if (activityContext.cancellationSignal.aborted) {
      throw activityContext.cancellationSignal.reason ?? error;
    }
    throw new Error('Component tool execution failed');
  }
  activityContext.heartbeat('mcp-invocation:component:returned');
  const result = normalizeComponentResult(context.ref, activityOutput.output);
  const settlementPath = result.status === 'completed' ? 'complete' : 'fail';

  return callInternalInvocationApi(
    settlementPath,
    { ref: context.ref, result },
    ToolInvocationResultSchema,
  );
}

export function reconcileToolInvocationActivity(
  input: ReconcileToolInvocationActivityInput,
): Promise<ToolInvocationResult> {
  return callInternalInvocationApi('reconcile', input, ToolInvocationResultSchema);
}

export async function reconcileRunToolInvocationsActivity(
  input: ReconcileRunToolInvocationsActivityInput,
): Promise<void> {
  await callInternalInvocationApi('reconcile-run', input, reconcileRunResponseSchema);
}

function normalizeComponentResult(
  ref: PreparedInvocationRef,
  output: unknown,
): ToolInvocationResult {
  const completedAt = new Date().toISOString();
  if (isReturnedComponentFailure(output)) {
    return remoteToolFailure(ref, 'Component reported execution failure', completedAt);
  }

  const candidate = {
    invocationId: ref.invocationId,
    status: 'completed' as const,
    output: output === undefined ? null : output,
    completedAt,
  };
  const parsed = ToolInvocationResultSchema.safeParse(candidate);
  if (!parsed.success) {
    return remoteToolFailure(ref, 'Component returned invalid or oversized output', completedAt);
  }
  return parsed.data;
}

function remoteToolFailure(
  ref: PreparedInvocationRef,
  message: string,
  completedAt: string,
): ToolInvocationResult {
  return ToolInvocationResultSchema.parse({
    invocationId: ref.invocationId,
    status: 'failed',
    error: {
      class: 'remote-tool',
      message,
      retryable: false,
    },
    completedAt,
  });
}

function isReturnedComponentFailure(output: unknown): output is JsonValue & { success: false } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'success' in output &&
    (output as { success?: unknown }).success === false
  );
}

function routedOperation(plan: McpOperationDispatchPlan): McpRuntimeOperation {
  const remainingMs = Math.max(1, Date.parse(plan.deadlineAt) - Date.now());
  const operationContext = {
    idleTimeoutMs: Math.min(30_000, remainingMs),
    maxTotalTimeoutMs: remainingMs,
  };
  switch (plan.operation.kind) {
    case 'tool-call':
      return {
        kind: 'invoke',
        name: plan.operation.name,
        args: plan.operation.arguments,
        context: operationContext,
      };
    case 'resource-read':
      return {
        kind: 'read',
        uri: plan.operation.uri,
        context: operationContext,
      };
    case 'prompt-get':
      return {
        kind: 'get-prompt',
        name: plan.operation.name,
        args: plan.operation.arguments,
        context: operationContext,
      };
  }
}

function completedMcpOperation(
  plan: McpOperationDispatchPlan,
  output: unknown,
): McpOperationResult {
  const completedAt = new Date().toISOString();
  const parsed = McpOperationResultSchema.safeParse({
    operationId: plan.ref.invocationId,
    kind: 'completed',
    output: output === undefined ? null : output,
    completedAt,
  });
  if (parsed.success) return parsed.data;
  return McpOperationResultSchema.parse({
    operationId: plan.ref.invocationId,
    kind: 'remote-failure',
    message: 'MCP runtime returned invalid or oversized output',
    retryable: false,
    completedAt,
  });
}

function failedMcpOperation(
  plan: McpOperationDispatchPlan,
  error: unknown,
  cancellationSignal: AbortSignal,
): McpOperationResult {
  const completedAt = new Date().toISOString();
  if (error instanceof InputRequiredUnsupportedError) {
    return McpOperationResultSchema.parse({
      operationId: plan.ref.invocationId,
      kind: 'input-required-unsupported',
      message: 'MCP input-required responses are not supported for durable run operations',
      retryable: false,
      completedAt,
    });
  }
  return McpOperationResultSchema.parse({
    operationId: plan.ref.invocationId,
    kind: 'ambiguous',
    message:
      Date.now() >= Date.parse(plan.deadlineAt)
        ? 'MCP operation deadline passed after dispatch without a confirmed response'
        : cancellationSignal.aborted
          ? 'MCP operation was cancelled after dispatch without a confirmed response'
          : 'MCP runtime operation ended without a confirmed response',
    completedAt,
  });
}

function mcpOperationHolderId(invocationId: string, attemptNumber: number): string {
  const bytes = createHash('sha256')
    .update(`mcp-operation\0${invocationId}\0${attemptNumber}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
