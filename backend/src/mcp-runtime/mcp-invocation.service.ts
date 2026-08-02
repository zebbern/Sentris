import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { fromJsonSchema, UriTemplate } from '@modelcontextprotocol/server';
import {
  componentRegistry,
  getActionInputIds,
  getExposedParameterIds,
} from '@sentris/component-sdk';
import {
  ClaimComponentDispatchOutcomeSchema,
  ClaimMcpOperationDispatchOutcomeSchema,
  ClaimMcpOperationDispatchRequestSchema,
  ComponentInvocationDispatchContextSchema,
  MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS,
  McpOperationInvocationRequestSchema,
  McpOperationComponentDispatchContextSchema,
  McpOperationManifestEntrySchema,
  mcpSnapshotRuntimeBindings,
  PreparedInvocationRefSchema,
  ReconcileMcpOperationDispatchRequestSchema,
  SettleMcpOperationAttemptRequestSchema,
  PrepareToolInvocationOutcomeSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  assertCapabilityGrantApplies,
  resolveMcpOperationManifestEntry,
  resolveInvocationManifestEntry,
  type ClaimComponentDispatchOutcome,
  type ClaimMcpOperationDispatchOutcome,
  type ClaimMcpOperationDispatchRequest,
  type ComponentInvocationDispatchContext,
  type McpToolRegistrationDescriptor,
  type McpOperation,
  type McpOperationComponentDispatchContext,
  type McpOperationInvocationRequest,
  type McpOperationManifestEntry,
  type McpSnapshotRuntimeBinding,
  type PrepareMcpOperationOutcome,
  type PreparedMcpOperationRef,
  type PreparedInvocationRef,
  type PrepareToolInvocationOutcome,
  type ToolInvocationRequest,
  type ToolInvocationResult,
  type ReconcileMcpOperationDispatchRequest,
  type SettleMcpOperationAttemptRequest,
} from '@sentris/shared';
import { isDeepStrictEqual } from 'node:util';
import { z, type ZodType } from 'zod';

import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { ToolRegistryService } from '../mcp/tool-registry.service';
import { sha256 } from './mcp-binding-fingerprint';
import { McpRuntimeRepository, type StoredMcpAuthority } from './mcp-runtime.repository';

const boundedMessage = z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS);
const completedAtSchema = z.string().datetime();

@Injectable()
export class McpInvocationService {
  constructor(
    private readonly repository: McpRuntimeRepository,
    private readonly toolRegistry: ToolRegistryService,
    private readonly workflowRuns: WorkflowRunRepository,
  ) {}

  async prepare(requestInput: ToolInvocationRequest): Promise<PrepareToolInvocationOutcome> {
    const request = parseOrBadRequest(
      ToolInvocationRequestSchema,
      requestInput,
      'Invalid tool invocation request',
    );
    if (isExpired(request.deadlineAt)) {
      throw new BadRequestException('Tool invocation deadline has expired');
    }
    if (request.scope.kind !== 'run') {
      throw new ForbiddenException('Durable tool invocation requires run authority');
    }

    const authority = await this.repository.getAuthority({
      capabilityGrantId: request.scope.capabilityGrantId,
      capabilitySnapshotId: request.capabilitySnapshotId,
      scope: request.scope,
    });
    if (!authority) {
      throw new ForbiddenException('Tool invocation authority was not found');
    }
    const { entry, descriptor } = this.resolveComponentAuthority(request, authority);

    let validation: Awaited<
      ReturnType<
        ReturnType<typeof fromJsonSchema<Record<string, unknown>>>['~standard']['validate']
      >
    >;
    try {
      const schema = fromJsonSchema<Record<string, unknown>>(descriptor.inputSchema);
      validation = await schema['~standard'].validate(request.input);
    } catch {
      throw new ServiceUnavailableException('Tool input validation is unavailable');
    }
    if (validation.issues) {
      throw new BadRequestException('Invalid tool input');
    }

    return PrepareToolInvocationOutcomeSchema.parse(
      await this.repository.prepareInvocation({
        request,
        requestHash: sha256(request),
        entry,
        manifest: authority.manifest,
      }),
    );
  }

  async prepareOperation(
    requestInput: McpOperationInvocationRequest,
  ): Promise<PrepareMcpOperationOutcome> {
    const request = parseOrBadRequest(
      McpOperationInvocationRequestSchema,
      requestInput,
      'Invalid MCP operation invocation request',
    );
    if (isExpired(request.deadlineAt)) {
      throw new BadRequestException('MCP operation deadline has expired');
    }
    if (request.scope.kind !== 'run' && request.scope.kind !== 'operator') {
      throw new ForbiddenException('Durable MCP operation requires run or Operator authority');
    }
    if (request.scope.kind === 'operator' && isExpired(request.scope.expiresAt)) {
      throw new ForbiddenException('Operator MCP authority has expired');
    }
    if (
      request.scope.kind === 'operator' &&
      Date.parse(request.deadlineAt) > Date.parse(request.scope.expiresAt)
    ) {
      throw new BadRequestException('MCP operation deadline exceeds Operator authority');
    }
    const authority = await this.repository.getAuthority({
      capabilityGrantId: request.scope.capabilityGrantId,
      capabilitySnapshotId: request.capabilitySnapshotId,
      scope: request.scope,
    });
    if (!authority) {
      throw new ForbiddenException('MCP operation authority was not found');
    }
    const resolved = await this.resolveOperationAuthority(request, authority);
    return this.repository.prepareOperation({
      request,
      dispatchOperation: resolved.dispatchOperation,
      requestHash: sha256(request),
      entry: resolved.entry,
      ...(resolved.runtimeBinding !== undefined && {
        runtimeBinding: resolved.runtimeBinding,
      }),
      manifest: authority.manifest,
    });
  }

  async claimComponentDispatch(
    reference: PreparedInvocationRef,
  ): Promise<ClaimComponentDispatchOutcome> {
    const requestedRef = parseOrBadRequest(
      PreparedInvocationRefSchema,
      reference,
      'Invalid prepared invocation reference',
    );
    const stored = await this.repository.getInvocationForDispatch(requestedRef);
    if (stored.status === 'dispatched') {
      return this.claimReplay(requestedRef);
    }
    if (stored.result) {
      return ClaimComponentDispatchOutcomeSchema.parse({
        kind: 'terminal',
        result: stored.result,
      });
    }
    if (stored.status !== 'prepared') {
      throw new ConflictException('MCP invocation is not claimable from its current state');
    }
    if (isExpired(stored.request.deadlineAt)) {
      const result = await this.repository.reconcileDispatchFailure({
        ref: stored.ref,
        cause: 'deadline',
        message: 'Invocation deadline expired before dispatch',
        completedAt: new Date().toISOString(),
      });
      return ClaimComponentDispatchOutcomeSchema.parse({ kind: 'terminal', result });
    }
    if (stored.request.scope.kind !== 'run') {
      throw new ConflictException('Persisted MCP invocation is not run-scoped');
    }

    const authority = await this.repository.getAuthority({
      capabilityGrantId: stored.request.scope.capabilityGrantId,
      capabilitySnapshotId: stored.request.capabilitySnapshotId,
      scope: stored.request.scope,
    });
    if (!authority) {
      throw new ConflictException('Persisted MCP invocation authority is unavailable');
    }
    const { entry, descriptor } = this.resolveComponentAuthority(stored.request, authority);
    if (
      entry.sourceId !== stored.ref.sourceId ||
      entry.destination !== stored.ref.destination ||
      entry.retryPolicy !== stored.ref.retryPolicy
    ) {
      throw new ConflictException('Prepared invocation no longer matches its manifest entry');
    }
    const source = descriptor.source;
    if (source.kind !== 'component') {
      throw new ConflictException('Prepared invocation source is not a component');
    }
    const component = componentRegistry.get(source.componentId);
    if (!component || component.id !== source.componentId) {
      throw new ServiceUnavailableException('MCP component implementation is unavailable');
    }

    const run = await this.workflowRuns.findByRunId(stored.request.scope.runId, {
      organizationId: stored.request.scope.organizationId,
    });
    if (
      !run ||
      run.runId !== stored.request.scope.runId ||
      run.organizationId !== stored.request.scope.organizationId
    ) {
      throw new ConflictException('Workflow run no longer matches invocation authority');
    }
    const publicDescriptor: McpToolRegistrationDescriptor = {
      name: descriptor.canonicalName,
      ...(descriptor.description !== undefined && { description: descriptor.description }),
      inputSchema: descriptor.inputSchema,
    };
    const resolved = await this.toolRegistry.resolveComponentForDispatch({
      runId: stored.request.scope.runId,
      nodeId: source.nodeId,
      componentId: source.componentId,
      toolName: descriptor.canonicalName,
      bindingFingerprint: source.bindingFingerprint,
      descriptor: publicDescriptor,
    });

    const actionInputIds = new Set(getActionInputIds(component));
    const exposedParameters = new Set(getExposedParameterIds(component));
    const inputArgs: Record<string, unknown> = {};
    const parameterOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored.request.input)) {
      if (exposedParameters.has(key) && !actionInputIds.has(key)) {
        parameterOverrides[key] = value;
      } else {
        inputArgs[key] = value;
      }
    }

    let context: ComponentInvocationDispatchContext;
    try {
      context = ComponentInvocationDispatchContextSchema.parse({
        ref: stored.ref,
        run: {
          runId: run.runId,
          workflowId: run.workflowId,
          workflowVersionId: run.workflowVersionId,
          organizationId: run.organizationId,
          scopeId: run.scopeId,
        },
        component: {
          nodeId: source.nodeId,
          componentId: source.componentId,
          arguments: inputArgs,
          parameters: { ...(resolved.tool.parameters ?? {}), ...parameterOverrides },
          ...(resolved.credentials ? { credentials: resolved.credentials } : {}),
        },
      });
    } catch {
      throw new ServiceUnavailableException('MCP component dispatch metadata is invalid');
    }

    const claim = await this.repository.claimAttempt(stored.ref);
    if (claim.kind !== 'claimed') {
      return ClaimComponentDispatchOutcomeSchema.parse({
        kind: 'terminal',
        result: claim.result,
      });
    }
    return ClaimComponentDispatchOutcomeSchema.parse({ kind: 'dispatch', context });
  }

  async claimMcpOperationDispatch(
    input: ClaimMcpOperationDispatchRequest,
  ): Promise<ClaimMcpOperationDispatchOutcome> {
    const claim = parseOrBadRequest(
      ClaimMcpOperationDispatchRequestSchema,
      input,
      'Invalid MCP operation dispatch claim',
    );
    const stored = await this.repository.getMcpOperationForDispatch(claim.plan.ref);
    if (stored.result) {
      return ClaimMcpOperationDispatchOutcomeSchema.parse({
        kind: 'terminal',
        result: stored.result,
      });
    }
    if (stored.status !== 'prepared') {
      const replay = await this.repository.claimOperationAttempt(claim);
      if (replay.kind === 'claimed') {
        throw new ConflictException('Dispatched MCP operation replay unexpectedly reclaimed');
      }
      return ClaimMcpOperationDispatchOutcomeSchema.parse({
        kind: 'terminal',
        result: replay.result,
      });
    }
    if (isExpired(stored.request.deadlineAt)) {
      const result = await this.repository.reconcileMcpOperationDispatchFailure({
        ref: stored.ref,
        cause: 'deadline',
        message: 'MCP operation deadline expired before dispatch',
        completedAt: new Date().toISOString(),
      });
      return ClaimMcpOperationDispatchOutcomeSchema.parse({ kind: 'terminal', result });
    }
    if (stored.request.scope.kind === 'operator' && isExpired(stored.request.scope.expiresAt)) {
      const result = await this.repository.reconcileMcpOperationDispatchFailure({
        ref: stored.ref,
        cause: 'deadline',
        message: 'Operator MCP authority expired before dispatch',
        completedAt: new Date().toISOString(),
      });
      return ClaimMcpOperationDispatchOutcomeSchema.parse({ kind: 'terminal', result });
    }
    if (stored.request.scope.kind !== 'run' && stored.request.scope.kind !== 'operator') {
      throw new ConflictException('Persisted MCP operation has unsupported authority');
    }
    const authority = await this.repository.getAuthority({
      capabilityGrantId: stored.request.scope.capabilityGrantId,
      capabilitySnapshotId: stored.request.capabilitySnapshotId,
      scope: stored.request.scope,
    });
    if (!authority) {
      throw new ConflictException('Persisted MCP operation authority is unavailable');
    }
    const resolved = await this.resolveOperationAuthority(stored.request, authority);
    const expectedPlan = {
      ...claim.plan,
      manifestEntry: resolved.entry,
      operation: resolved.dispatchOperation,
      ...(resolved.runtimeBinding !== undefined ? { runtimeBinding: resolved.runtimeBinding } : {}),
    };
    if (!isDeepStrictEqual(claim.plan, expectedPlan)) {
      throw new ConflictException('MCP operation dispatch plan no longer matches persistence');
    }

    if (claim.plan.ref.destination === 'component-activity') {
      const context = await this.resolveMcpOperationComponentContext(
        stored.request,
        claim.plan.ref,
        authority,
      );
      const outcome = await this.repository.claimOperationAttempt(claim);
      if (outcome.kind !== 'claimed') {
        return ClaimMcpOperationDispatchOutcomeSchema.parse({
          kind: 'terminal',
          result: outcome.result,
        });
      }
      return ClaimMcpOperationDispatchOutcomeSchema.parse({
        kind: 'component-dispatch',
        context,
      });
    }
    if (!claim.runtimeRef) {
      throw new ConflictException('Outbound MCP operation claim has no acquired runtime');
    }
    const outcome = await this.repository.claimOperationAttempt(claim);
    if (outcome.kind !== 'claimed') {
      return ClaimMcpOperationDispatchOutcomeSchema.parse({
        kind: 'terminal',
        result: outcome.result,
      });
    }
    return ClaimMcpOperationDispatchOutcomeSchema.parse({ kind: 'claimed' });
  }

  async settleMcpOperation(input: SettleMcpOperationAttemptRequest) {
    const parsed = parseOrBadRequest(
      SettleMcpOperationAttemptRequestSchema,
      input,
      'Invalid MCP operation settlement',
    );
    return this.repository.settleMcpOperationAttempt(parsed);
  }

  async reconcileMcpOperationDispatch(input: ReconcileMcpOperationDispatchRequest) {
    const parsed = parseOrBadRequest(
      ReconcileMcpOperationDispatchRequestSchema,
      input,
      'Invalid MCP operation reconciliation request',
    );
    return this.repository.reconcileMcpOperationDispatchFailure(parsed);
  }

  async complete(
    refInput: PreparedInvocationRef,
    resultInput: ToolInvocationResult,
  ): Promise<ToolInvocationResult> {
    return this.settle(refInput, resultInput, 'completed');
  }

  async fail(
    refInput: PreparedInvocationRef,
    resultInput: ToolInvocationResult,
  ): Promise<ToolInvocationResult> {
    return this.settle(refInput, resultInput, 'failed');
  }

  async ambiguous(
    refInput: PreparedInvocationRef,
    messageInput: string,
    completedAtInput: string,
  ): Promise<ToolInvocationResult> {
    const ref = parseOrBadRequest(
      PreparedInvocationRefSchema,
      refInput,
      'Invalid prepared invocation reference',
    );
    const message = parseOrBadRequest(boundedMessage, messageInput, 'Invalid ambiguity message');
    const completedAt = parseOrBadRequest(
      completedAtSchema,
      completedAtInput,
      'Invalid completion timestamp',
    );
    return this.repository.markAttemptAmbiguous({ ref, message, completedAt });
  }

  async reconcileDispatchFailure(input: {
    ref: PreparedInvocationRef;
    cause: 'failure' | 'deadline' | 'cancelled';
    message: string;
    completedAt: string;
  }): Promise<ToolInvocationResult> {
    const parsed = parseOrBadRequest(
      z
        .object({
          ref: PreparedInvocationRefSchema,
          cause: z.enum(['failure', 'deadline', 'cancelled']),
          message: boundedMessage,
          completedAt: completedAtSchema,
        })
        .strict(),
      input,
      'Invalid invocation reconciliation request',
    );
    return this.repository.reconcileDispatchFailure(parsed);
  }

  async reconcileRunInvocations(input: {
    runId: string;
    message: string;
    completedAt: string;
  }): Promise<void> {
    const parsed = parseOrBadRequest(
      z
        .object({
          runId: z.string().min(1),
          message: boundedMessage,
          completedAt: completedAtSchema,
        })
        .strict(),
      input,
      'Invalid run invocation reconciliation request',
    );
    return this.repository.reconcileRunInvocations(parsed);
  }

  private resolveComponentAuthority(request: ToolInvocationRequest, authority: StoredMcpAuthority) {
    try {
      assertCapabilityGrantApplies(request.scope, authority.grant);
      const entry = resolveInvocationManifestEntry(authority.manifest, {
        scope: request.scope,
        capabilitySnapshotId: request.capabilitySnapshotId,
        toolName: request.toolName,
      });
      const descriptor = authority.snapshot.tools.find(
        (candidate) =>
          candidate.canonicalName === entry.toolName &&
          candidate.source.sourceId === entry.sourceId,
      );
      if (!descriptor) {
        throw new Error('Authorized tool descriptor is missing from its snapshot');
      }
      if (entry.destination !== 'component-activity' || descriptor.source.kind !== 'component') {
        throw new BadRequestException('Only component invocation dispatch is supported');
      }
      return { entry, descriptor };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ForbiddenException('Tool invocation is not authorized');
    }
  }

  private async resolveOperationAuthority(
    request: McpOperationInvocationRequest,
    authority: StoredMcpAuthority,
  ): Promise<{
    entry: McpOperationManifestEntry;
    dispatchOperation: McpOperation;
    runtimeBinding?: McpSnapshotRuntimeBinding;
  }> {
    try {
      assertCapabilityGrantApplies(request.scope, authority.grant);
      const entry = McpOperationManifestEntrySchema.parse(
        resolveMcpOperationManifestEntry(authority.manifest, request),
      );
      let dispatchOperation: McpOperation;
      let externalSource = true;
      switch (request.operation.kind) {
        case 'tool-call': {
          const candidates = authority.snapshot.tools.filter(
            (descriptor) =>
              descriptor.canonicalName === request.authorizationTarget &&
              descriptor.source.sourceId === request.sourceId,
          );
          if (candidates.length !== 1 || request.operation.name !== request.authorizationTarget) {
            throw new Error('Tool operation payload does not match immutable authority');
          }
          const descriptor = candidates[0]!;
          let validation: Awaited<
            ReturnType<
              ReturnType<typeof fromJsonSchema<Record<string, unknown>>>['~standard']['validate']
            >
          >;
          try {
            validation = await fromJsonSchema<Record<string, unknown>>(descriptor.inputSchema)[
              '~standard'
            ].validate(request.operation.arguments);
          } catch {
            throw new ServiceUnavailableException('Tool input validation is unavailable');
          }
          if (validation.issues) {
            throw new BadRequestException('Invalid tool input');
          }
          externalSource = descriptor.source.kind === 'mcp';
          dispatchOperation = {
            ...request.operation,
            name:
              descriptor.source.kind === 'mcp'
                ? descriptor.source.upstreamName
                : descriptor.canonicalName,
          };
          break;
        }
        case 'prompt-get': {
          const candidates = authority.snapshot.prompts.filter(
            (descriptor) =>
              descriptor.sourceId === request.sourceId &&
              descriptor.name === request.authorizationTarget,
          );
          if (candidates.length !== 1 || request.operation.name !== request.authorizationTarget) {
            throw new Error('Prompt operation payload does not match immutable authority');
          }
          dispatchOperation = request.operation;
          break;
        }
        case 'resource-read': {
          const exact = authority.snapshot.resources.filter(
            (descriptor) =>
              descriptor.sourceId === request.sourceId &&
              descriptor.uri === request.authorizationTarget,
          );
          const templates = authority.snapshot.resourceTemplates.filter(
            (descriptor) =>
              descriptor.sourceId === request.sourceId &&
              descriptor.uriTemplate === request.authorizationTarget,
          );
          if (exact.length + templates.length !== 1) {
            throw new Error('Resource operation authority is missing or ambiguous');
          }
          if (exact.length === 1 && request.operation.uri !== exact[0]!.uri) {
            throw new Error('Resource URI does not match immutable exact authority');
          }
          if (
            templates.length === 1 &&
            new UriTemplate(templates[0]!.uriTemplate).match(request.operation.uri) === null
          ) {
            throw new Error('Resource URI does not match immutable template authority');
          }
          dispatchOperation = request.operation;
          break;
        }
      }
      if (entry.destination === 'component-activity') {
        if (
          request.scope.kind === 'operator' ||
          externalSource ||
          request.operation.kind !== 'tool-call'
        ) {
          throw new Error('Component dispatch authority does not match its capability');
        }
        return { entry, dispatchOperation };
      }
      const runtimeBinding = mcpSnapshotRuntimeBindings(authority.snapshot)[request.sourceId];
      if (!runtimeBinding) {
        throw new Error('Outbound MCP operation has no snapshotted runtime binding');
      }
      return { entry, dispatchOperation, runtimeBinding };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ForbiddenException('MCP operation is not authorized');
    }
  }

  private async resolveMcpOperationComponentContext(
    request: McpOperationInvocationRequest,
    ref: PreparedMcpOperationRef,
    authority: StoredMcpAuthority,
  ): Promise<McpOperationComponentDispatchContext> {
    if (request.scope.kind !== 'run') {
      throw new ConflictException('Component MCP operations must be run-scoped');
    }
    if (request.operation.kind !== 'tool-call') {
      throw new ConflictException('Only tool calls may dispatch to component activities');
    }
    const descriptor = authority.snapshot.tools.find(
      (candidate) =>
        candidate.canonicalName === request.authorizationTarget &&
        candidate.source.sourceId === request.sourceId,
    );
    if (!descriptor || descriptor.source.kind !== 'component') {
      throw new ConflictException('Prepared MCP operation source is not a component');
    }
    const component = componentRegistry.get(descriptor.source.componentId);
    if (!component || component.id !== descriptor.source.componentId) {
      throw new ServiceUnavailableException('MCP component implementation is unavailable');
    }
    const run = await this.workflowRuns.findByRunId(request.scope.runId, {
      organizationId: request.scope.organizationId,
    });
    if (
      !run ||
      run.runId !== request.scope.runId ||
      run.organizationId !== request.scope.organizationId
    ) {
      throw new ConflictException('Workflow run no longer matches MCP operation authority');
    }
    const resolved = await this.toolRegistry.resolveComponentForDispatch({
      runId: request.scope.runId,
      nodeId: descriptor.source.nodeId,
      componentId: descriptor.source.componentId,
      toolName: descriptor.canonicalName,
      bindingFingerprint: descriptor.source.bindingFingerprint,
      descriptor: {
        name: descriptor.canonicalName,
        ...(descriptor.description !== undefined && { description: descriptor.description }),
        inputSchema: descriptor.inputSchema,
      },
    });
    const actionInputIds = new Set(getActionInputIds(component));
    const exposedParameters = new Set(getExposedParameterIds(component));
    const inputArgs: Record<string, unknown> = {};
    const parameterOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(request.operation.arguments)) {
      if (exposedParameters.has(key) && !actionInputIds.has(key)) {
        parameterOverrides[key] = value;
      } else {
        inputArgs[key] = value;
      }
    }
    return McpOperationComponentDispatchContextSchema.parse({
      ref,
      run: {
        runId: run.runId,
        workflowId: run.workflowId,
        workflowVersionId: run.workflowVersionId,
        organizationId: run.organizationId,
        scopeId: run.scopeId,
      },
      component: {
        nodeId: descriptor.source.nodeId,
        componentId: descriptor.source.componentId,
        arguments: inputArgs,
        parameters: { ...(resolved.tool.parameters ?? {}), ...parameterOverrides },
        ...(resolved.credentials ? { credentials: resolved.credentials } : {}),
      },
    });
  }

  private async claimReplay(ref: PreparedInvocationRef): Promise<ClaimComponentDispatchOutcome> {
    const claim = await this.repository.claimAttempt(ref);
    if (claim.kind === 'claimed') {
      throw new ConflictException('Dispatched invocation replay unexpectedly reclaimed');
    }
    return ClaimComponentDispatchOutcomeSchema.parse({
      kind: 'terminal',
      result: claim.result,
    });
  }

  private async settle(
    refInput: PreparedInvocationRef,
    resultInput: ToolInvocationResult,
    status: 'completed' | 'failed',
  ): Promise<ToolInvocationResult> {
    const ref = parseOrBadRequest(
      PreparedInvocationRefSchema,
      refInput,
      'Invalid prepared invocation reference',
    );
    const result = parseOrBadRequest(
      ToolInvocationResultSchema,
      resultInput,
      'Invalid tool invocation result',
    );
    if (result.invocationId !== ref.invocationId) {
      throw new ConflictException('Tool invocation result belongs to a different invocation');
    }
    if (result.status !== status) {
      throw new BadRequestException(`Tool invocation result must be ${status}`);
    }
    return this.repository.settleAttempt({ ref, result });
  }
}

function isExpired(deadlineAt: string): boolean {
  return new Date(deadlineAt).getTime() <= Date.now();
}

function parseOrBadRequest<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(message);
  }
  return parsed.data;
}
