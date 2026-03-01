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
import { resolveSecretInputOverrides, resolveSecretParams } from './secret-resolver';
import { validateRequiredInputs } from './input-validator';
import { handleComponentError } from './error-handler';
import { RedisTerminalStreamAdapter } from '../../adapters';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { ArtifactServiceFactory } from '../artifact-factory';
import { isTraceMetadataAware } from '../utils/trace-metadata';

interface ComponentActivityServices {
  storage: IFileStorageService | undefined;
  secrets: ISecretsService | undefined;
  artifacts: ArtifactServiceFactory | undefined;
  trace: ITraceService | undefined;
  nodeIO: INodeIOService | undefined;
  logs: WorkflowLogSink | undefined;
  terminal: RedisTerminalStreamAdapter | undefined;
  agentTracePublisher: AgentTracePublisher | undefined;
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

export async function finalizeRunActivity(input: { runId: string }): Promise<void> {
  const { trace } = getComponentServices();
  if (isTraceMetadataAware(trace) && typeof trace.finalizeRun === 'function') {
    trace.finalizeRun(input.runId);
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

  const scopedArtifacts = svc.artifacts
    ? svc.artifacts({
        runId: input.runId,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId ?? null,
        componentId: action.componentId,
        componentRef: action.ref,
        organizationId: input.organizationId ?? null,
      })
    : undefined;

  const allowSecrets = component.requiresSecrets === true;

  const context = createExecutionContext({
    runId: input.runId,
    componentRef: action.ref,
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    organizationId: input.organizationId ?? null,
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
    storage: svc.storage,
    secrets: allowSecrets ? svc.secrets : undefined,
    artifacts: scopedArtifacts,
    trace: svc.trace,
    logCollector: svc.logs
      ? (entry) => {
          void svc.logs
            ?.append({
              runId: entry.runId,
              nodeRef: entry.nodeRef,
              stream: entry.stream,
              level: entry.level,
              message: entry.message,
              timestamp: new Date(entry.timestamp),
              metadata: entry.metadata,
              organizationId: input.organizationId ?? null,
            })
            .catch((error: unknown) => {
              console.error('[Logs] Failed to append log entry', error);
            });
        }
      : undefined,
    terminalCollector: svc.terminal
      ? (chunk) => {
          void svc.terminal?.append(chunk).catch((error: unknown) => {
            console.error('[Terminal] Failed to append chunk', error);
          });
        }
      : undefined,
    agentTracePublisher: svc.agentTracePublisher,
  });

  // Record node I/O start (using raw inputs/params from workflow)
  await svc.nodeIO?.recordStart({
    runId: input.runId,
    nodeRef: action.ref,
    workflowId: input.workflowId,
    organizationId: input.organizationId,
    componentId: action.componentId,
    inputs: maskSecretInputs(component, { ...inputs, ...params }) as Record<string, unknown>,
  });

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

  await unspill(resolvedParams, 'Parameter', svc.storage, spilledObjectsCache, warningsToReport);
  await unspill(resolvedInputs, 'Input', svc.storage, spilledObjectsCache, warningsToReport);
  ctx.heartbeat('inputs-resolved');

  // Resolve secret references for input overrides
  await resolveSecretInputOverrides(resolvedInputs, input.inputOverrides ?? {}, {
    secrets: svc.secrets,
    component,
    resolvedParams,
  });

  // Also resolve secret references in params (for params with editor: 'secret')
  await resolveSecretParams(resolvedParams, input.rawParams ?? {}, {
    secrets: svc.secrets,
    component,
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
    let output = await component.execute({ inputs: parsedInputs, params: parsedParams }, context);
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

          if (size > TEMPORAL_SPILL_THRESHOLD_BYTES && svc.storage) {
            const fileId = crypto.randomUUID();

            await svc.storage.uploadFile(
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
      await svc.nodeIO?.recordCompletion({
        runId: input.runId,
        nodeRef: action.ref,
        componentId: action.componentId,
        outputs: maskSecretOutputs(component, output) as Record<string, unknown>,
        status: 'completed',
      });

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
    return await handleComponentError(error, {
      actionRef: action.ref,
      componentId: action.componentId,
      activityId: activityInfo.activityId,
      attempt: activityInfo.attempt,
      runId: input.runId,
      streamId,
      joinStrategy,
      triggeredBy,
      failure,
      trace: context.trace,
      nodeIO: svc.nodeIO,
    });
  } finally {
    // Do not finalize run here; lifecycle is managed by workflow orchestration.
  }
}
