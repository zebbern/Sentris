/**
 * Human-input handler — extracted from the main workflow orchestrator.
 *
 * Handles pending human-input gates (approval, form, selection, review, acknowledge):
 * creates the request in the database, waits for a signal or timeout, processes
 * the resolution, and returns the activated ports.
 *
 * SANDBOX-SAFE: Only imports from `@temporalio/workflow`.
 * All activities and state maps are received via dependency injection.
 */
import { ApplicationFailure, condition } from '@temporalio/workflow';
import type { HumanInputResolution } from '../signals.js';
import { workflowDiagnosticLog } from '../workflow-diagnostics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HumanInputActivities {
  createHumanInputRequestActivity: (input: {
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
  }) => Promise<{
    requestId: string;
    resolveToken: string;
    resolveUrl: string;
  }>;
  expireHumanInputRequestActivity: (requestId: string) => Promise<void>;
  recordTraceEventActivity: (event: Record<string, unknown>) => Promise<void>;
}

/** Shape of the component output when a human-input gate is pending. */
export interface PendingHumanInputOutput {
  pending: true;
  inputType?: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge';
  title: string;
  description?: string;
  contextData?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  options?: unknown[];
  multiple?: boolean;
  schema?: Record<string, unknown>;
  timeoutAt?: string;
}

export interface HumanInputHandlerParams {
  runId: string;
  workflowId: string;
  organizationId?: string | null;
  actionRef: string;
  mergedParams: Record<string, unknown>;
  pendingData: PendingHumanInputOutput;
  results: Map<string, unknown>;
  humanInputResolutions: Map<string, HumanInputResolution>;
  activities: HumanInputActivities;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Creates a human-input request, waits for a resolution signal (or timeout),
 * stores the result, and returns the activated ports for the scheduler.
 */
export async function handleHumanInput(
  params: HumanInputHandlerParams,
): Promise<{ activePorts: string[] }> {
  const {
    runId,
    workflowId,
    organizationId,
    actionRef,
    mergedParams,
    pendingData,
    results,
    humanInputResolutions,
    activities: {
      createHumanInputRequestActivity,
      expireHumanInputRequestActivity,
      recordTraceEventActivity,
    },
  } = params;

  const requestContext =
    pendingData.contextData ?? (mergedParams.data ? { data: mergedParams.data } : undefined);

  // Create the human input request in the database
  const approvalResult = await createHumanInputRequestActivity({
    runId,
    workflowId,
    nodeRef: actionRef,
    inputType: pendingData.inputType ?? 'approval',
    title: pendingData.title,
    description: pendingData.description,
    context: requestContext,
    inputSchema:
      pendingData.inputSchema ??
      (pendingData.options
        ? { options: pendingData.options, multiple: pendingData.multiple }
        : undefined) ??
      (pendingData.schema ? { schema: pendingData.schema } : undefined),
    timeoutMs: pendingData.timeoutAt
      ? new Date(pendingData.timeoutAt).getTime() - Date.now()
      : undefined,
    organizationId: organizationId ?? null,
  });

  workflowDiagnosticLog(
    `[Workflow] Created human input request ${approvalResult.requestId} for ${actionRef}`,
  );

  // Check if we already have a resolution (signal arrived before we started waiting)
  let resolution = humanInputResolutions.get(actionRef);

  if (!resolution) {
    workflowDiagnosticLog(`[Workflow] Waiting for human input signal for ${actionRef}...`);

    // Calculate timeout duration
    const timeoutMs = pendingData.timeoutAt
      ? Math.max(0, new Date(pendingData.timeoutAt).getTime() - Date.now())
      : undefined;

    // Wait for signal or timeout
    let signalReceived: boolean;
    if (timeoutMs !== undefined) {
      signalReceived = await condition(() => humanInputResolutions.has(actionRef), timeoutMs);
    } else {
      // No timeout — wait indefinitely
      await condition(() => humanInputResolutions.has(actionRef));
      signalReceived = true;
    }

    if (!signalReceived) {
      workflowDiagnosticLog(`[Workflow] Human input timeout for ${actionRef}`);
      await expireHumanInputRequestActivity(approvalResult.requestId);
      throw ApplicationFailure.nonRetryable(
        `Human input request timed out for node ${actionRef}`,
        'TimeoutError',
        [{ nodeRef: actionRef, requestId: approvalResult.requestId, timeoutMs }],
      );
    }

    resolution = humanInputResolutions.get(actionRef)!;
  }

  workflowDiagnosticLog(
    `[Workflow] Human input resolved for ${actionRef}: approved=${resolution.approved}`,
  );

  // Store the final result (merging responseData for dynamic ports)
  results.set(actionRef, {
    approved: resolution.approved,
    rejected: !resolution.approved,
    respondedBy: resolution.respondedBy,
    responseNote: resolution.responseNote,
    respondedAt: resolution.respondedAt,
    requestId: approvalResult.requestId,
    ...(typeof resolution.responseData === 'object' ? resolution.responseData : {}),
  });

  // Determine active ports based on resolution
  const activePorts: string[] = ['respondedBy', 'responseNote', 'respondedAt', 'requestId'];

  const inputType = (pendingData.inputType ?? 'approval') as string;

  if (inputType === 'approval' || inputType === 'review') {
    activePorts.push(resolution.approved ? 'approved' : 'rejected');
  } else if (inputType === 'selection') {
    const selection = (resolution.responseData as Record<string, unknown>)?.selection;
    if (selection !== undefined && selection !== null) {
      activePorts.push('selection');
      if (Array.isArray(selection)) {
        selection.forEach((val: string) => activePorts.push(`option:${val}`));
      } else if (typeof selection === 'string') {
        activePorts.push(`option:${selection}`);
      }
    }

    activePorts.push(resolution.approved ? 'approved' : 'rejected');
  } else {
    // form / acknowledge fallback
    activePorts.push(resolution.approved ? 'approved' : 'rejected');
  }

  // Record node completion
  await recordTraceEventActivity({
    type: 'NODE_COMPLETED',
    runId,
    nodeRef: actionRef,
    timestamp: new Date().toISOString(),
    outputSummary: results.get(actionRef),
    data: { activatedPorts: activePorts },
    level: 'info',
    context: { activityId: 'workflow-orchestration' },
  });

  return { activePorts };
}
