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
import type { McpToolRegistrationDescriptor } from '@sentris/shared';
import { z } from 'zod';

import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
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
import type { RunMcpRequestContext } from './run-mcp-request-context';
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
  ) {}

  async createServerForRun(context: RunMcpRequestContext): Promise<McpServer> {
    await this.validateRunAccess(context.runId, context.organizationId);
    const server = new McpServer({ name: 'sentris-flow-gateway', version: '1.0.0' });
    const registeredToolNames = new Set<string>();
    await this.registerTools(server, context, registeredToolNames);
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

  private async registerTools(
    server: McpServer,
    context: RunMcpRequestContext,
    registeredToolNames: Set<string>,
  ): Promise<void> {
    const allowedNodeIds = [...context.allowedNodeIds];
    const registered = await this.toolRegistry.getToolsForRun(context.runId, allowedNodeIds);

    for (const tool of registered.filter((candidate) => candidate.type === 'component')) {
      if (tool.exposedToAgent === false) continue;
      claimMcpToolName(registeredToolNames, tool.toolName);
      this.registerComponentTool(server, context.runId, tool);
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
          this.registerExternalTool(server, context.runId, source, upstream, canonicalName);
        }
      } catch (error) {
        if (error instanceof McpToolNameCollisionError) throw error;
        this.logger.error(`Failed to fetch tools from external source ${source.toolName}:`, error);
      }
    }
  }

  private registerComponentTool(server: McpServer, runId: string, tool: RegisteredTool): void {
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

  private registerExternalTool(
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

function isNodeAllowed(nodeId: string, allowedNodeIds: readonly string[]): boolean {
  return (
    allowedNodeIds.length === 0 ||
    allowedNodeIds.some((allowed) => nodeId === allowed || nodeId.startsWith(`${allowed}/`))
  );
}
