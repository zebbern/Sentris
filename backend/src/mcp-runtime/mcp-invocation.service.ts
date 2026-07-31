import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import {
  componentRegistry,
  getActionInputIds,
  getExposedParameterIds,
} from '@sentris/component-sdk';
import {
  ClaimComponentDispatchOutcomeSchema,
  ComponentInvocationDispatchContextSchema,
  MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS,
  PreparedInvocationRefSchema,
  PrepareToolInvocationOutcomeSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  assertCapabilityGrantApplies,
  resolveInvocationManifestEntry,
  type ClaimComponentDispatchOutcome,
  type ComponentInvocationDispatchContext,
  type McpToolRegistrationDescriptor,
  type PreparedInvocationRef,
  type PrepareToolInvocationOutcome,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@sentris/shared';
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
      runId: request.scope.runId,
      organizationId: request.scope.organizationId,
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
      runId: stored.request.scope.runId,
      organizationId: stored.request.scope.organizationId,
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
