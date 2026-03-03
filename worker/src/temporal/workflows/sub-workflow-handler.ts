/**
 * Sub-workflow call handler — extracted from the main workflow orchestrator.
 *
 * Handles execution of `core.workflow.call` nodes: validates parameters,
 * prepares the child run payload, starts a child workflow, and processes the result.
 *
 * SANDBOX-SAFE: Only imports from `@temporalio/workflow` and sandbox-safe workflow helpers.
 * All activities are received via dependency injection.
 */
import {
  ApplicationFailure,
  startChild,
  sleep,
  uuid4,
  getExternalWorkflowHandle,
} from '@temporalio/workflow';
import type {
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowAction,
  PrepareRunPayloadActivityInput,
} from '../types';
import type { InputWarning } from '../input-resolver.js';
import type { PreparedRunPayload } from '@sentris/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubWorkflowActivities {
  prepareRunPayloadActivity: (input: PrepareRunPayloadActivityInput) => Promise<PreparedRunPayload>;
  recordTraceEventActivity: (event: Record<string, unknown>) => Promise<void>;
}

export interface SubWorkflowHandlerParams {
  input: RunWorkflowActivityInput;
  action: WorkflowAction;
  mergedInputs: Record<string, unknown>;
  mergedParams: Record<string, unknown>;
  warnings: InputWarning[];
  depth: number;
  callChain: string[];
  results: Map<string, unknown>;
  activities: SubWorkflowActivities;
  /** Main workflow function reference, needed for startChild. */
  workflowFn: (input: RunWorkflowActivityInput) => Promise<RunWorkflowActivityOutput>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SUBWORKFLOW_DEPTH = 10;

const RESERVED_PARAM_IDS = new Set([
  'workflowId',
  'versionStrategy',
  'versionId',
  'timeoutSeconds',
  'childRuntimeInputs',
  'childWorkflowName',
]);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleSubWorkflowCall(
  params: SubWorkflowHandlerParams,
): Promise<{ activePorts?: string[] }> {
  const {
    input,
    action,
    mergedInputs,
    mergedParams,
    warnings,
    depth,
    callChain,
    results,
    activities: { prepareRunPayloadActivity, recordTraceEventActivity },
    workflowFn,
  } = params;

  // --- Depth guard ---
  if (depth >= MAX_SUBWORKFLOW_DEPTH) {
    throw ApplicationFailure.nonRetryable(
      `Maximum sub-workflow nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`,
      'SubWorkflowDepthError',
      [{ runId: input.runId, nodeRef: action.ref, depth }],
    );
  }

  // --- Warning / validation ---
  for (const warning of warnings) {
    await recordTraceEventActivity({
      type: 'NODE_PROGRESS',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      message: `Input '${warning.target}' mapped from ${warning.sourceRef}.${warning.sourceHandle} was undefined`,
      level: 'warn',
      data: warning,
      context: { activityId: 'workflow-orchestration' },
    });
  }

  if (warnings.length > 0) {
    const missing = warnings.map((w) => `'${w.target}'`).join(', ');
    throw ApplicationFailure.nonRetryable(
      `Missing required inputs for ${action.ref}: ${missing}`,
      'ValidationError',
      [{ runId: input.runId, nodeRef: action.ref }],
    );
  }

  // --- Validate workflowId parameter ---
  const childWorkflowId = mergedParams.workflowId;
  if (typeof childWorkflowId !== 'string' || childWorkflowId.trim().length === 0) {
    throw ApplicationFailure.nonRetryable(
      'core.workflow.call requires a workflowId parameter',
      'ValidationError',
      [{ runId: input.runId, nodeRef: action.ref }],
    );
  }

  // --- Circular call detection ---
  if (callChain.includes(childWorkflowId)) {
    throw ApplicationFailure.nonRetryable(
      `Circular sub-workflow call detected for workflow ${childWorkflowId}`,
      'SubWorkflowCycleError',
      [{ runId: input.runId, nodeRef: action.ref, callChain }],
    );
  }

  // --- Version strategy ---
  const versionStrategy = mergedParams.versionStrategy === 'specific' ? 'specific' : 'latest';
  const versionIdRaw = mergedParams.versionId;
  const versionId =
    versionStrategy === 'specific' &&
    typeof versionIdRaw === 'string' &&
    versionIdRaw.trim().length > 0
      ? versionIdRaw.trim()
      : undefined;

  if (versionStrategy === 'specific' && !versionId) {
    throw ApplicationFailure.nonRetryable(
      'versionId is required when versionStrategy is "specific"',
      'ValidationError',
      [{ runId: input.runId, nodeRef: action.ref }],
    );
  }

  // --- Timeout ---
  const timeoutSecondsRaw = mergedParams.timeoutSeconds;
  const timeoutSeconds =
    typeof timeoutSecondsRaw === 'number' &&
    Number.isFinite(timeoutSecondsRaw) &&
    timeoutSecondsRaw > 0
      ? Math.floor(timeoutSecondsRaw)
      : 300;

  // --- Build child inputs ---
  const childRuntimeInputsRaw = mergedParams.childRuntimeInputs;
  const childRuntimeInputs = Array.isArray(childRuntimeInputsRaw) ? childRuntimeInputsRaw : [];
  const childInputIds = childRuntimeInputs
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
      const id = (entry as Record<string, unknown>).id;
      return typeof id === 'string' ? id : undefined;
    })
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());

  const childInputs: Record<string, unknown> = {};
  for (const id of childInputIds) {
    if (RESERVED_PARAM_IDS.has(id)) continue;
    childInputs[id] = mergedInputs[id];
  }

  const childRunId = `sentris-run-${uuid4()}`;

  await recordTraceEventActivity({
    type: 'NODE_STARTED',
    runId: input.runId,
    nodeRef: action.ref,
    timestamp: new Date().toISOString(),
    level: 'info',
    context: { activityId: 'workflow-orchestration', childRunId },
  });

  // --- Prepare child payload ---
  let prepared: PreparedRunPayload;
  try {
    prepared = await prepareRunPayloadActivity({
      workflowId: childWorkflowId,
      versionId,
      inputs: childInputs,
      trigger: {
        type: 'api',
        sourceId: input.runId,
        label: `Sub-workflow from ${input.workflowId}:${action.ref}`,
      },
      organizationId: input.organizationId ?? null,
      runId: childRunId,
      parentRunId: input.runId,
      parentNodeRef: action.ref,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await recordTraceEventActivity({
      type: 'NODE_FAILED',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      message,
      level: 'error',
      error: { message, type: 'SubWorkflowPrepareError', details: { childRunId } },
      context: { activityId: 'workflow-orchestration', childRunId },
    });
    throw error;
  }

  // --- Start child workflow ---
  const child = await startChild(workflowFn, {
    args: [
      {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        definition: prepared.definition as RunWorkflowActivityInput['definition'],
        inputs: prepared.inputs ?? {},
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        organizationId: prepared.organizationId,
        parentRunId: input.runId,
        parentNodeRef: action.ref,
        depth: depth + 1,
        callChain: [...callChain, childWorkflowId],
      },
    ],
    workflowId: prepared.runId,
  });

  // --- Wait for result with timeout ---
  const timeoutMs = timeoutSeconds * 1000;
  let outcome: { kind: 'result'; result: RunWorkflowActivityOutput } | { kind: 'timeout' };
  try {
    outcome = await Promise.race([
      child.result().then((result) => ({ kind: 'result' as const, result })),
      sleep(timeoutMs).then(() => ({ kind: 'timeout' as const })),
    ]);
  } catch (childError: unknown) {
    const message = childError instanceof Error ? childError.message : String(childError);
    await recordTraceEventActivity({
      type: 'NODE_FAILED',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      message,
      level: 'error',
      error: { message, type: 'SubWorkflowError', details: { childRunId } },
      context: { activityId: 'workflow-orchestration', childRunId },
    });
    throw childError;
  }

  // --- Handle timeout ---
  if (outcome.kind === 'timeout') {
    const externalHandle = getExternalWorkflowHandle(child.workflowId);
    await externalHandle.cancel();

    await recordTraceEventActivity({
      type: 'NODE_FAILED',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      message: `Sub-workflow timed out after ${timeoutSeconds}s`,
      level: 'error',
      error: {
        message: `Sub-workflow timed out after ${timeoutSeconds}s`,
        type: 'TimeoutError',
        details: { timeoutSeconds, childRunId },
      },
      context: { activityId: 'workflow-orchestration', childRunId },
    });

    throw ApplicationFailure.nonRetryable(
      `Sub-workflow timed out after ${timeoutSeconds}s`,
      'TimeoutError',
      [{ runId: input.runId, nodeRef: action.ref, childRunId, timeoutSeconds }],
    );
  }

  // --- Process child result ---
  const childResult = outcome.result;
  if (!childResult.success) {
    const message = childResult.error ?? 'Sub-workflow failed';

    await recordTraceEventActivity({
      type: 'NODE_FAILED',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      message,
      level: 'error',
      error: { message, type: 'SubWorkflowFailure', details: { childRunId } },
      context: { activityId: 'workflow-orchestration', childRunId },
    });

    throw ApplicationFailure.nonRetryable(message, 'SubWorkflowFailure', [
      { runId: input.runId, nodeRef: action.ref, childRunId },
    ]);
  }

  const nodeOutput = { result: childResult.outputs, childRunId };
  results.set(action.ref, nodeOutput);

  await recordTraceEventActivity({
    type: 'NODE_COMPLETED',
    runId: input.runId,
    nodeRef: action.ref,
    timestamp: new Date().toISOString(),
    outputSummary: nodeOutput,
    level: 'info',
    context: { activityId: 'workflow-orchestration', childRunId },
  });

  return {};
}
