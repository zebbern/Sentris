import {
  ApplicationFailure,
  CancellationScope,
  currentUpdateInfo,
  isCancellation,
  setHandler,
} from '@temporalio/workflow';
import {
  InstallToolInvocationManifestRequestSchema,
  McpOperationInvocationRequestSchema,
  McpOperationResultSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  resolveInvocationManifestEntry,
  resolveMcpOperationManifestEntry,
  type InstallToolInvocationManifestRequest,
  type InvocationManifest,
  type McpOperationDispatchPlan,
  type McpOperationInvocationRequest,
  type McpOperationResult,
  type PreparedMcpOperationRef,
  type PreparedInvocationRef,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@sentris/shared/mcp-invocation';
import { MCP_CAPABILITY_CONTRACT_VERSION } from '@sentris/shared';

import {
  executeMcpOperationUpdate,
  executeToolInvocationUpdate,
  installToolInvocationManifestUpdate,
} from '../updates.js';

export interface ToolInvocationWorkflowActivities {
  prepareToolInvocationActivity(
    request: ToolInvocationRequest,
  ): Promise<
    | { kind: 'prepared'; ref: PreparedInvocationRef }
    | { kind: 'terminal'; result: ToolInvocationResult }
  >;
  dispatchToolInvocationActivity(ref: PreparedInvocationRef): Promise<ToolInvocationResult>;
  reconcileToolInvocationActivity(input: {
    ref: PreparedInvocationRef;
    cause: 'failure' | 'deadline' | 'cancelled';
    message: string;
    completedAt: string;
  }): Promise<ToolInvocationResult>;
  reconcileRunToolInvocationsActivity(input: {
    runId: string;
    message: string;
    completedAt: string;
  }): Promise<void>;
}

export interface McpOperationWorkflowActivities {
  prepareMcpOperationActivity(
    request: McpOperationInvocationRequest,
  ): Promise<
    | { kind: 'prepared'; plan: McpOperationDispatchPlan }
    | { kind: 'terminal'; result: McpOperationResult }
  >;
  dispatchMcpOperationActivity(plan: McpOperationDispatchPlan): Promise<McpOperationResult>;
  reconcileMcpOperationActivity(input: {
    ref: PreparedMcpOperationRef;
    cause: 'failure' | 'deadline' | 'cancelled';
    message: string;
    completedAt: string;
  }): Promise<McpOperationResult>;
}

export interface ToolInvocationUpdateController {
  stopAccepting(): void;
  reconcileRun(): Promise<void>;
}

export interface ToolInvocationHandlerRuntime {
  currentUpdateId(): string | undefined;
  withTimeout<T>(timeout: number, callback: () => Promise<T>): Promise<T>;
  nonCancellable<T>(callback: () => Promise<T>): Promise<T>;
  isCancellation(error: unknown): boolean;
  applicationFailure(message: string, type: string): Error;
}

export interface ToolInvocationUpdateHandlers {
  controller: ToolInvocationUpdateController;
  install: {
    handler(raw: unknown): undefined;
    validator(raw: unknown): void;
  };
  execute: {
    handler(raw: unknown): Promise<ToolInvocationResult>;
    validator(raw: unknown): void;
  };
  operation?: {
    handler(raw: unknown): Promise<McpOperationResult>;
    validator(raw: unknown): void;
  };
}

type RunInvocationScope = Extract<InstallToolInvocationManifestRequest['scope'], { kind: 'run' }>;

const temporalRuntime: ToolInvocationHandlerRuntime = {
  currentUpdateId: () => currentUpdateInfo()?.id,
  withTimeout: (timeout, callback) => CancellationScope.withTimeout(timeout, callback),
  nonCancellable: (callback) => CancellationScope.nonCancellable(callback),
  isCancellation,
  applicationFailure: (message, type) => ApplicationFailure.nonRetryable(message, type),
};

export function createToolInvocationUpdateHandlers(
  input: {
    runId: string;
    organizationId?: string | null;
    activities: ToolInvocationWorkflowActivities;
    operationActivities?: McpOperationWorkflowActivities;
  },
  runtime: ToolInvocationHandlerRuntime = temporalRuntime,
): ToolInvocationUpdateHandlers {
  const fail = (message: string, type: string): Error => runtime.applicationFailure(message, type);
  const rejectUpdate = (message: string): never => {
    throw fail(message, 'ToolInvocationUpdateRejected');
  };
  const organizationId = input.organizationId ?? null;
  const manifests = new Map<string, InvocationManifest>();
  let accepting = true;

  function validateScope(
    scope: InstallToolInvocationManifestRequest['scope'],
  ): asserts scope is RunInvocationScope {
    if (scope.kind !== 'run') {
      throw fail(
        'Tool invocation scope must target a workflow run',
        'ToolInvocationUpdateRejected',
      );
    }
    if (scope.runId !== input.runId || scope.organizationId !== organizationId) {
      throw fail(
        'Tool invocation scope does not match this workflow run',
        'ToolInvocationUpdateRejected',
      );
    }
  }

  const parseInstall = (raw: unknown): InstallToolInvocationManifestRequest => {
    const parsed = InstallToolInvocationManifestRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw fail(
        'Invalid tool invocation manifest installation request',
        'ToolInvocationUpdateRejected',
      );
    }
    return parsed.data;
  };

  const validateInstall = (raw: unknown): void => {
    if (!accepting) rejectUpdate('Tool invocation updates are no longer accepted');
    const install = parseInstall(raw);
    validateScope(install.scope);
    if (runtime.currentUpdateId() !== `install-manifest:${install.manifest.capabilityGrantId}`) {
      rejectUpdate('Tool invocation manifest installation has an invalid Update ID');
    }

    const installed = manifests.get(install.manifest.capabilityGrantId);
    if (installed && !sameManifest(installed, install.manifest)) {
      rejectUpdate('A different tool invocation manifest is already installed for this grant');
    }
  };

  const installManifest = (raw: unknown): undefined => {
    try {
      const install = parseInstall(raw);
      validateScope(install.scope);
      const installed = manifests.get(install.manifest.capabilityGrantId);
      if (installed && !sameManifest(installed, install.manifest)) {
        throw fail(
          'Tool invocation manifest installation conflicted with existing workflow state',
          'ToolInvocationManifestConflict',
        );
      }
      if (!installed) {
        manifests.set(install.manifest.capabilityGrantId, install.manifest);
      }
      return undefined;
    } catch {
      throw fail(
        'Tool invocation manifest installation failed',
        'ToolInvocationManifestInstallationFailure',
      );
    }
  };

  const parseAndAuthorizeRequest = (raw: unknown): ToolInvocationRequest => {
    const parsed = ToolInvocationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw fail('Invalid tool invocation request', 'ToolInvocationUpdateRejected');
    }
    const request = parsed.data;
    validateScope(request.scope);
    if (runtime.currentUpdateId() !== request.invocationId) {
      rejectUpdate('Tool invocation has an invalid Update ID');
    }

    const manifest = manifests.get(request.scope.capabilityGrantId);
    if (!manifest) {
      throw fail('Tool invocation manifest is not installed', 'ToolInvocationUpdateRejected');
    }
    try {
      const entry = resolveInvocationManifestEntry(manifest, request);
      if (!input.operationActivities && entry.destination !== 'component-activity') {
        rejectUpdate('Only component tool invocation is supported');
      }
    } catch {
      rejectUpdate('Tool invocation is not authorized by the installed manifest');
    }
    return request;
  };

  const validateInvocation = (raw: unknown): void => {
    if (!accepting) rejectUpdate('Tool invocation updates are no longer accepted');
    parseAndAuthorizeRequest(raw);
  };

  const executeInvocation = async (raw: unknown): Promise<ToolInvocationResult> => {
    let request: ToolInvocationRequest;
    try {
      request = parseAndAuthorizeRequest(raw);
    } catch {
      throw fail('Tool invocation request validation failed', 'ToolInvocationValidation');
    }

    const manifest = manifests.get(request.scope.capabilityGrantId)!;
    if (input.operationActivities && manifest.version === MCP_CAPABILITY_CONTRACT_VERSION) {
      const entry = resolveInvocationManifestEntry(manifest, request);
      const result = await executeOperation({
        invocationId: request.invocationId,
        scope: request.scope,
        capabilitySnapshotId: request.capabilitySnapshotId,
        sourceId: entry.sourceId,
        authorizationTarget: request.toolName,
        operation: {
          kind: 'tool-call',
          name: request.toolName,
          arguments: request.input,
        },
        requestedAt: request.requestedAt,
        deadlineAt: request.deadlineAt,
      });
      return projectMcpOperationResult(result);
    }

    const deadline = new Date(request.deadlineAt).getTime();
    if (deadline <= Date.now()) {
      return deadlineBeforeDispatch(request.invocationId);
    }

    let prepared:
      | { kind: 'prepared'; ref: PreparedInvocationRef }
      | { kind: 'terminal'; result: ToolInvocationResult };
    try {
      prepared = await input.activities.prepareToolInvocationActivity(request);
    } catch {
      throw fail('Tool invocation preflight failed', 'ToolInvocationPreflightFailure');
    }

    if (prepared.kind === 'terminal') {
      return parseHandlerResult(
        prepared.result,
        'Tool invocation preflight returned invalid state',
        fail,
      );
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return reconcile(prepared.ref, 'deadline');
    }

    try {
      const result = await runtime.withTimeout(remainingMs, () =>
        input.activities.dispatchToolInvocationActivity(prepared.ref),
      );
      return parseHandlerResult(result, 'Tool invocation dispatch returned invalid state', fail);
    } catch (error: unknown) {
      const cause =
        Date.now() >= deadline
          ? 'deadline'
          : runtime.isCancellation(error)
            ? 'cancelled'
            : 'failure';
      return reconcile(prepared.ref, cause);
    }
  };

  const parseAndAuthorizeOperation = (raw: unknown): McpOperationInvocationRequest => {
    const parsed = McpOperationInvocationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw fail('Invalid MCP operation request', 'McpOperationUpdateRejected');
    }
    const request = parsed.data;
    validateScope(request.scope);
    if (runtime.currentUpdateId() !== request.invocationId) {
      throw fail('MCP operation has an invalid Update ID', 'McpOperationUpdateRejected');
    }
    const manifest = manifests.get(request.scope.capabilityGrantId);
    if (!manifest) {
      throw fail('MCP operation manifest is not installed', 'McpOperationUpdateRejected');
    }
    try {
      resolveMcpOperationManifestEntry(manifest, request);
      switch (request.operation.kind) {
        case 'tool-call':
        case 'prompt-get':
          if (request.operation.name !== request.authorizationTarget) {
            throw new Error('Operation name does not match its authority target');
          }
          break;
        case 'resource-read':
          // The backend preflight activity performs RFC 6570 matching against the snapshot.
          break;
      }
    } catch {
      throw fail(
        'MCP operation is not authorized by the installed manifest',
        'McpOperationUpdateRejected',
      );
    }
    return request;
  };

  const validateOperation = (raw: unknown): void => {
    if (!accepting) rejectUpdate('MCP operation updates are no longer accepted');
    parseAndAuthorizeOperation(raw);
  };

  const executeOperation = async (raw: unknown): Promise<McpOperationResult> => {
    if (!input.operationActivities) {
      throw fail('MCP operation activities are unavailable', 'McpOperationStateFailure');
    }
    let request: McpOperationInvocationRequest;
    try {
      request = parseAndAuthorizeOperation(raw);
    } catch {
      throw fail('MCP operation request validation failed', 'McpOperationValidation');
    }
    const deadline = new Date(request.deadlineAt).getTime();
    if (deadline <= Date.now()) {
      return McpOperationResultSchema.parse({
        operationId: request.invocationId,
        kind: 'remote-failure',
        message: 'MCP operation deadline expired before dispatch',
        retryable: false,
        completedAt: new Date().toISOString(),
      });
    }
    let prepared:
      | { kind: 'prepared'; plan: McpOperationDispatchPlan }
      | { kind: 'terminal'; result: McpOperationResult };
    try {
      prepared = await input.operationActivities.prepareMcpOperationActivity(request);
    } catch {
      throw fail('MCP operation preflight failed', 'McpOperationPreflightFailure');
    }
    if (prepared.kind === 'terminal') {
      return parseMcpOperationHandlerResult(
        prepared.result,
        'MCP operation preflight returned invalid state',
        fail,
      );
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return reconcileOperation(prepared.plan.ref, 'deadline');
    }
    try {
      const result = await runtime.withTimeout(remainingMs, () =>
        input.operationActivities!.dispatchMcpOperationActivity(prepared.plan),
      );
      return parseMcpOperationHandlerResult(
        result,
        'MCP operation dispatch returned invalid state',
        fail,
      );
    } catch (error: unknown) {
      const cause =
        Date.now() >= deadline
          ? 'deadline'
          : runtime.isCancellation(error)
            ? 'cancelled'
            : 'failure';
      return reconcileOperation(prepared.plan.ref, cause);
    }
  };

  const reconcileOperation = async (
    ref: PreparedMcpOperationRef,
    cause: 'failure' | 'deadline' | 'cancelled',
  ): Promise<McpOperationResult> => {
    try {
      const result = await runtime.nonCancellable(() =>
        input.operationActivities!.reconcileMcpOperationActivity({
          ref,
          cause,
          message: mcpOperationReconciliationMessage(cause),
          completedAt: new Date().toISOString(),
        }),
      );
      return parseMcpOperationHandlerResult(
        result,
        'MCP operation reconciliation returned invalid state',
        fail,
      );
    } catch {
      throw fail('MCP operation reconciliation failed', 'McpOperationReconciliationFailure');
    }
  };

  const reconcile = async (
    ref: PreparedInvocationRef,
    cause: 'failure' | 'deadline' | 'cancelled',
  ): Promise<ToolInvocationResult> => {
    try {
      const result = await runtime.nonCancellable(() =>
        input.activities.reconcileToolInvocationActivity({
          ref,
          cause,
          message: reconciliationMessage(cause),
          completedAt: new Date().toISOString(),
        }),
      );
      return parseHandlerResult(
        result,
        'Tool invocation reconciliation returned invalid state',
        fail,
      );
    } catch {
      throw fail('Tool invocation reconciliation failed', 'ToolInvocationReconciliationFailure');
    }
  };

  return {
    controller: {
      stopAccepting(): void {
        accepting = false;
      },
      async reconcileRun(): Promise<void> {
        await input.activities.reconcileRunToolInvocationsActivity({
          runId: input.runId,
          message: 'Workflow completed before all tool invocations reached terminal state',
          completedAt: new Date().toISOString(),
        });
      },
    },
    install: {
      handler: installManifest,
      validator: validateInstall,
    },
    execute: {
      handler: executeInvocation,
      validator: validateInvocation,
    },
    ...(input.operationActivities
      ? {
          operation: {
            handler: executeOperation,
            validator: validateOperation,
          },
        }
      : {}),
  };
}

export function registerToolInvocationUpdateHandlers(
  input: {
    runId: string;
    organizationId?: string | null;
    activities: ToolInvocationWorkflowActivities;
    operationActivities?: McpOperationWorkflowActivities;
  },
  registration: {
    handlerRuntime?: ToolInvocationHandlerRuntime;
    setHandler?: typeof setHandler;
  } = {},
): ToolInvocationUpdateController {
  const created = createToolInvocationUpdateHandlers(input, registration.handlerRuntime);
  const register = registration.setHandler ?? setHandler;
  register(installToolInvocationManifestUpdate, created.install.handler, {
    validator: created.install.validator,
  });
  register(executeToolInvocationUpdate, created.execute.handler, {
    validator: created.execute.validator,
  });
  if (created.operation) {
    register(executeMcpOperationUpdate, created.operation.handler, {
      validator: created.operation.validator,
    });
  }
  return created.controller;
}

function sameManifest(left: InvocationManifest, right: InvocationManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconciliationMessage(cause: 'failure' | 'deadline' | 'cancelled'): string {
  switch (cause) {
    case 'deadline':
      return 'Tool invocation dispatch exceeded its deadline';
    case 'cancelled':
      return 'Tool invocation dispatch was cancelled';
    case 'failure':
      return 'Tool invocation dispatch did not confirm a terminal result';
  }
}

function mcpOperationReconciliationMessage(cause: 'failure' | 'deadline' | 'cancelled'): string {
  switch (cause) {
    case 'deadline':
      return 'MCP operation dispatch exceeded its deadline without a confirmed response';
    case 'cancelled':
      return 'MCP operation dispatch was cancelled without a confirmed response';
    case 'failure':
      return 'MCP operation dispatch did not confirm a terminal result';
  }
}

function deadlineBeforeDispatch(invocationId: string): ToolInvocationResult {
  return ToolInvocationResultSchema.parse({
    invocationId,
    status: 'failed',
    error: {
      class: 'deadline-before-dispatch',
      message: 'Tool invocation deadline expired before dispatch',
      retryable: false,
    },
    completedAt: new Date().toISOString(),
  });
}

function parseHandlerResult(
  result: unknown,
  message: string,
  failure: (message: string, type: string) => Error,
): ToolInvocationResult {
  const parsed = ToolInvocationResultSchema.safeParse(result);
  if (!parsed.success) {
    throw failure(message, 'ToolInvocationStateFailure');
  }
  return parsed.data;
}

function parseMcpOperationHandlerResult(
  result: unknown,
  message: string,
  failure: (message: string, type: string) => Error,
): McpOperationResult {
  const parsed = McpOperationResultSchema.safeParse(result);
  if (!parsed.success) {
    throw failure(message, 'McpOperationStateFailure');
  }
  return parsed.data;
}

function projectMcpOperationResult(result: McpOperationResult): ToolInvocationResult {
  switch (result.kind) {
    case 'completed':
      return ToolInvocationResultSchema.parse({
        invocationId: result.operationId,
        status: 'completed',
        output: result.output,
        completedAt: result.completedAt,
      });
    case 'cancelled':
      return ToolInvocationResultSchema.parse({
        invocationId: result.operationId,
        status: 'cancelled',
        error: {
          class: 'cancelled',
          message: result.message,
          retryable: false,
        },
        completedAt: result.completedAt,
      });
    case 'ambiguous':
      return ToolInvocationResultSchema.parse({
        invocationId: result.operationId,
        status: 'ambiguous',
        error: {
          class: 'ambiguous-after-dispatch',
          message: result.message,
          retryable: false,
        },
        completedAt: result.completedAt,
      });
    case 'remote-failure':
    case 'input-required-unsupported':
      return ToolInvocationResultSchema.parse({
        invocationId: result.operationId,
        status: 'failed',
        error: {
          class: 'remote-tool',
          message: result.message,
          retryable: result.retryable,
        },
        completedAt: result.completedAt,
      });
  }
}
