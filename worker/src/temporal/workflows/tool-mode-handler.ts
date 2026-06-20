/**
 * Tool-mode registration handler — extracted from the main workflow orchestrator.
 *
 * Handles registration of tool-mode nodes: detects MCP servers, registers
 * local MCP endpoints, prepares standard component tools, and handles cleanup.
 *
 * SANDBOX-SAFE: Only imports from `@temporalio/workflow` and sandbox-safe workflow helpers.
 * All activities are received via dependency injection.
 */
import { proxyActivities } from '@temporalio/workflow';
import { MCP_SERVER_COMPONENTS, isMcpServerComponent } from './workflow-helpers.js';
import { workflowDiagnosticLog } from '../workflow-diagnostics.js';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RegisterLocalMcpActivityInput,
  PrepareAndRegisterToolActivityInput,
  CleanupRunResourcesActivityInput,
} from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolModeActivities {
  registerLocalMcpActivity: (input: RegisterLocalMcpActivityInput) => Promise<void>;
  prepareAndRegisterToolActivity: (input: PrepareAndRegisterToolActivityInput) => Promise<void>;
  cleanupRunResourcesActivity: (input: CleanupRunResourcesActivityInput) => Promise<void>;
  recordTraceEventActivity: (event: Record<string, unknown>) => Promise<void>;
}

export interface ToolModeHandlerParams {
  runId: string;
  action: { ref: string; componentId: string };
  mergedInputs: Record<string, unknown>;
  mergedParams: Record<string, unknown>;
  activityInput: RunComponentActivityInput;
  retryOptions?: {
    maximumAttempts?: number;
    initialInterval?: number;
    maximumInterval?: number;
    backoffCoefficient?: number;
    nonRetryableErrorTypes?: string[];
  };
  results: Map<string, unknown>;
  activities: ToolModeActivities;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Registers a tool-mode node by either spinning up an MCP server container
 * or preparing a standard component tool. Sets the result in `results` and
 * returns the activated ports.
 */
export async function handleToolModeRegistration(
  params: ToolModeHandlerParams,
): Promise<{ activePorts: string[] }> {
  const {
    runId,
    action,
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
  } = params;

  workflowDiagnosticLog(`[Workflow] Node ${action.ref} is in tool mode, registering...`);

  let startedContainerId: string | undefined;

  try {
    if (isMcpServerComponent(action.componentId)) {
      // Create a proxy with component-specific retry options for MCP server start
      const { runComponentActivity: runMcp } = proxyActivities<{
        runComponentActivity(input: RunComponentActivityInput): Promise<RunComponentActivityOutput>;
      }>({
        startToCloseTimeout: '10 minutes',
        heartbeatTimeout: '30 seconds',
        retry: retryOptions,
      });

      const mcpOutput = await runMcp(activityInput);
      const output = mcpOutput.output as { endpoint?: string; containerId?: string };
      const endpoint = output.endpoint;
      const containerId = output.containerId;

      if (!endpoint) {
        throw new Error('MCP server output missing endpoint');
      }

      if (!containerId) {
        throw new Error('MCP server output missing containerId');
      }

      startedContainerId = containerId;

      const mcpMeta = MCP_SERVER_COMPONENTS[action.componentId];
      const toolName = mcpMeta.toolName(mergedParams);
      const description = mcpMeta.description;

      await registerLocalMcpActivity({
        runId,
        nodeId: action.ref,
        toolName,
        description,
        inputSchema: {},
        image: (mergedParams.image as string) || 'unknown',
        port: (mergedParams.port as number) || 8080,
        endpoint,
        containerId,
      });
    } else {
      await prepareAndRegisterToolActivity({
        runId,
        nodeId: action.ref,
        componentId: action.componentId,
        inputs: params.mergedInputs,
        params: mergedParams,
      });
    }

    workflowDiagnosticLog(`[Workflow] Node ${action.ref} registered as tool, setting results.`);
    const toolResult = { mode: 'tool', status: 'ready', tools: [] };
    results.set(action.ref, toolResult);

    await recordTraceEventActivity({
      type: 'NODE_COMPLETED',
      runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      outputSummary: toolResult,
      level: 'info',
    });

    return { activePorts: ['default', 'tools'] };
  } catch (error: unknown) {
    // Cleanup any MCP containers that were started before failure
    if (startedContainerId) {
      console.warn(
        `[Workflow] Cleaning up MCP container ${startedContainerId} after registration failure`,
      );
      try {
        await cleanupRunResourcesActivity({ runId });
      } catch (cleanupError: unknown) {
        console.error(`[Workflow] Failed to cleanup MCP container: ${cleanupError}`);
      }
    }
    throw error;
  }
}
