import '../../components';
import { Context } from '@temporalio/activity';
import * as crypto from 'node:crypto';
import {
  componentRegistry,
  createExecutionContext,
  NotFoundError,
  TEMPORAL_SPILL_THRESHOLD_BYTES,
  type IFileStorageService,
  type ISecretsService,
  type ITraceService,
  type INodeIOService,
  type AgentTracePublisher,
} from '@sentris/component-sdk';

import {
  maskSecretInputs,
  maskSecretOutputs,
  createLightweightSummary,
} from '../utils/component-output';
import { unspill } from './spill-resolver';
import {
  resolveLlmProviderModelOverrides,
  resolveSecretInputOverrides,
  resolveSecretParams,
} from './secret-resolver';
import { validateRequiredInputs } from './input-validator';
import { handleComponentError } from './error-handler';
import { RedisTerminalStreamAdapter } from '../../adapters';
import type {
  FinalizeRunActivityInput,
  RunComponentActivityInput,
  RunComponentActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { ArtifactServiceFactory } from '../artifact-factory';
import { isTraceMetadataAware } from '../utils/trace-metadata';
import type { RunFinalizationCallback } from '../../common/run-finalizer';
import { recordNodeIoWithoutChangingExecution } from '../utils/node-io-delivery';
import { RequiredPublicationTracker } from '../utils/required-publication-tracker';

interface ComponentActivityServices {
  storage: IFileStorageService | undefined;
  secrets: ISecretsService | undefined;
  artifacts: ArtifactServiceFactory | undefined;
  trace: ITraceService | undefined;
  nodeIO: INodeIOService | undefined;
  logs: WorkflowLogSink | undefined;
  terminal: RedisTerminalStreamAdapter | undefined;
  agentTracePublisher: AgentTracePublisher | undefined;
  runFinalizer: ((input: RunFinalizationCallback) => Promise<void>) | undefined;
  onRequiredTelemetryFailure: ((message: string) => void) | undefined;
}

let componentServices: ComponentActivityServices | null = null;

export function initializeComponentActivityServices(options: {
  storage: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: ArtifactServiceFactory;
  trace: ITraceService;
  nodeIO?: INodeIOService;
  logs?: WorkflowLogSink;
  terminalStream?: RedisTerminalStreamAdapter;
  agentTracePublisher?: AgentTracePublisher;
  runFinalizer?: (input: RunFinalizationCallback) => Promise<void>;
  onRequiredTelemetryFailure?: (message: string) => void;
}) {
  if (componentServices !== null) {
    throw new Error('Component activity services already initialized');
  }
  componentServices = Object.freeze({
    storage: options.storage,
    secrets: options.secrets,
    artifacts: options.artifacts,
    trace: options.trace,
    nodeIO: options.nodeIO,
    logs: options.logs,
    terminal: options.terminalStream,
    agentTracePublisher: options.agentTracePublisher,
    runFinalizer: options.runFinalizer,
    onRequiredTelemetryFailure: options.onRequiredTelemetryFailure,
  });
}

function getComponentServices(): ComponentActivityServices {
  if (componentServices === null) {
    throw new Error('Component activity services not initialized');
  }
  return componentServices;
}

/** Reset the singleton so tests can re-initialize between runs. */
export function resetComponentActivityServices(): void {
  componentServices = null;
}

export async function setRunMetadataActivity(input: {
  runId: string;
  workflowId: string;
  organizationId?: string | null;
}): Promise<void> {
  const { trace } = getComponentServices();
  if (isTraceMetadataAware(trace)) {
    trace.setRunMetadata(input.runId, {
      workflowId: input.workflowId,
      organizationId: input.organizationId ?? null,
    });
  }
}

export async function finalizeRunActivity(input: FinalizeRunActivityInput): Promise<void> {
  const { trace, runFinalizer } = getComponentServices();
  if (isTraceMetadataAware(trace) && typeof trace.finalizeRun === 'function') {
    trace.finalizeRun(input.runId);
  }
  if (runFinalizer && input.status && input.organizationId) {
    await runFinalizer({
      ...input,
      organizationId: input.organizationId,
      status: input.status,
    });
  }
}

export async function runComponentActivity(
  input: RunComponentActivityInput,
): Promise<RunComponentActivityOutput> {
  const { action, inputs, params, warnings = [] } = input;
  const ctx = Context.current();
  const activityInfo = ctx.info;
  const component = componentRegistry.get(action.componentId);
  if (!component) {
    console.error(`[Activity] Component not found: ${action.componentId}`);
    throw new NotFoundError(`Component not registered: ${action.componentId}`, {
      resourceType: 'component',
      resourceId: action.componentId,
      details: { actionRef: action.ref },
    });
  }

  const nodeMetadata = input.metadata ?? {};
  const streamId = nodeMetadata.streamId ?? nodeMetadata.groupId ?? action.ref;
  const joinStrategy = nodeMetadata.joinStrategy;
  const triggeredBy = nodeMetadata.triggeredBy;
  const failure = nodeMetadata.failure;
  const connectedToolNodeIds = nodeMetadata.connectedToolNodeIds;
  const correlationId = `${input.runId}:${action.ref}:${activityInfo.activityId}`;
  const svc = getComponentServices();
  const publications = new RequiredPublicationTracker();
  const organizationId = input.organizationId ?? null;
  const storage = svc.storage?.forOrganization(organizationId);
  const secrets = svc.secrets?.forOrganization(organizationId);
  const trace = svc.trace;
  const logs = svc.logs;
  const terminal = svc.terminal;
  const trackedTrace: ITraceService | undefined = trace
    ? {
        record(event) {
          publications.track(
            () => trace.record(event),
            (error: unknown) => {
              console.error('[Trace] Failed to publish component trace event', error);
            },
          );
        },
      }
    : undefined;

  const scopedArtifacts = svc.artifacts
    ? svc.artifacts({
        runId: input.runId,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId ?? null,
        componentId: action.componentId,
        componentRef: action.ref,
        organizationId,
      })
    : undefined;

  const allowSecrets = component.requiresSecrets === true;

  try {
    const context = createExecutionContext({
      runId: input.runId,
      componentRef: action.ref,
      workflowId: input.workflowId,
      workflowName: input.workflowName,
      organizationId,
      scopeId: input.scopeId ?? null,
      signal: ctx.cancellationSignal,
      metadata: {
        activityId: activityInfo.activityId,
        attempt: activityInfo.attempt,
        correlationId,
        streamId,
        joinStrategy,
        triggeredBy,
        failure,
        connectedToolNodeIds,
        organizationId: input.organizationId ?? undefined,
      } as any,
      storage,
      secrets: allowSecrets ? secrets : undefined,
      artifacts: scopedArtifacts,
      trace: trackedTrace,
      logCollector: logs
        ? (entry) => {
            publications.track(
              () =>
                logs.append({
                  runId: entry.runId,
                  nodeRef: entry.nodeRef,
                  stream: entry.stream,
                  level: entry.level,
                  message: entry.message,
                  timestamp: new Date(entry.timestamp),
                  metadata: entry.metadata,
                  organizationId: input.organizationId ?? null,
                }),
              (error: unknown) => {
                console.error('[Logs] Failed to append log entry', error);
              },
            );
          }
        : undefined,
      terminalCollector: terminal
        ? (chunk) => {
            publications.track(
              () => terminal.append(chunk),
              (error: unknown) => {
                console.error('[Terminal] Failed to append chunk', error);
                const detail = error instanceof Error ? error.message : String(error);
                svc.onRequiredTelemetryFailure?.(
                  `Required terminal telemetry publication failed: ${detail}`,
                );
              },
            );
          }
        : undefined,
      agentTracePublisher: svc.agentTracePublisher,
    });

    // Record node I/O start (using raw inputs/params from workflow)
    await recordNodeIoWithoutChangingExecution(() =>
      svc.nodeIO?.recordStart({
        runId: input.runId,
        nodeRef: action.ref,
        workflowId: input.workflowId,
        organizationId: input.organizationId,
        componentId: action.componentId,
        inputs: maskSecretInputs(component, { ...inputs, ...params }) as Record<string, unknown>,
      }),
    );

    context.trace?.record({
      type: 'NODE_STARTED',
      timestamp: new Date().toISOString(),
      level: 'info',
    });

    const warningsToReport = [...warnings];

    // Resolve spilled inputs and params if necessary
    const spilledObjectsCache = new Map<string, any>();
    const resolvedParams = { ...params };
    const resolvedInputs = { ...inputs };

    await unspill(
      resolvedParams,
      'Parameter',
      storage,
      spilledObjectsCache,
      warningsToReport,
      organizationId,
    );
    await unspill(
      resolvedInputs,
      'Input',
      storage,
      spilledObjectsCache,
      warningsToReport,
      organizationId,
    );
    ctx.heartbeat('inputs-resolved');

    // Resolve secret references for input overrides
    await resolveSecretInputOverrides(resolvedInputs, input.inputOverrides ?? {}, {
      secrets,
      component,
      resolvedParams,
      organizationId,
    });

    await resolveLlmProviderModelOverrides(resolvedInputs, {
      secrets,
      component,
      resolvedParams,
      organizationId,
    });

    // Also resolve secret references in params (for params with editor: 'secret')
    await resolveSecretParams(resolvedParams, input.rawParams ?? {}, {
      secrets,
      component,
      organizationId,
    });
    ctx.heartbeat('secrets-resolved');

    // Validate required inputs and log warnings
    validateRequiredInputs(warningsToReport, component, resolvedParams, context.trace, action.ref);

    // For components with dynamic ports (resolvePorts), resolve the actual input schemas
    let inputsSchema = component.inputs;
    if (typeof component.resolvePorts === 'function') {
      const resolved = component.resolvePorts(params);
      if (resolved?.inputs) {
        inputsSchema = resolved.inputs;
      }
    }

    const parsedInputs = inputsSchema.parse(resolvedInputs);
    const parsedParams = component.parameters
      ? component.parameters.parse(resolvedParams)
      : resolvedParams;
    ctx.heartbeat('validated');

    try {
      // Execute the component logic directly so that any
      // normalisation/parsing inside `execute` runs.
      // Docker/remote execution should be invoked from within
      // the component via `runComponentWithRunner`.
      //
      // Send periodic heartbeats during execution so long-running
      // Docker containers (e.g. testssl.sh, trivy) don't exceed
      // the Temporal heartbeat timeout.
      const heartbeatInterval = setInterval(() => {
        ctx.heartbeat('executing');
      }, 15_000);
      let output: Awaited<ReturnType<typeof component.execute>>;
      try {
        output = await component.execute({ inputs: parsedInputs, params: parsedParams }, context);
      } finally {
        clearInterval(heartbeatInterval);
      }
      ctx.heartbeat('execution-complete');

      // Check if component requested suspension (e.g. approval gate)
      const isSuspended =
        output &&
        typeof output === 'object' &&
        'pending' in output &&
        (output as any).pending === true;

      // Extract activeOutputPorts if component returned them (for conditional execution)
      const activeOutputPorts =
        output && typeof output === 'object' && 'activeOutputPorts' in output
          ? ((output as any).activeOutputPorts as string[])
          : undefined;

      if (!isSuspended) {
        // 1. Check for payload size and spill if necessary
        if (output) {
          try {
            const outputStr = JSON.stringify(output);
            const size = Buffer.byteLength(outputStr, 'utf8');

            if (size > TEMPORAL_SPILL_THRESHOLD_BYTES && storage) {
              const fileId = crypto.randomUUID();

              await storage.uploadFile(
                fileId,
                'output.json',
                Buffer.from(outputStr),
                'application/json',
              );

              // Replace output with standardized spilled marker
              output = {
                __spilled__: true,
                storageRef: fileId,
                originalSize: size,
              };
            }
          } catch (err: unknown) {
            console.warn('[Activity] Failed to check/spill output size', err);
            // Continue with original output - if it fails in Temporal, it fails.
          }
        }

        // Record node I/O completion
        await recordNodeIoWithoutChangingExecution(() =>
          svc.nodeIO?.recordCompletion({
            runId: input.runId,
            nodeRef: action.ref,
            organizationId,
            componentId: action.componentId,
            outputs: maskSecretOutputs(component, output) as Record<string, unknown>,
            status: 'completed',
          }),
        );

        context.trace?.record({
          type: 'NODE_COMPLETED',
          timestamp: new Date().toISOString(),
          outputSummary: createLightweightSummary(component, output),
          data: activeOutputPorts ? { activatedPorts: activeOutputPorts } : undefined,
          level: 'info',
        });
      }

      return { output, activeOutputPorts };
    } catch (error: unknown) {
      if (ctx.cancellationSignal.aborted) {
        throw ctx.cancellationSignal.reason ?? error;
      }
      return await handleComponentError(error, {
        actionRef: action.ref,
        componentId: action.componentId,
        activityId: activityInfo.activityId,
        attempt: activityInfo.attempt,
        runId: input.runId,
        organizationId,
        streamId,
        joinStrategy,
        triggeredBy,
        failure,
        trace: context.trace,
        nodeIO: svc.nodeIO,
      });
    }
  } finally {
    await publications.drain();
  }
}
