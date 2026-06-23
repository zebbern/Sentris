import {
  ApplicationFailure,
  defineQuery,
  proxyActivities,
  setHandler,
  startChild,
  sleep,
  uuid4,
} from '@temporalio/workflow';
import { runWorkflowWithScheduler } from '../workflow-scheduler.js';
import { buildActionPayload } from '../input-resolver.js';
import {
  isMcpServerComponent,
  isMcpGroupComponent,
  isApprovalPending,
  isComponentFailure,
  extractFailureMessage,
  mapRetryPolicy,
} from './workflow-helpers.js';
import { handleSubWorkflowCall } from './sub-workflow-handler.js';
import { handleForEachLoopInWorkflow } from './for-each-workflow-handler.js';
import { handleToolModeRegistration } from './tool-mode-handler.js';
import { handleHumanInput } from './human-input-handler.js';
import type { PendingHumanInputOutput } from './human-input-handler.js';
import { workflowDiagnosticLog } from '../workflow-diagnostics.js';
import {
  resolveHumanInputSignal,
  executeToolCallSignal,
  type HumanInputResolution,
  type ToolCallRequest,
  type ToolCallResult,
} from '../signals.js';
import type { ExecutionTriggerMetadata, PreparedRunPayload } from '@sentris/shared';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowAction,
  PrepareRunPayloadActivityInput,
  RegisterComponentToolActivityInput,
  CleanupRunResourcesActivityInput,
  RegisterLocalMcpActivityInput,
  PrepareAndRegisterToolActivityInput,
} from '../types';

const {
  runComponentActivity: _runComponentActivity,
  setRunMetadataActivity,
  createHumanInputRequestActivity,
  expireHumanInputRequestActivity,
  registerLocalMcpActivity,
  prepareAndRegisterToolActivity,
  areAllToolsReadyActivity,
} = proxyActivities<{
  runComponentActivity(input: RunComponentActivityInput): Promise<RunComponentActivityOutput>;
  setRunMetadataActivity(input: {
    runId: string;
    workflowId: string;
    organizationId?: string | null;
  }): Promise<void>;
  createHumanInputRequestActivity(input: {
    runId: string;
    workflowId: string;
    nodeRef: string;
    inputType: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge';
    inputSchema?: Record<string, unknown>;
    title: string;
    description?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
    organizationId?: string | null;
  }): Promise<{
    requestId: string;
    resolveToken: string;
    resolveUrl: string;
  }>;
  expireHumanInputRequestActivity(requestId: string): Promise<void>;
  registerComponentToolActivity(input: RegisterComponentToolActivityInput): Promise<void>;
  registerLocalMcpActivity(input: RegisterLocalMcpActivityInput): Promise<void>;
  prepareAndRegisterToolActivity(input: PrepareAndRegisterToolActivityInput): Promise<void>;
  areAllToolsReadyActivity(input: {
    runId: string;
    requiredNodeIds: string[];
  }): Promise<{ ready: boolean }>;
}>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
});

const { cleanupRunResourcesActivity, finalizeRunActivity } = proxyActivities<{
  cleanupRunResourcesActivity(input: CleanupRunResourcesActivityInput): Promise<void>;
  finalizeRunActivity(input: { runId: string }): Promise<void>;
}>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    backoffCoefficient: 2,
  },
});

const { prepareRunPayloadActivity } = proxyActivities<{
  prepareRunPayloadActivity(input: PrepareRunPayloadActivityInput): Promise<PreparedRunPayload>;
}>({
  startToCloseTimeout: '2 minutes',
});

const { recordTraceEventActivity } = proxyActivities<{
  recordTraceEventActivity(event: any): Promise<void>;
}>({
  startToCloseTimeout: '1 minute',
});

export async function sentrisWorkflowRun(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  const results = new Map<string, unknown>();
  const actionsByRef = new Map<string, WorkflowAction>(
    input.definition.actions.map((action) => [action.ref, action]),
  );

  // Track pending human inputs and their resolutions
  const pendingHumanInputs = new Map<
    string,
    { nodeRef: string; resolve: (res: HumanInputResolution) => void }
  >();
  const humanInputResolutions = new Map<string, HumanInputResolution>();

  // Set up signal handler for human input resolutions
  setHandler(resolveHumanInputSignal, (resolution: HumanInputResolution) => {
    workflowDiagnosticLog(
      `[Workflow] Received human input signal for ${resolution.nodeRef}: approved=${resolution.approved}`,
    );
    humanInputResolutions.set(resolution.nodeRef, resolution);
    const pending = pendingHumanInputs.get(resolution.nodeRef);
    if (pending) {
      pending.resolve(resolution);
    }
  });

  // Track pending tool calls and their results (for MCP gateway)
  const pendingToolCalls = new Map<
    string,
    { request: ToolCallRequest; resolve: (result: ToolCallResult) => void }
  >();
  const toolCallResults = new Map<string, ToolCallResult>();

  // Set up signal handler for tool call execution requests
  setHandler(executeToolCallSignal, async (request: ToolCallRequest) => {
    // Prevent duplicate execution of the same callId
    if (toolCallResults.has(request.callId)) {
      console.warn(`[Workflow] Duplicate tool call ignored: ${request.callId}`);
      return;
    }

    workflowDiagnosticLog(
      `[Workflow] Received tool call signal: callId=${request.callId}, componentId=${request.componentId}`,
    );

    // Execute the component via runComponentActivity with timeout protection
    const TOOL_CALL_TIMEOUT_MS = 300000; // 5 minutes
    try {
      const activityOutput = await Promise.race([
        _runComponentActivity({
          runId: input.runId,
          workflowId: input.workflowId,
          workflowVersionId: input.workflowVersionId,
          organizationId: input.organizationId,
          action: {
            ref: `tool-call:${request.callId}`,
            componentId: request.componentId,
          },
          // Merge credentials (pre-bound) with agent-provided arguments
          inputs: {
            ...(request.credentials ?? {}),
            ...request.arguments,
          },
          params: request.parameters ?? {},
          // Pass credentials as inputOverrides so resolveSecretInputOverrides
          // in runComponentActivity resolves secret names to actual values.
          inputOverrides: request.credentials ?? {},
          metadata: {
            streamId: request.callId,
          },
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool call timed out after ${TOOL_CALL_TIMEOUT_MS}ms`)),
            TOOL_CALL_TIMEOUT_MS,
          ),
        ),
      ]);

      const result: ToolCallResult = {
        callId: request.callId,
        success: true,
        output: (activityOutput as { output: unknown }).output,
        completedAt: new Date().toISOString(),
      };

      toolCallResults.set(request.callId, result);
      workflowDiagnosticLog(
        `[Workflow] Tool call completed: callId=${request.callId}, success=true`,
      );

      // Resolve any pending waiters
      const pending = pendingToolCalls.get(request.callId);
      if (pending) {
        pending.resolve(result);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ToolCallResult = {
        callId: request.callId,
        success: false,
        error: errorMessage,
        completedAt: new Date().toISOString(),
      };

      toolCallResults.set(request.callId, result);
      workflowDiagnosticLog(
        `[Workflow] Tool call failed: callId=${request.callId}, error=${errorMessage}`,
      );

      const pending = pendingToolCalls.get(request.callId);
      if (pending) {
        pending.resolve(result);
      }
    }
  });

  // Set up query handler for tool call results
  setHandler(
    defineQuery<ToolCallResult | null, [string]>('getToolCallResult'),
    (callId: string) => {
      return toolCallResults.get(callId) ?? null;
    },
  );

  workflowDiagnosticLog(`[Workflow] Starting sentris workflow run: ${input.runId}`);
  workflowDiagnosticLog(
    `[Workflow] Definition actions:`,
    input.definition.actions.map((a) => a.ref),
  );

  const callChain =
    Array.isArray(input.callChain) && input.callChain.length > 0
      ? input.callChain
      : [input.workflowId];
  const depth = typeof input.depth === 'number' && Number.isFinite(input.depth) ? input.depth : 0;

  await setRunMetadataActivity({
    runId: input.runId,
    workflowId: input.workflowId,
    organizationId: input.organizationId ?? null,
  });

  // Track workflow completion for cleanup decision
  let workflowCompletedSuccessfully = true;

  try {
    await runWorkflowWithScheduler(input.definition, {
      onNodeSkipped: async (actionRef) => {
        workflowDiagnosticLog(`[Workflow] Node skipped: ${actionRef}`);
        await recordTraceEventActivity({
          type: 'NODE_SKIPPED',
          runId: input.runId,
          nodeRef: actionRef,
          timestamp: new Date().toISOString(),
          level: 'info',
          context: {
            activityId: 'workflow-orchestration',
          },
        });
      },
      run: async (actionRef, schedulerContext) => {
        workflowDiagnosticLog(
          `[Workflow] Running action ${actionRef} with context:`,
          schedulerContext,
        );
        const action = actionsByRef.get(actionRef);
        if (!action) {
          throw ApplicationFailure.nonRetryable(`Action not found: ${actionRef}`, 'NotFoundError', [
            { resourceType: 'action', resourceId: actionRef },
          ]);
        }

        const { inputs, params, warnings } = buildActionPayload(action, results);
        const mergedInputs: Record<string, unknown> = { ...inputs };
        const mergedParams: Record<string, unknown> = { ...params };

        // Only apply inputs to the actual entrypoint component, not just any node matching the entrypoint ref
        const isEntrypointRef = input.definition.entrypoint.ref === action.ref;
        const isEntrypointComponent = action.componentId === 'core.workflow.entrypoint';

        if (isEntrypointRef && input.inputs) {
          if (isEntrypointComponent) {
            workflowDiagnosticLog(
              `[Workflow] Applying inputs to entrypoint component '${action.ref}' (${action.componentId})`,
            );
            mergedInputs.__runtimeData = input.inputs;
          } else {
            // Entrypoint ref points to a non-entrypoint component - this is a configuration error
            // Log warning but don't apply inputs to wrong component
            console.error(
              `[Workflow] CRITICAL: Entrypoint ref '${input.definition.entrypoint.ref}' points to component '${action.componentId}' instead of 'core.workflow.entrypoint'. ` +
                `Inputs will NOT be applied to this component. This indicates a workflow compilation error.`,
            );
          }
        } else if (input.inputs && Object.keys(input.inputs).length > 0) {
          // Log when inputs exist but are not being applied (for debugging)
          if (isEntrypointRef && !isEntrypointComponent) {
            console.warn(
              `[Workflow] Node '${action.ref}' matches entrypoint ref but is not an entrypoint component (${action.componentId}). Inputs skipped.`,
            );
          }
        }

        if (action.componentId === 'core.workflow.call') {
          return handleSubWorkflowCall({
            input,
            action,
            mergedInputs,
            mergedParams,
            warnings,
            depth,
            callChain,
            results,
            activities: { prepareRunPayloadActivity, recordTraceEventActivity },
            workflowFn: sentrisWorkflowRun,
          });
        }

        if (action.componentId === 'core.workflow.for-each') {
          const { runComponentActivity: runComponentWithRetry } = proxyActivities<{
            runComponentActivity(
              input: RunComponentActivityInput,
            ): Promise<RunComponentActivityOutput>;
          }>({
            startToCloseTimeout: '10 minutes',
            heartbeatTimeout: '30 seconds',
            retry: mapRetryPolicy(action.retryPolicy),
          });

          return handleForEachLoopInWorkflow({
            input,
            action,
            mergedInputs,
            mergedParams,
            warnings,
            results,
            activities: {
              runComponentActivity: runComponentWithRetry,
              recordTraceEventActivity,
            },
          });
        }

        const nodeMetadata = input.definition.nodes?.[action.ref];
        const streamId = nodeMetadata?.streamId ?? nodeMetadata?.groupId ?? action.ref;
        const joinStrategy = nodeMetadata?.joinStrategy ?? schedulerContext.joinStrategy;
        const { triggeredBy, failure } = schedulerContext;

        const activityInput: RunComponentActivityInput = {
          runId: input.runId,
          workflowId: input.workflowId,
          workflowName: input.definition.title,
          workflowVersionId: input.workflowVersionId ?? null,
          organizationId: input.organizationId ?? null,
          action: {
            ref: action.ref,
            componentId: action.componentId,
          },
          inputs: mergedInputs,
          params: mergedParams,
          inputOverrides: action.inputOverrides,
          rawParams: action.params,
          warnings,
          metadata: {
            streamId,
            joinStrategy,
            groupId: nodeMetadata?.groupId,
            triggeredBy,
            failure,
            connectedToolNodeIds: nodeMetadata?.connectedToolNodeIds,
          },
        };

        const retryOptions = mapRetryPolicy(action.retryPolicy);

        const isToolMode = nodeMetadata?.mode === 'tool';

        // MCP groups in tool mode should execute normally (not skip execution)
        // They will register individual servers as separate tools during execution
        const isMcpGroup = isMcpGroupComponent(action.componentId);
        const shouldSkipExecution = isToolMode && !isMcpGroup;

        if (shouldSkipExecution) {
          return handleToolModeRegistration({
            runId: input.runId,
            action: { ref: action.ref, componentId: action.componentId },
            mergedInputs,
            mergedParams,
            activityInput,
            retryOptions,
            results,
            activities: {
              registerLocalMcpActivity,
              prepareAndRegisterToolActivity,
              cleanupRunResourcesActivity,
              recordTraceEventActivity,
            },
          });
        }

        // MCP groups in tool mode: execute FIRST, then register as ready AFTER discovery completes.
        // This prevents a race condition where the agent starts before child servers are discovered.
        // The agent's areAllToolsReadyActivity check will poll until this registration happens.
        if (isToolMode && isMcpGroup) {
          workflowDiagnosticLog(
            `[Workflow] MCP Group node ${action.ref} is in tool mode, will register as ready AFTER execution completes (to avoid race with agent tool discovery)`,
          );
        }

        if (isMcpServerComponent(action.componentId)) {
          throw ApplicationFailure.nonRetryable(
            `Component ${action.componentId} is tool-mode only`,
            'ToolModeOnly',
          );
        }

        const { runComponentActivity: runComponentWithRetry } = proxyActivities<{
          runComponentActivity(
            input: RunComponentActivityInput,
          ): Promise<RunComponentActivityOutput>;
        }>({
          startToCloseTimeout: '10 minutes',
          heartbeatTimeout: '30 seconds',
          retry: retryOptions,
        });

        // Wait for connected tools to be ready if this node has tool dependencies
        if (nodeMetadata?.connectedToolNodeIds && nodeMetadata.connectedToolNodeIds.length > 0) {
          workflowDiagnosticLog(
            `[Workflow] Node ${action.ref} has tool dependencies: ${nodeMetadata.connectedToolNodeIds.join(', ')}, waiting for tools to be ready...`,
          );
          const MAX_WAIT_TIME_MS = 120000; // 2 minutes
          const POLL_INTERVAL_MS = 2000; // 2 seconds
          const startTime = Date.now();

          while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
            const readyCheck = await areAllToolsReadyActivity({
              runId: input.runId,
              requiredNodeIds: nodeMetadata.connectedToolNodeIds,
            });

            if (readyCheck.ready) {
              workflowDiagnosticLog(
                `[Workflow] All tools ready for ${action.ref}: ${nodeMetadata.connectedToolNodeIds.join(', ')}`,
              );
              break;
            }

            workflowDiagnosticLog(
              `[Workflow] Tools not ready yet for ${action.ref}, retrying in ${POLL_INTERVAL_MS}ms...`,
            );
            await sleep(POLL_INTERVAL_MS);
          }

          // Final check after waiting
          const finalReadyCheck = await areAllToolsReadyActivity({
            runId: input.runId,
            requiredNodeIds: nodeMetadata.connectedToolNodeIds,
          });

          if (!finalReadyCheck.ready) {
            console.error(
              `[Workflow] Timeout waiting for tools for ${action.ref}: ${nodeMetadata.connectedToolNodeIds.join(', ')}`,
            );
            throw ApplicationFailure.nonRetryable(
              `Tools not ready after ${MAX_WAIT_TIME_MS}ms: ${nodeMetadata.connectedToolNodeIds.join(', ')}`,
              'ToolsNotReady',
            );
          }
        }

        // Debug logging: Track component execution start
        workflowDiagnosticLog(
          `[Workflow] Executing component ${action.componentId} (node ${action.ref})${isMcpGroup ? ' [MCP Group]' : ''}${isToolMode ? ' [Tool Mode]' : ''}`,
        );

        const output = await runComponentWithRetry(activityInput);

        // MCP groups in tool mode: NOW register the parent as ready after execution completes.
        // This ensures child servers are discovered and registered before the agent starts.
        if (isToolMode && isMcpGroup) {
          workflowDiagnosticLog(
            `[Workflow] MCP Group node ${action.ref} execution complete, now registering parent as ready...`,
          );
          await prepareAndRegisterToolActivity({
            runId: input.runId,
            nodeId: action.ref,
            componentId: action.componentId,
            inputs: mergedInputs,
            params: mergedParams,
          });
          workflowDiagnosticLog(
            `[Workflow] MCP Group node ${action.ref} registered as ready (child servers already registered during execution)`,
          );
        }

        // Check if this is a pending human input request (approval gate, form, choice, etc.)
        if (isApprovalPending(output.output)) {
          workflowDiagnosticLog(
            `[Workflow] Pending human input detected at ${action.ref} (type=${(output.output as Record<string, unknown>).inputType ?? 'approval'})`,
          );

          return handleHumanInput({
            runId: input.runId,
            workflowId: input.workflowId,
            organizationId: input.organizationId,
            actionRef: action.ref,
            mergedParams,
            pendingData: output.output as PendingHumanInputOutput,
            results,
            humanInputResolutions,
            activities: {
              createHumanInputRequestActivity,
              expireHumanInputRequestActivity,
              recordTraceEventActivity,
            },
          });
        } else {
          // Normal component - just store the result
          results.set(action.ref, output.output);

          // Return any active ports returned by the component activity
          return { activePorts: output.activeOutputPorts };
        }
      },
    });

    // Check if any component returned a failure status
    const outputs = Object.fromEntries(results);
    const failedComponents: { ref: string; error: string }[] = [];

    for (const [ref, output] of results.entries()) {
      if (isComponentFailure(output)) {
        const errorMessage = extractFailureMessage(output);
        failedComponents.push({ ref, error: errorMessage });
      }
    }

    if (failedComponents.length > 0) {
      const failureDetails = failedComponents
        .map(({ ref, error }) => `[${ref}] ${error}`)
        .join('; ');
      const errorMessage = `Workflow failed: ${failureDetails}`;

      console.error(`[Workflow] ${errorMessage}`);

      throw ApplicationFailure.nonRetryable(errorMessage, 'ComponentFailure', [
        { outputs, failedComponents },
      ]);
    }

    return {
      outputs,
      success: true,
    };
  } catch (error: unknown) {
    workflowCompletedSuccessfully = false;
    const outputs = Object.fromEntries(results);
    const normalizedError =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : JSON.stringify(error));

    throw ApplicationFailure.nonRetryable(
      normalizedError.message,
      normalizedError.name ?? 'WorkflowFailure',
      [{ outputs, error: normalizedError.message }],
    );
  } finally {
    workflowDiagnosticLog(
      `[Workflow] Cleaning up MCP containers for run ${input.runId} (success=${workflowCompletedSuccessfully})`,
    );
    await cleanupRunResourcesActivity({ runId: input.runId }).catch((err: unknown) => {
      console.error(`[Workflow] Failed to cleanup MCP containers for run ${input.runId}`, err);
    });
    await finalizeRunActivity({ runId: input.runId }).catch((err: unknown) => {
      console.error(`[Workflow] Failed to finalize run ${input.runId}`, err);
    });
  }
}

export async function minimalWorkflow(): Promise<string> {
  return 'minimal workflow executed successfully';
}

export async function testMinimalWorkflow(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  return sentrisWorkflowRun(input);
}

export interface ScheduleTriggerWorkflowInput {
  workflowId: string;
  workflowVersionId?: string | null;
  workflowVersion?: number | null;
  organizationId?: string | null;
  scheduleId?: string;
  scheduleName?: string | null;
  runtimeInputs?: Record<string, unknown>;
  nodeOverrides?: Record<
    string,
    { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
  >;
  trigger?: ExecutionTriggerMetadata;
}

export async function scheduleTriggerWorkflow(
  input: ScheduleTriggerWorkflowInput,
): Promise<RunWorkflowActivityOutput> {
  const triggerMetadata =
    input.trigger ??
    ({
      type: 'schedule',
      sourceId: input.scheduleId,
      label: input.scheduleName ?? 'Scheduled run',
    } satisfies ExecutionTriggerMetadata);

  const runId = `sentris-run-${uuid4()}`;

  const prepared = await prepareRunPayloadActivity({
    workflowId: input.workflowId,
    versionId: input.workflowVersionId ?? undefined,
    version: input.workflowVersion ?? undefined,
    inputs: input.runtimeInputs ?? {},
    nodeOverrides: input.nodeOverrides ?? {},
    trigger: triggerMetadata,
    organizationId: input.organizationId ?? null,
    runId,
  });

  const child = await startChild(sentrisWorkflowRun, {
    args: [
      {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        definition: prepared.definition as RunWorkflowActivityInput['definition'],
        inputs: prepared.inputs ?? {},
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        organizationId: prepared.organizationId,
      },
    ],
    workflowId: prepared.runId,
  });

  return child.result();
}

// Export MCP discovery workflow
export { mcpDiscoveryWorkflow, mcpGroupDiscoveryWorkflow } from './mcp-discovery-workflow.js';

// Export webhook parsing workflow (Docker execution must run in worker).
export { webhookParsingWorkflow } from './webhook-parsing-workflow.js';
