import { Context } from '@temporalio/activity';
import {
  ClaimComponentDispatchOutcomeSchema,
  PrepareToolInvocationOutcomeSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  type JsonValue,
  type PreparedInvocationRef,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@sentris/shared';
import { z, type ZodType } from 'zod';

import { buildBackendApiUrl } from '../../common/backend-url';
import type { RunComponentActivityInput } from '../types';
import { runComponentActivity } from './run-component.activity';

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

async function callInternalInvocationApi<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new Error('Internal MCP invocation authentication is not configured');
  }

  const context = Context.current();
  context.heartbeat(`mcp-invocation:${path}:request`);
  const response = await fetch(buildBackendApiUrl(`internal/mcp/invocations/${path}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
    signal: context.cancellationSignal,
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
