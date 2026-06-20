import '../../components'; // Register all components
import { executeWorkflow } from '../workflow-runner';
import type {
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { IFileStorageService, ITraceService, ISecretsService } from '@sentris/component-sdk';
import type { ArtifactServiceFactory } from '../artifact-factory';
import { isTraceMetadataAware } from '../utils/trace-metadata';
import { workflowDiagnosticLog } from '../workflow-diagnostics';

interface WorkflowActivityServices {
  storage: IFileStorageService;
  trace: ITraceService;
  logs: WorkflowLogSink | undefined;
  secrets: ISecretsService | undefined;
  artifacts: ArtifactServiceFactory | undefined;
}

let workflowServices: WorkflowActivityServices | null = null;

export function initializeActivityServices(
  storage: IFileStorageService,
  trace: ITraceService,
  logs?: WorkflowLogSink,
  secrets?: ISecretsService,
  artifacts?: ArtifactServiceFactory,
) {
  if (workflowServices !== null) {
    throw new Error('Workflow activity services already initialized');
  }
  workflowServices = Object.freeze({
    storage,
    trace,
    logs,
    secrets,
    artifacts,
  });
}

function getWorkflowServices(): WorkflowActivityServices {
  if (workflowServices === null) {
    throw new Error('Workflow activity services not initialized');
  }
  return workflowServices;
}

export async function runWorkflowActivity(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  workflowDiagnosticLog(
    `╔══════════════════════════════════════════════════════════════════════════════╗`,
  );
  workflowDiagnosticLog(`🔧 [ACTIVITY START] runWorkflowActivity called`);
  workflowDiagnosticLog(`📋 Run ID: ${input.runId}`);
  workflowDiagnosticLog(`📋 Workflow ID: ${input.workflowId}`);
  workflowDiagnosticLog(`📋 Actions count: ${input.definition.actions.length}`);
  workflowDiagnosticLog(`📋 Action refs: ${input.definition.actions.map((a) => a.ref).join(', ')}`);
  workflowDiagnosticLog(`📋 Inputs keys: ${Object.keys(input.inputs || {}).join(', ')}`);
  workflowDiagnosticLog(
    `╚══════════════════════════════════════════════════════════════════════════════╝`,
  );
  const startTime = Date.now();

  const svc = getWorkflowServices();

  try {
    if (isTraceMetadataAware(svc.trace)) {
      svc.trace.setRunMetadata(input.runId, {
        workflowId: input.workflowId,
        organizationId: input.organizationId ?? null,
      });
    }

    workflowDiagnosticLog(`⏳ [ACTIVITY] About to call executeWorkflow for ${input.runId}`);
    const result = await executeWorkflow(
      input.definition,
      {
        inputs: input.inputs,
        organizationId: input.organizationId ?? null,
      },
      {
        runId: input.runId,
        storage: svc.storage,
        secrets: svc.secrets,
        trace: svc.trace,
        logs: svc.logs,
        organizationId: input.organizationId ?? null,
        artifacts: svc.artifacts,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId ?? null,
      },
    );
    const duration = Date.now() - startTime;
    workflowDiagnosticLog(
      `✅ [ACTIVITY DONE] runWorkflow completed for run: ${input.runId} in ${duration}ms`,
    );
    workflowDiagnosticLog(`📊 [ACTIVITY] Result keys: ${Object.keys(result || {}).join(', ')}`);
    return result;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    console.error(
      `❌ [ACTIVITY FAIL] runWorkflow FAILED for run: ${input.runId} after ${duration}ms`,
    );
    console.error(
      `❌ [ACTIVITY] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`,
    );
    console.error(
      `❌ [ACTIVITY] Error message: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      `❌ [ACTIVITY] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`,
    );
    throw error;
  } finally {
    if (isTraceMetadataAware(svc.trace) && typeof svc.trace.finalizeRun === 'function') {
      workflowDiagnosticLog(`🧹 [ACTIVITY] Finalizing trace metadata for ${input.runId}`);
      svc.trace.finalizeRun(input.runId);
    }
  }
}
