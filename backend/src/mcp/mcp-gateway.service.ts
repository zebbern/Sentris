import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  componentRegistry,
  getActionInputIds,
  getExposedParameterIds,
  getToolInputShape,
} from '@sentris/component-sdk';
import {
  fromJsonSchema,
  McpServer,
  type CallToolResult,
  type Icon,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import { Client as LegacyMcpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyStreamableHttpClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  type CallToolResult as LegacyCallToolResult,
  type Tool as LegacyTool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolRegistryService, RegisteredTool } from './tool-registry.service';
import type { RunMcpRequestContext } from './run-mcp-request-context';

/** Minimal shape shared by MCP-discovered tools and pre-discovered DB tools */
interface DiscoveredTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  icons?: Icon[];
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

class McpToolNameCollisionError extends Error {
  constructor(toolName: string) {
    super(`MCP tool name collision: ${toolName}`);
    this.name = 'McpToolNameCollisionError';
  }
}

/**
 * Sanitize a string for use as a tool name component.
 * LLM providers (e.g. Anthropic) require tool names to match ^[a-zA-Z0-9_-]{1,128}$.
 * Replaces invalid characters with underscores and collapses consecutive underscores.
 */
function sanitizeToolNameSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

import { TemporalService } from '../temporal/temporal.service';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { TraceRepository } from '../trace/trace.repository';
import type { TraceEventType } from '../trace/types';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';

@Injectable()
export class McpGatewayService {
  private readonly logger = new Logger(McpGatewayService.name);

  // Transitional v1 outbound compatibility pool for proxied tool calls.
  // Key: `${runId}\0${endpoint}`. The stdio-proxy is stateful and rejects
  // re-initialization, so reuse clients within a run without crossing run boundaries.
  private readonly legacyOutboundClients = new Map<string, LegacyMcpClient>();
  private readonly pendingLegacyOutboundConnections = new Map<string, Promise<LegacyMcpClient>>();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly temporalService: TemporalService,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
    private readonly mcpServersRepository: McpServersRepository,
  ) {}

  async createServerForRun(context: RunMcpRequestContext): Promise<McpServer> {
    await this.validateRunAccess(context.runId, context.organizationId);

    const server = new McpServer({
      name: 'sentris-flow-gateway',
      version: '1.0.0',
    });

    const registeredToolNames = new Set<string>();
    await this.registerTools(server, context, registeredToolNames);
    this.logger.log(
      `[createServerForRun] Registered ${registeredToolNames.size} tools for run ${context.runId}`,
    );

    return server;
  }

  private async validateRunAccess(runId: string, organizationId?: string | null) {
    const run = await this.workflowRunRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    if (run.organizationId !== organizationId) {
      throw new ForbiddenException(`You do not have access to workflow run ${runId}`);
    }
  }

  private async logToolCall(
    runId: string,
    toolName: string,
    status: 'STARTED' | 'COMPLETED' | 'FAILED',
    nodeRef: string,
    details: { duration?: number; error?: unknown; output?: unknown } = {},
  ) {
    try {
      const lastSeq = await this.traceRepository.getLastSequence(runId);
      const sequence = lastSeq + 1;

      const type: TraceEventType = 'NODE_PROGRESS';
      // Map status to approximate node events for visualization,
      // though 'NODE_PROGRESS' is safer if we don't want to mess up graph state.
      // But ticket asks for logging.
      // 'NODE_PROGRESS' with message is good.

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
    } catch (err) {
      this.logger.error(`Failed to log tool call: ${err}`);
    }
  }

  /**
   * Register all available tools (internal and external) for this run
   */
  private async registerTools(
    server: McpServer,
    context: RunMcpRequestContext,
    registeredToolNames: Set<string>,
  ) {
    const { runId } = context;
    const allowedNodeIds = [...context.allowedNodeIds];
    this.logger.debug(
      `[registerTools] START: runId=${runId}, allowedNodeIds=${JSON.stringify(allowedNodeIds)}`,
    );
    const allRegistered = await this.toolRegistry.getToolsForRun(runId, allowedNodeIds);
    this.logger.debug(`[registerTools] getToolsForRun returned ${allRegistered.length} tools`);
    for (const t of allRegistered) {
      this.logger.debug(
        `[registerTools]   nodeId=${t.nodeId}, toolName=${t.toolName}, type=${t.type}, status=${t.status}, endpoint=${t.endpoint?.substring(0, 80) ?? 'none'}, exposedToAgent=${t.exposedToAgent}`,
      );
    }

    // 1. Register Internal Tools
    const internalTools = allRegistered.filter((t) => t.type === 'component');
    for (const tool of internalTools) {
      // Some tool-mode nodes are "providers" only (e.g. MCP groups) and should not be agent-callable.
      if (tool.exposedToAgent === false) {
        continue;
      }

      this.claimToolName(registeredToolNames, tool.toolName);

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
          const startTime = Date.now();
          await this.logToolCall(runId, tool.toolName, 'STARTED', tool.nodeId);

          try {
            const result = await this.callComponentTool(tool, runId, args ?? {});

            await this.logToolCall(runId, tool.toolName, 'COMPLETED', tool.nodeId, {
              duration: Date.now() - startTime,
              output: result,
            });

            // Signal Temporal that the tool call is completed
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
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            await this.logToolCall(runId, tool.toolName, 'FAILED', tool.nodeId, {
              duration: Date.now() - startTime,
              error: errorMessage,
            });

            // Signal Temporal that the tool call failed
            await this.temporalService.signalWorkflow({
              workflowId: runId,
              signalName: 'toolCallCompleted',
              args: {
                nodeRef: tool.nodeId,
                toolName: tool.toolName,
                output: null,
                status: 'failed',
                errorMessage,
              },
            });

            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: ${errorMessage}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    }

    // 2. Register External Tools (Proxied)
    const externalSources = allRegistered.filter((t) => t.type !== 'component');

    // DEBUG: Log all external sources for troubleshooting
    this.logger.debug(
      `[Gateway] Found ${externalSources.length} external sources for run ${runId}`,
    );
    for (const source of externalSources) {
      this.logger.debug(
        `[Gateway] External source: toolName=${source.toolName}, type=${source.type}, endpoint=${source.endpoint?.substring(0, 50)}, nodeId=${source.nodeId}`,
      );
    }

    // Filter by allowedNodeIds - support hierarchical node IDs with '/' separator
    // e.g., if allowedNodeIds includes 'aws-mcp-group', also include 'aws-mcp-group/aws-cloudtrail'
    // Also support legacy '-' separator for backward compatibility
    this.logger.debug(
      `[Gateway] Filtering ${externalSources.length} external sources with allowedNodeIds: ${allowedNodeIds?.join(', ') ?? 'none (allow all)'}`,
    );
    const filteredSources =
      allowedNodeIds && allowedNodeIds.length > 0
        ? externalSources.filter((source) => {
            // Direct match
            if (allowedNodeIds.includes(source.nodeId)) {
              this.logger.debug(
                `[Gateway] ✓ Including ${source.nodeId} (toolName=${source.toolName}) via direct match`,
              );
              return true;
            }
            // Hierarchical match with '/' separator (new format)
            // e.g., 'aws-mcp-group' matches 'aws-mcp-group/aws-cloudtrail'
            for (const allowedId of allowedNodeIds) {
              if (source.nodeId.startsWith(`${allowedId}/`)) {
                this.logger.debug(
                  `[Gateway] ✓ Including ${source.nodeId} (toolName=${source.toolName}) via hierarchical match with ${allowedId}`,
                );
                return true;
              }
            }
            this.logger.debug(
              `[Gateway] ✗ Excluding ${source.nodeId} (toolName=${source.toolName}) - no match in allowedNodeIds`,
            );
            return false;
          })
        : externalSources;

    this.logger.debug(`[registerTools] Processing ${filteredSources.length} external sources...`);
    for (const source of filteredSources) {
      try {
        let tools: DiscoveredTool[] = [];

        // First, check Redis for pre-discovered tools (from registerMcpServer API)
        this.logger.debug(
          `[registerTools] External source: nodeId=${source.nodeId}, toolName=${source.toolName}, type=${source.type}, endpoint=${source.endpoint?.substring(0, 80) ?? 'none'}`,
        );
        const preDiscoveredTools = await this.toolRegistry.getServerTools(runId, source.nodeId);
        this.logger.debug(
          `[registerTools]   preDiscoveredTools from Redis: ${preDiscoveredTools ? preDiscoveredTools.length : 'null'}`,
        );
        if (preDiscoveredTools && preDiscoveredTools.length > 0) {
          this.logger.debug(
            `[registerTools]   Using ${preDiscoveredTools.length} pre-discovered tools from Redis for ${source.toolName}`,
          );
          tools = preDiscoveredTools;
        } else if (source.type === 'mcp-server' || source.type === 'local-mcp') {
          // Fallback: discover tools on-the-fly from endpoint
          if (!source.endpoint) {
            this.logger.warn(
              `[registerTools]   MCP tool ${source.toolName} has no endpoint - skipping.`,
            );
            continue;
          }
          this.logger.debug(
            `[registerTools]   FALLBACK: Discovering tools from endpoint: ${source.endpoint}`,
          );
          tools = await this.discoverToolsFromEndpoint(runId, source);
          this.logger.debug(
            `[registerTools]   FALLBACK result: discovered ${tools.length} tools from ${source.toolName}`,
          );
          if (tools.length > 0) {
            this.logger.debug(
              `[registerTools]   FALLBACK tool names: ${tools.map((t) => t.name).join(', ')}`,
            );
          }
        } else {
          // Remote MCPs must have a serverId (pre-registered in database)
          if (!source.serverId) {
            this.logger.warn(
              `[registerTools]   External tool ${source.toolName} has no serverId - skipping.`,
            );
            continue;
          }
          this.logger.debug(
            `[registerTools]   Loading pre-discovered tools from DB for serverId=${source.serverId}`,
          );
          tools = await this.getPreDiscoveredTools(source.serverId);
          this.logger.debug(`[registerTools]   DB result: ${tools.length} tools`);
        }

        const prefix = sanitizeToolNameSegment(source.toolName);
        this.logger.debug(
          `[registerTools]   Registering ${tools.length} tools with prefix '${prefix}'`,
        );

        for (const t of tools) {
          const proxiedName = `${prefix}__${sanitizeToolNameSegment(t.name)}`;
          this.claimToolName(registeredToolNames, proxiedName);

          this.logger.debug(`[registerTools]   Registering tool: ${proxiedName}`);
          const inputSchema = fromJsonSchema<Record<string, unknown>>(
            t.inputSchema ?? { type: 'object' },
          );
          const outputSchema = t.outputSchema
            ? fromJsonSchema<Record<string, unknown>>(t.outputSchema)
            : undefined;
          server.registerTool(
            proxiedName,
            {
              title: t.title,
              description: t.description,
              inputSchema,
              outputSchema,
              icons: t.icons,
              annotations: t.annotations,
              _meta: t._meta,
            },
            async (args: Record<string, unknown>) => {
              this.logger.debug(
                `[ToolCall] ${proxiedName} → ${t.name} | args: ${JSON.stringify(args)}`,
              );
              const startTime = Date.now();
              const nodeRef = `mcp:${proxiedName}`;
              await this.logToolCall(runId, proxiedName, 'STARTED', nodeRef);

              try {
                const result = await this.proxyCallToExternal(runId, source, t.name, args);
                this.logger.debug(
                  `[ToolCall] ${proxiedName} result: ${JSON.stringify(result).slice(0, 200)}`,
                );

                await this.logToolCall(runId, proxiedName, 'COMPLETED', nodeRef, {
                  duration: Date.now() - startTime,
                  output: result,
                });
                return this.convertLegacyCallToolResult(result);
              } catch (err) {
                await this.logToolCall(runId, proxiedName, 'FAILED', nodeRef, {
                  duration: Date.now() - startTime,
                  error: err,
                });
                throw this.normalizeLegacyOutboundError(err);
              }
            },
          );
        }
      } catch (error) {
        if (error instanceof McpToolNameCollisionError) {
          throw error;
        }
        this.logger.error(`Failed to fetch tools from external source ${source.toolName}:`, error);
      }
    }
  }

  private claimToolName(registeredToolNames: Set<string>, toolName: string): void {
    if (registeredToolNames.has(toolName)) {
      throw new McpToolNameCollisionError(toolName);
    }
    registeredToolNames.add(toolName);
  }

  /**
   * Get pre-discovered tools from the database for a registered MCP server
   */
  private async getPreDiscoveredTools(serverId: string): Promise<DiscoveredTool[]> {
    try {
      const toolRecords = await this.mcpServersRepository.listTools(serverId);
      return toolRecords
        .filter((t) => t.enabled)
        .map((t) => ({
          name: t.toolName,
          description: t.description ?? undefined,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? undefined,
        }));
    } catch (error) {
      this.logger.error(`Failed to load pre-discovered tools for server ${serverId}:`, error);
      return [];
    }
  }

  /**
   * Get or create a persistent MCP client for an external endpoint.
   * The stdio-proxy is stateful: once initialized, it rejects subsequent initialize requests.
   * We cache one client per run and endpoint and reuse it for both discovery and tool calls.
   */
  private async getOrCreateLegacyOutboundClient(
    runId: string,
    endpoint: string,
    headers: Record<string, string> = {},
  ): Promise<LegacyMcpClient> {
    const clientKey = this.getLegacyOutboundClientKey(runId, endpoint);
    const existing = this.legacyOutboundClients.get(clientKey);
    if (existing) {
      return existing;
    }

    const pending = this.pendingLegacyOutboundConnections.get(clientKey);
    if (pending) {
      return pending;
    }

    const connection = this.connectLegacyOutboundClient(endpoint, headers);
    this.pendingLegacyOutboundConnections.set(clientKey, connection);
    try {
      const client = await connection;
      this.legacyOutboundClients.set(clientKey, client);
      return client;
    } finally {
      this.pendingLegacyOutboundConnections.delete(clientKey);
    }
  }

  private async connectLegacyOutboundClient(
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<LegacyMcpClient> {
    this.logger.debug(
      `[getOrCreateLegacyOutboundClient] Creating persistent v1 client for ${endpoint}`,
    );
    const transport = new LegacyStreamableHttpClientTransport(new URL(endpoint), {
      requestInit: {
        headers: {
          ...headers,
          Accept: 'application/json, text/event-stream',
        },
      },
    });
    const client = new LegacyMcpClient(
      { name: 'sentris-gateway-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.logger.debug(`[getOrCreateLegacyOutboundClient] v1 client connected for ${endpoint}`);
    return client;
  }

  private async getExternalRequestHeaders(
    runId: string,
    source: RegisteredTool,
  ): Promise<Record<string, string>> {
    const credentials = await this.toolRegistry.getToolCredentials(runId, source.nodeId);
    if (!credentials) return {};

    if (typeof credentials.authToken === 'string' && Object.keys(credentials).length === 1) {
      return { Authorization: `Bearer ${credentials.authToken}` };
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(credentials)) {
      if (typeof value !== 'string') {
        throw new Error(`MCP request header "${name}" must be a string`);
      }
      // Let the platform Headers implementation reject invalid names/values
      // before a persistent client is created.
      new Headers([[name, value]]);
      headers[name] = value;
    }
    return headers;
  }

  private getLegacyOutboundClientKey(runId: string, endpoint: string): string {
    return `${runId}\u0000${endpoint}`;
  }

  private async evictLegacyOutboundClient(clientKey: string): Promise<void> {
    const client = this.legacyOutboundClients.get(clientKey);
    if (client) {
      await this.closeLegacyOutboundClient(clientKey, client);
    }
  }

  /**
   * Discover tools on-the-fly from an MCP endpoint (for local-mcp type)
   * Uses the persistent client pool so the same connection is reused for later tool calls.
   */
  private async discoverToolsFromEndpoint(
    runId: string,
    source: RegisteredTool,
  ): Promise<DiscoveredTool[]> {
    const endpoint = source.endpoint;
    if (!endpoint) return [];
    try {
      this.logger.debug(`[discoverToolsFromEndpoint] START: endpoint=${endpoint}`);

      const headers = await this.getExternalRequestHeaders(runId, source);
      const client = await this.getOrCreateLegacyOutboundClient(runId, endpoint, headers);
      const res = await client.listTools();

      const tools = res.tools ?? [];
      this.logger.debug(
        `[discoverToolsFromEndpoint] Discovered ${tools.length} tool(s) from ${endpoint}`,
      );
      if (tools.length > 0) {
        this.logger.debug(
          `[discoverToolsFromEndpoint] Tool names: ${tools.map((t) => t.name).join(', ')}`,
        );
      }
      return tools.map((tool) => this.convertLegacyDiscoveredTool(tool));
    } catch (error) {
      this.logger.error(`[discoverToolsFromEndpoint] FAILED for ${endpoint}: ${error}`);
      // If the client failed, remove it from cache so next attempt creates a fresh one
      await this.evictLegacyOutboundClient(this.getLegacyOutboundClientKey(runId, endpoint));
      return [];
    }
  }

  /**
   * Proxies a tool call to an external MCP source using the persistent client pool.
   * The client is initialized once per endpoint and reused for all subsequent calls.
   */
  private async proxyCallToExternal(
    runId: string,
    source: RegisteredTool,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<LegacyCallToolResult> {
    if (!source.endpoint) {
      throw new Error(`Missing endpoint for external source ${source.toolName}`);
    }

    const TIMEOUT_MS = 30000;
    const MAX_RETRIES = 3;
    let lastError: unknown;
    const headers = await this.getExternalRequestHeaders(runId, source);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const client = await this.getOrCreateLegacyOutboundClient(runId, source.endpoint, headers);

        const result = await Promise.race([
          client.callTool({
            name: toolName,
            arguments: args,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Tool call timed out after ${TIMEOUT_MS}ms`)),
              TIMEOUT_MS,
            ),
          ),
        ]);

        return result as LegacyCallToolResult;
      } catch (error) {
        lastError = error;
        this.logger.warn(`External tool call attempt ${attempt} failed: ${error}`);
        // Evict the broken client so next attempt creates a fresh one
        await this.evictLegacyOutboundClient(
          this.getLegacyOutboundClientKey(runId, source.endpoint),
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError;
  }

  private convertLegacyDiscoveredTool(tool: LegacyTool): DiscoveredTool {
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
      icons: tool.icons?.map((icon) => ({ ...icon })),
      annotations: tool.annotations ? { ...tool.annotations } : undefined,
      _meta: tool._meta ? { ...tool._meta } : undefined,
    };
  }

  private convertLegacyCallToolResult(result: LegacyCallToolResult): CallToolResult {
    return {
      content: result.content,
      ...(result._meta !== undefined && { _meta: result._meta }),
      ...(result.structuredContent !== undefined && {
        structuredContent: result.structuredContent,
      }),
      ...(result.isError !== undefined && { isError: result.isError }),
    };
  }

  private normalizeLegacyOutboundError(error: unknown): Error {
    return new Error(error instanceof Error ? error.message : String(error));
  }

  /**
   * Internal handler for executing component-based tools via Temporal workflow
   */
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
    const exposedParamIds = component ? getExposedParameterIds(component) : [];
    const exposedParamSet = new Set(exposedParamIds);

    const inputArgs: Record<string, unknown> = {};
    const paramOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args ?? {})) {
      if (exposedParamSet.has(key) && !actionInputIds.has(key)) {
        paramOverrides[key] = value;
      } else {
        inputArgs[key] = value;
      }
    }

    // Resolve credentials from registry
    const credentials = await this.toolRegistry.getToolCredentials(runId, tool.nodeId);

    const mergedParams = { ...(tool.parameters ?? {}), ...paramOverrides };

    // Generate a unique call ID for this tool invocation
    const callId = `${runId}:${tool.nodeId}:${Date.now()}`;

    // Signal the workflow to execute the tool
    await this.temporalService.signalWorkflow({
      workflowId: runId,
      signalName: 'executeToolCall',
      args: {
        callId,
        nodeId: tool.nodeId,
        componentId: tool.componentId,
        arguments: inputArgs,
        parameters: mergedParams,
        credentials: credentials ?? undefined,
        requestedAt: new Date().toISOString(),
      },
    });

    // Poll for the result via workflow query
    // The workflow will execute the component and store the result
    const result = await this.pollForToolCallResult(runId, callId);

    if (!result.success) {
      throw new Error(result.error ?? 'Tool execution failed');
    }

    return result.output;
  }

  /**
   * Poll the workflow for a tool call result
   */
  private async pollForToolCallResult(
    runId: string,
    callId: string,
    timeoutMs = 60000,
    pollIntervalMs = 500,
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Query the workflow for tool call results
        const result = await this.temporalService.queryWorkflow({
          workflowId: runId,
          queryType: 'getToolCallResult',
          args: [callId],
        });

        if (result) {
          return result as { success: boolean; output?: unknown; error?: string };
        }
      } catch (_error) {
        // Query might fail if workflow is busy, continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { success: false, error: `Tool call timed out after ${timeoutMs}ms` };
  }

  /** Cleanup the transitional v1 outbound client pool for one run. */
  async cleanupRun(runId: string) {
    const clientKeyPrefix = `${runId}\u0000`;
    const pending = [...this.pendingLegacyOutboundConnections.entries()].filter(([clientKey]) =>
      clientKey.startsWith(clientKeyPrefix),
    );
    await Promise.allSettled(pending.map(([, connection]) => connection));

    for (const [clientKey, client] of [...this.legacyOutboundClients.entries()]) {
      if (!clientKey.startsWith(clientKeyPrefix)) continue;
      await this.closeLegacyOutboundClient(clientKey, client);
    }
  }

  private async closeLegacyOutboundClient(
    clientKey: string,
    client: LegacyMcpClient,
  ): Promise<void> {
    if (this.legacyOutboundClients.get(clientKey) !== client) return;
    this.legacyOutboundClients.delete(clientKey);
    await client.close().catch((err) => {
      this.logger.warn(`Failed to close legacy outbound client for ${clientKey}: ${err}`);
    });
  }
}
