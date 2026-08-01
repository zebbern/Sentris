import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  componentRegistry,
  getActionInputIds,
  getExposedParameterIds,
  getToolInputShape,
} from '@sentris/component-sdk';
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import {
  TOOL_INVOCATION_UPDATE_NAME,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  type McpToolRegistrationDescriptor,
  type ToolDescriptor,
  type ToolInvocationResult,
} from '@sentris/shared';
import { z } from 'zod';

import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { computeMcpBindingFingerprint } from '../mcp-runtime/mcp-binding-fingerprint';
import { McpRuntimeRepository } from '../mcp-runtime/mcp-runtime.repository';
import {
  claimMcpToolName,
  externalMcpToolName,
  McpToolNameCollisionError,
} from '../mcp-runtime/mcp-tool-name';
import { TemporalService } from '../temporal/temporal.service';
import { TraceRepository } from '../trace/trace.repository';
import type { TraceEventType } from '../trace/types';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { McpLegacyOutboundCompatibilityService } from './mcp-legacy-outbound-compatibility.service';
import { toRunExecutionScope, type RunMcpRequestContext } from './run-mcp-request-context';
import { ToolRegistryService, type RegisteredTool } from './tool-registry.service';

@Injectable()
export class McpGatewayService {
  private readonly logger = new Logger(McpGatewayService.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly legacyOutbound: McpLegacyOutboundCompatibilityService,
    private readonly temporalService: TemporalService,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
    private readonly mcpServersRepository: McpServersRepository,
    private readonly mcpRuntimeRepository: McpRuntimeRepository,
  ) {}

  async createServerForRun(context: RunMcpRequestContext): Promise<McpServer> {
    await this.validateRunAccess(context.runId, context.organizationId);
    const server = new McpServer({ name: 'sentris-flow-gateway', version: '1.0.0' });
    const registeredToolNames = new Set<string>();
    if (context.capabilitySnapshotId) {
      await this.registerSnapshotTools(
        server,
        context,
        context.capabilitySnapshotId,
        registeredToolNames,
      );
    } else {
      await this.registerLegacyLiveTools(server, context, registeredToolNames);
    }
    this.logger.log(
      `[createServerForRun] Registered ${registeredToolNames.size} tools for run ${context.runId}`,
    );
    return server;
  }

  private async validateRunAccess(runId: string, organizationId?: string | null): Promise<void> {
    const run = await this.workflowRunRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    if (run.organizationId !== organizationId) {
      throw new ForbiddenException(`You do not have access to workflow run ${runId}`);
    }
  }

  private async registerSnapshotTools(
    server: McpServer,
    context: RunMcpRequestContext,
    capabilitySnapshotId: string,
    registeredToolNames: Set<string>,
  ): Promise<void> {
    const authority = await this.mcpRuntimeRepository.getAuthority({
      capabilityGrantId: context.capabilityGrantId,
      capabilitySnapshotId,
      runId: context.runId,
      organizationId: context.organizationId,
    });
    if (!authority) {
      throw new ForbiddenException('MCP capability snapshot does not match the run authority');
    }

    const externalDescriptors = authority.snapshot.tools.filter(
      (
        descriptor,
      ): descriptor is ToolDescriptor & {
        source: Extract<ToolDescriptor['source'], { kind: 'mcp' }>;
      } => descriptor.source.kind === 'mcp',
    );
    const externalSources = externalDescriptors.length
      ? await this.resolveSnapshotExternalSources(context.runId, externalDescriptors)
      : new Map<string, RegisteredTool>();

    for (const descriptor of authority.snapshot.tools) {
      claimMcpToolName(registeredToolNames, descriptor.canonicalName);
      if (descriptor.source.kind === 'component') {
        this.registerSnapshotComponentTool(server, context, capabilitySnapshotId, {
          ...descriptor,
          source: descriptor.source,
        });
      } else {
        const source = externalSources.get(descriptor.source.sourceId);
        if (!source) {
          throw new NotFoundException(
            `External MCP source ${descriptor.source.sourceId} is unavailable for run ${context.runId}`,
          );
        }
        this.registerSnapshotExternalTool(server, context.runId, source, {
          ...descriptor,
          source: descriptor.source,
        });
      }
    }
  }

  private async resolveSnapshotExternalSources(
    runId: string,
    descriptors: readonly (ToolDescriptor & {
      source: Extract<ToolDescriptor['source'], { kind: 'mcp' }>;
    })[],
  ): Promise<Map<string, RegisteredTool>> {
    const requiredSourceIds = new Set(descriptors.map((descriptor) => descriptor.source.sourceId));
    const descriptorsBySource = new Map<string, typeof descriptors>();
    for (const descriptor of descriptors) {
      const sourceId = descriptor.source.sourceId;
      descriptorsBySource.set(sourceId, [...(descriptorsBySource.get(sourceId) ?? []), descriptor]);
    }
    const registered = await this.toolRegistry.getToolsForRun(runId);
    const sources = new Map<string, RegisteredTool>();
    for (const source of registered) {
      if (!requiredSourceIds.has(source.nodeId)) continue;
      if (source.type === 'component') {
        throw new ForbiddenException(
          `External MCP source ${source.nodeId} does not match its immutable snapshot binding`,
        );
      }
      if (sources.has(source.nodeId)) {
        throw new ForbiddenException(`Duplicate MCP runtime source mapping: ${source.nodeId}`);
      }
      const snapshotDescriptors = descriptorsBySource.get(source.nodeId) ?? [];
      const expectedFingerprint = snapshotDescriptors[0]?.source.bindingFingerprint;
      if (
        !expectedFingerprint ||
        snapshotDescriptors.some(
          (descriptor) => descriptor.source.bindingFingerprint !== expectedFingerprint,
        )
      ) {
        throw new ForbiddenException(
          `External MCP source ${source.nodeId} has inconsistent snapshot bindings`,
        );
      }
      const currentFingerprint = computeMcpBindingFingerprint(
        source,
        snapshotDescriptors
          .slice()
          .sort((left, right) => left.source.upstreamName.localeCompare(right.source.upstreamName))
          .map(externalSnapshotRegistrationDescriptor),
      );
      if (currentFingerprint !== expectedFingerprint) {
        throw new ForbiddenException(
          `External MCP source ${source.nodeId} no longer matches its immutable snapshot binding`,
        );
      }
      sources.set(source.nodeId, source);
    }
    return sources;
  }

  private registerSnapshotComponentTool(
    server: McpServer,
    context: RunMcpRequestContext,
    capabilitySnapshotId: string,
    descriptor: ToolDescriptor & {
      source: Extract<ToolDescriptor['source'], { kind: 'component' }>;
    },
  ): void {
    this.registerSnapshotDescriptor(server, descriptor, async (args) => {
      const startedAt = Date.now();
      await this.logToolCall(
        context.runId,
        descriptor.canonicalName,
        'STARTED',
        descriptor.source.nodeId,
      );
      try {
        const now = new Date();
        const request = ToolInvocationRequestSchema.parse({
          invocationId: randomUUID(),
          scope: toRunExecutionScope(context),
          capabilitySnapshotId,
          toolName: descriptor.canonicalName,
          input: args,
          requestedAt: now.toISOString(),
          deadlineAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        });
        const result = ToolInvocationResultSchema.parse(
          await this.temporalService.executeWorkflowUpdate<ToolInvocationResult>({
            workflowId: context.runId,
            updateName: TOOL_INVOCATION_UPDATE_NAME,
            updateId: request.invocationId,
            args: request,
          }),
        );
        if (result.status === 'completed') {
          await this.logToolCall(
            context.runId,
            descriptor.canonicalName,
            'COMPLETED',
            descriptor.source.nodeId,
            { duration: Date.now() - startedAt, output: result.output },
          );
          const response = {
            content: [{ type: 'text' as const, text: JSON.stringify(result.output, null, 2) }],
          };
          return isRecord(result.output)
            ? { ...response, structuredContent: result.output }
            : response;
        }

        const message = result.error?.message ?? `Tool invocation ended with ${result.status}`;
        await this.logToolCall(
          context.runId,
          descriptor.canonicalName,
          'FAILED',
          descriptor.source.nodeId,
          { duration: Date.now() - startedAt, error: message },
        );
        return mcpToolError(message);
      } catch (error) {
        const message = safeErrorMessage(error);
        await this.logToolCall(
          context.runId,
          descriptor.canonicalName,
          'FAILED',
          descriptor.source.nodeId,
          { duration: Date.now() - startedAt, error: message },
        );
        return mcpToolError(message);
      }
    });
  }

  private registerSnapshotExternalTool(
    server: McpServer,
    runId: string,
    source: RegisteredTool,
    descriptor: ToolDescriptor & {
      source: Extract<ToolDescriptor['source'], { kind: 'mcp' }>;
    },
  ): void {
    this.registerSnapshotDescriptor(server, descriptor, async (args) => {
      const startedAt = Date.now();
      const nodeRef = `mcp:${descriptor.canonicalName}`;
      await this.logToolCall(runId, descriptor.canonicalName, 'STARTED', nodeRef);
      try {
        const result = await this.legacyOutbound.callTool(
          runId,
          source,
          descriptor.source.upstreamName,
          args,
        );
        await this.logToolCall(runId, descriptor.canonicalName, 'COMPLETED', nodeRef, {
          duration: Date.now() - startedAt,
          output: result,
        });
        return result;
      } catch (error) {
        const message = safeErrorMessage(error);
        await this.logToolCall(runId, descriptor.canonicalName, 'FAILED', nodeRef, {
          duration: Date.now() - startedAt,
          error: message,
        });
        return mcpToolError(message);
      }
    });
  }

  private registerSnapshotDescriptor(
    server: McpServer,
    descriptor: ToolDescriptor,
    callback: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    server.registerTool(
      descriptor.canonicalName,
      {
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(descriptor.inputSchema),
        outputSchema: descriptor.outputSchema
          ? fromJsonSchema<Record<string, unknown>>(descriptor.outputSchema)
          : undefined,
        icons: descriptor.icons,
        annotations: descriptor.annotations,
        _meta: descriptor.meta,
      },
      callback as never,
    );
  }

  private async registerLegacyLiveTools(
    server: McpServer,
    context: RunMcpRequestContext,
    registeredToolNames: Set<string>,
  ): Promise<void> {
    const allowedNodeIds = [...context.allowedNodeIds];
    const registered = await this.toolRegistry.getToolsForRun(context.runId, allowedNodeIds);

    for (const tool of registered.filter((candidate) => candidate.type === 'component')) {
      if (tool.exposedToAgent === false) continue;
      claimMcpToolName(registeredToolNames, tool.toolName);
      this.registerLegacyComponentTool(server, context.runId, tool);
    }

    const externalSources = registered
      .filter((candidate) => candidate.type !== 'component')
      .filter((candidate) => isNodeAllowed(candidate.nodeId, allowedNodeIds));
    for (const source of externalSources) {
      try {
        const tools = await this.discoverExternalTools(context.runId, source);
        for (const upstream of tools) {
          const canonicalName = externalMcpToolName(source.toolName, upstream.name);
          claimMcpToolName(registeredToolNames, canonicalName);
          this.registerLegacyExternalTool(server, context.runId, source, upstream, canonicalName);
        }
      } catch (error) {
        if (error instanceof McpToolNameCollisionError) throw error;
        this.logger.error(`Failed to fetch tools from external source ${source.toolName}:`, error);
      }
    }
  }

  private registerLegacyComponentTool(
    server: McpServer,
    runId: string,
    tool: RegisteredTool,
  ): void {
    const component = tool.componentId ? componentRegistry.get(tool.componentId) : null;
    const inputShape = component ? getToolInputShape(component) : undefined;
    server.registerTool(
      tool.toolName,
      {
        description: tool.description,
        inputSchema: z.object(inputShape ?? {}),
        _meta: { inputSchema: tool.inputSchema },
      },
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        await this.logToolCall(runId, tool.toolName, 'STARTED', tool.nodeId);
        try {
          const result = await this.callComponentTool(tool, runId, args ?? {});
          await this.logToolCall(runId, tool.toolName, 'COMPLETED', tool.nodeId, {
            duration: Date.now() - startedAt,
            output: result,
          });
          await this.temporalService.signalWorkflow({
            workflowId: runId,
            signalName: 'toolCallCompleted',
            args: {
              nodeRef: tool.nodeId,
              toolName: tool.toolName,
              output: result,
              status: 'completed',
            },
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.logToolCall(runId, tool.toolName, 'FAILED', tool.nodeId, {
            duration: Date.now() - startedAt,
            error: message,
          });
          await this.temporalService.signalWorkflow({
            workflowId: runId,
            signalName: 'toolCallCompleted',
            args: {
              nodeRef: tool.nodeId,
              toolName: tool.toolName,
              output: null,
              status: 'failed',
              errorMessage: message,
            },
          });
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  private registerLegacyExternalTool(
    server: McpServer,
    runId: string,
    source: RegisteredTool,
    upstream: McpToolRegistrationDescriptor,
    canonicalName: string,
  ): void {
    const inputSchema = fromJsonSchema<Record<string, unknown>>(
      upstream.inputSchema ?? { type: 'object' },
    );
    const outputSchema = upstream.outputSchema
      ? fromJsonSchema<Record<string, unknown>>(upstream.outputSchema)
      : undefined;
    server.registerTool(
      canonicalName,
      {
        title: upstream.title,
        description: upstream.description,
        inputSchema,
        outputSchema,
        icons: upstream.icons,
        annotations: upstream.annotations,
        _meta: upstream._meta,
      },
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        const nodeRef = `mcp:${canonicalName}`;
        await this.logToolCall(runId, canonicalName, 'STARTED', nodeRef);
        try {
          const result = await this.legacyOutbound.callTool(runId, source, upstream.name, args);
          await this.logToolCall(runId, canonicalName, 'COMPLETED', nodeRef, {
            duration: Date.now() - startedAt,
            output: result,
          });
          return result;
        } catch (error) {
          await this.logToolCall(runId, canonicalName, 'FAILED', nodeRef, {
            duration: Date.now() - startedAt,
            error,
          });
          throw new Error(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }

  private async discoverExternalTools(
    runId: string,
    source: RegisteredTool,
  ): Promise<McpToolRegistrationDescriptor[]> {
    const cached = await this.toolRegistry.getServerTools(runId, source.nodeId);
    if (cached && cached.length > 0) return cached;

    if (source.type === 'mcp-server' || source.type === 'local-mcp') {
      return source.endpoint ? this.legacyOutbound.discoverTools(runId, source) : [];
    }
    if (!source.serverId) return [];

    try {
      const records = await this.mcpServersRepository.listTools(source.serverId);
      return records
        .filter((record) => record.enabled)
        .map((record) => ({
          name: record.toolName,
          description: record.description ?? undefined,
          inputSchema: (record.inputSchema as Record<string, unknown> | null) ?? undefined,
        }));
    } catch (error) {
      this.logger.error(`Failed to load pre-discovered tools for ${source.serverId}:`, error);
      return [];
    }
  }

  private async callComponentTool(
    tool: RegisteredTool,
    runId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!tool.componentId) {
      throw new BadRequestException(`Component ID missing for tool '${tool.toolName}'`);
    }
    const component = componentRegistry.get(tool.componentId);
    const actionInputIds = component ? new Set(getActionInputIds(component)) : new Set<string>();
    const exposedParameterIds = component ? getExposedParameterIds(component) : [];
    const exposedParameterSet = new Set(exposedParameterIds);
    const inputArgs: Record<string, unknown> = {};
    const parameterOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args ?? {})) {
      if (exposedParameterSet.has(key) && !actionInputIds.has(key)) {
        parameterOverrides[key] = value;
      } else {
        inputArgs[key] = value;
      }
    }

    const credentials = await this.toolRegistry.getToolCredentials(runId, tool.nodeId);
    const callId = `${runId}:${tool.nodeId}:${Date.now()}`;
    await this.temporalService.signalWorkflow({
      workflowId: runId,
      signalName: 'executeToolCall',
      args: {
        callId,
        nodeId: tool.nodeId,
        componentId: tool.componentId,
        arguments: inputArgs,
        parameters: { ...(tool.parameters ?? {}), ...parameterOverrides },
        credentials: credentials ?? undefined,
        requestedAt: new Date().toISOString(),
      },
    });
    const result = await this.pollForToolCallResult(runId, callId);
    if (!result.success) throw new Error(result.error ?? 'Tool execution failed');
    return result.output;
  }

  private async pollForToolCallResult(
    runId: string,
    callId: string,
    timeoutMs = 60_000,
    pollIntervalMs = 500,
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const result = await this.temporalService.queryWorkflow({
          workflowId: runId,
          queryType: 'getToolCallResult',
          args: [callId],
        });
        if (result) {
          return result as { success: boolean; output?: unknown; error?: string };
        }
      } catch {
        // The legacy Workflow may be busy; keep polling until the bounded timeout.
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return { success: false, error: `Tool call timed out after ${timeoutMs}ms` };
  }

  private async logToolCall(
    runId: string,
    toolName: string,
    status: 'STARTED' | 'COMPLETED' | 'FAILED',
    nodeRef: string,
    details: { duration?: number; error?: unknown; output?: unknown } = {},
  ): Promise<void> {
    try {
      const sequence = (await this.traceRepository.getLastSequence(runId)) + 1;
      const type: TraceEventType = 'NODE_PROGRESS';
      await this.traceRepository.append({
        runId,
        type,
        nodeRef,
        timestamp: new Date().toISOString(),
        sequence,
        level: status === 'FAILED' ? 'error' : 'info',
        message: `Tool ${status}: ${toolName}`,
        error: details.error,
        outputSummary: details.output,
        data: details.duration ? { duration: details.duration, toolName } : { toolName },
      });
    } catch (error) {
      this.logger.error(`Failed to log tool call: ${error}`);
    }
  }
}

function externalSnapshotRegistrationDescriptor(
  descriptor: ToolDescriptor & {
    source: Extract<ToolDescriptor['source'], { kind: 'mcp' }>;
  },
): McpToolRegistrationDescriptor {
  return {
    name: descriptor.source.upstreamName,
    ...(descriptor.title !== undefined && { title: descriptor.title }),
    ...(descriptor.description !== undefined && { description: descriptor.description }),
    inputSchema: descriptor.inputSchema,
    ...(descriptor.outputSchema !== undefined && { outputSchema: descriptor.outputSchema }),
    ...(descriptor.icons !== undefined && { icons: descriptor.icons }),
    ...(descriptor.annotations !== undefined && { annotations: descriptor.annotations }),
    ...(descriptor.meta !== undefined && { _meta: descriptor.meta }),
  };
}

function isNodeAllowed(nodeId: string, allowedNodeIds: readonly string[]): boolean {
  return (
    allowedNodeIds.length === 0 ||
    allowedNodeIds.some((allowed) => nodeId === allowed || nodeId.startsWith(`${allowed}/`))
  );
}

function mcpToolError(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
