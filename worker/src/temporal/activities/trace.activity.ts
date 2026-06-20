import type { ITraceService, TraceEvent } from '@sentris/component-sdk';
import { workflowDiagnosticLog } from '../workflow-diagnostics';

// Trace service instance will be injected at runtime
let trace: ITraceService | undefined;

/**
 * Initialize the trace activity with trace service
 */
export function initializeTraceActivity(options: { trace: ITraceService }) {
  trace = options.trace;
}

/**
 * Activity to record a generic trace event
 */
export async function recordTraceEventActivity(event: TraceEvent): Promise<void> {
  if (!trace) {
    console.warn('[TraceActivity] Trace service not initialized, skipping event', event.type);
    return;
  }

  trace.record(event);
  workflowDiagnosticLog(`[TraceActivity] Recorded event ${event.type} for ${event.nodeRef}`);
}
