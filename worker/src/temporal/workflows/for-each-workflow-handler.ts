/**
 * Temporal workflow handler for core.workflow.for-each nodes.
 */
import { ApplicationFailure } from '@temporalio/workflow';
import { buildActionPayload } from '../input-resolver.js';
import { getForEachLoopBody, runForEachLoop } from './for-each-handler.js';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
  WorkflowAction,
  WorkflowDefinition,
} from '../types';

export interface ForEachWorkflowActivities {
  runComponentActivity(input: RunComponentActivityInput): Promise<RunComponentActivityOutput>;
  recordTraceEventActivity(event: Record<string, unknown>): Promise<void>;
}

export interface ForEachWorkflowHandlerParams {
  input: RunWorkflowActivityInput;
  action: WorkflowAction;
  mergedInputs: Record<string, unknown>;
  mergedParams: Record<string, unknown>;
  warnings: Array<{ target: string; sourceRef: string; sourceHandle: string }>;
  results: Map<string, unknown>;
  activities: ForEachWorkflowActivities;
}

function bodyActionsByRef(definition: WorkflowDefinition): Map<string, WorkflowAction> {
  return new Map(definition.actions.map((entry) => [entry.ref, entry]));
}

export async function handleForEachLoopInWorkflow(
  params: ForEachWorkflowHandlerParams,
): Promise<{ activePorts?: string[] }> {
  const { input, action, mergedInputs, mergedParams, warnings, results, activities } = params;
  const loopBody = getForEachLoopBody(input.definition, action.ref);
  if (!loopBody) {
    throw ApplicationFailure.nonRetryable(
      `For Each node '${action.ref}' is missing compiled loop body metadata.`,
      'ConfigurationError',
      [{ nodeRef: action.ref }],
    );
  }

  if (warnings.length > 0) {
    const missing = warnings.map((warning) => `'${warning.target}'`).join(', ');
    throw ApplicationFailure.nonRetryable(
      `Missing required inputs for ${action.ref}: ${missing}`,
      'ValidationError',
      [{ nodeRef: action.ref, missing }],
    );
  }

  const items = Array.isArray(mergedInputs.items) ? mergedInputs.items : [];
  const maxIterations =
    typeof mergedParams.maxIterations === 'number' ? mergedParams.maxIterations : undefined;

  await activities.recordTraceEventActivity({
    type: 'NODE_PROGRESS',
    runId: input.runId,
    nodeRef: action.ref,
    timestamp: new Date().toISOString(),
    message: `Starting For Each loop over ${items.length} item(s)`,
    level: 'info',
    data: { itemCount: items.length, maxIterations: maxIterations ?? null },
    context: { activityId: 'workflow-orchestration' },
  });

  const loopResult = await runForEachLoop({
    forEachRef: action.ref,
    items,
    maxIterations,
    loopBody,
    parentResults: results,
    onNodeSkipped: async (skippedRef) => {
      await activities.recordTraceEventActivity({
        type: 'NODE_SKIPPED',
        runId: input.runId,
        nodeRef: skippedRef,
        timestamp: new Date().toISOString(),
        level: 'info',
        context: { activityId: 'workflow-orchestration', loopForEachRef: action.ref },
      });
    },
    executeAction: async (bodyActionRef, bodyDefinition, iterationResults, schedulerContext) => {
      const bodyAction = bodyActionsByRef(bodyDefinition).get(bodyActionRef);
      if (!bodyAction) {
        throw ApplicationFailure.nonRetryable(
          `Loop body action not found: ${bodyActionRef}`,
          'NotFoundError',
          [{ actionRef: bodyActionRef }],
        );
      }

      if (
        bodyAction.componentId === 'core.workflow.for-each' ||
        bodyAction.componentId === 'core.workflow.call'
      ) {
        throw ApplicationFailure.nonRetryable(
          `Nested ${bodyAction.componentId} inside a For Each loop body is not supported.`,
          'ConfigurationError',
          [{ actionRef: bodyActionRef, componentId: bodyAction.componentId }],
        );
      }

      const nodeMetadata = bodyDefinition.nodes?.[bodyAction.ref];
      const streamId = nodeMetadata?.streamId ?? nodeMetadata?.groupId ?? bodyAction.ref;
      const joinStrategy = nodeMetadata?.joinStrategy ?? schedulerContext.joinStrategy;
      const { inputs, params: bodyParams, warnings: bodyWarnings } = buildActionPayload(
        bodyAction,
        iterationResults,
      );

      if (bodyWarnings.length > 0) {
        const missing = bodyWarnings.map((warning) => `'${warning.target}'`).join(', ');
        throw ApplicationFailure.nonRetryable(
          `Missing required inputs for loop body node ${bodyAction.ref}: ${missing}`,
          'ValidationError',
          [{ nodeRef: bodyAction.ref, missing }],
        );
      }

      const output = await activities.runComponentActivity({
        runId: input.runId,
        workflowId: input.workflowId,
        workflowName: bodyDefinition.title,
        workflowVersionId: input.workflowVersionId ?? null,
        organizationId: input.organizationId ?? null,
        action: {
          ref: bodyAction.ref,
          componentId: bodyAction.componentId,
        },
        inputs,
        params: bodyParams,
        inputOverrides: bodyAction.inputOverrides,
        rawParams: bodyAction.params,
        warnings: bodyWarnings,
        metadata: {
          streamId,
          joinStrategy,
          groupId: nodeMetadata?.groupId,
          triggeredBy: schedulerContext.triggeredBy,
          connectedToolNodeIds: nodeMetadata?.connectedToolNodeIds,
        },
      });

      iterationResults.set(bodyAction.ref, output.output);
      return { activePorts: output.activeOutputPorts };
    },
  });

  results.set(action.ref, loopResult.output);

  await activities.recordTraceEventActivity({
    type: 'NODE_PROGRESS',
    runId: input.runId,
    nodeRef: action.ref,
    timestamp: new Date().toISOString(),
    message: `For Each loop completed (${loopResult.iterations} iteration(s))`,
    level: 'info',
    data: { iterations: loopResult.iterations },
    context: { activityId: 'workflow-orchestration' },
  });

  return { activePorts: ['results', 'iterations', 'done'] };
}
