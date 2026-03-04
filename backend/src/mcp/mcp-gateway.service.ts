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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistryService, RegisteredTool } from './tool-registry.service';

/** Minimal shape shared by MCP-discovered tools and pre-discovered DB tools */
interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
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

  // Cache of servers per runId
  // NOTE: This is in-memory state for active sessions. Single-instance design.
  // SCALING LIMITATION: For horizontal scaling, implement one of:
  // - Redis pub/sub for cache invalidation across instances
  // - Sticky sessions via load balancer affinity (simplest)
  // - Stateful instances dedicated to MCP gateway
  private readonly servers = new Map<string, McpServer>();
  private readonly registeredToolNames = new Map<string, Set<string>>();

  // Raw JSON schemas keyed by proxied tool name. McpServer.registerTool() expects
  // Zod schemas, but external MCP servers provide raw JSON Schema. We store them here
  // and inject them via a custom ListTools handler after registration.
  private readonly externalToolSchemas = new Map<string, Record<string, unknown>>();

  // Persistent MCP client pool for external (proxied) tool calls.
  // Key: endpoint URL. The stdio-proxy is stateful and rejects re-initialization,
  // so we must reuse a single client per endpoint for the lifetime of the run.
  private readonly externalClients = new Map<string, Client>();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly temporalService: TemporalService,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
    private readonly mcpServersRepository: McpServersRepository,
  ) {}

  /**
   * Get or create an MCP Server instance for a specific workflow run
   * Key includes both runId and allowedNodeIds to support multiple agents with different tool scopes
   */
  async getServerForRun(
    runId: string,
    organizationId?: string | null,
    allowedTools?: string[],
    allowedNodeIds?: string[],
  ): Promise<McpServer> {
    // 1. Validate Access
    await this.validateRunAccess(runId, organizationId);

    // Cache key includes allowedNodeIds so different agents with different tool scopes get different servers
    // Escape commas to prevent cache key collisions (e.g., ['a,b', 'c'] vs ['a', 'b,c'])
    const escapeNodeId = (id: string): string => id.replace(/,/g, '\\,');
    const cacheKey =
      allowedNodeIds && allowedNodeIds.length > 0
        ? `${runId}:${allowedNodeIds.sort().map(escapeNodeId).join(',')}`
        : runId;

    this.logger.debug(
      `[getServerForRun] runId=${runId}, cacheKey=${cacheKey}, allowedNodeIds=${JSON.stringify(allowedNodeIds)}`,
    );

    const existing = this.servers.get(cacheKey);
    if (existing) {
      this.logger.debug(`[getServerForRun] Returning cached server for cacheKey=${cacheKey}`);
      return existing;
    }

    this.logger.debug(`[getServerForRun] Creating NEW server for cacheKey=${cacheKey}`);
    const server = new McpServer({
      name: 'sentris-flow-gateway',
      version: '1.0.0',
    });

    const toolSet = new Set<string>();
    this.registeredToolNames.set(cacheKey, toolSet);
    await this.registerTools(server, runId, allowedTools, allowedNodeIds, toolSet);
    this.logger.log(`[getServerForRun] Registered ${toolSet.size} tools for run ${runId}`);
    this.patchListToolsWithExternalSchemas(server);
    this.servers.set(cacheKey, server);

    return server;
  }

  /**
   * Refresh tool registrations for any cached servers for a run.
   * This is used when tools register after an MCP session has already initialized.
   */
  async refreshServersForRun(runId: string): Promise<void> {
    const matchingEntries = Array.from(this.servers.entries()).filter(
      ([key]) => key === runId || key.startsWith(`${runId}:`),
    );

    if (matchingEntries.length === 0) {
      return;
    }

    await Promise.all(
      matchingEntries.map(async ([cacheKey, server]) => {
        const allowedNodeIds =
          cacheKey === runId ? undefined : cacheKey.split(':').slice(1).join(':').split(',');
        const toolSet = this.registeredToolNames.get(cacheKey) ?? new Set<string>();
        this.registeredToolNames.set(cacheKey, toolSet);
        await this.registerTools(server, runId, undefined, allowedNodeIds, toolSet);
        this.patchListToolsWithExternalSchemas(server);
      }),
    );
  }

  private async validateRunAccess(runId: string, organizationId?: string | null) {
    const run = await this.workflowRunRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    if (organizationId && run.organizationId !== organizationId) {
      throw new ForbiddenException(`You do not have access to workflow run ${runId}`);
    }
  }

  /**
   * Override the ListTools handler to inject raw JSON schemas for external tools.
   * McpServer.registerTool() only accepts Zod schemas, but external MCP servers
   * provide raw JSON Schema. This patches the response to include actual schemas
   * so the AI model can see parameter definitions and pass correct arguments.
   */
  private patchListToolsWithExternalSchemas(server: McpServer): void {
    if (this.externalToolSchemas.size === 0) return;

    const schemasSnapshot = new Map(this.externalToolSchemas);

    // Access the low-level protocol Server to override the ListTools handler.
    // McpServer stores the underlying Server as `.server`.
    // `setRequestHandler` uses Map.set internally, safely replacing existing handlers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registeredTools = (server as any)._registeredTools as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { enabled: boolean; description?: string; annotations?: any; _meta?: any }
    >;

    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Object.entries(registeredTools)
        .filter(([, tool]) => tool.enabled)
        .map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: schemasSnapshot.get(name) ?? { type: 'object' as const },
          annotations: tool.annotations,
          _meta: tool._meta,
        })),
    }));
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
    runId: string,
    allowedTools?: string[],
    allowedNodeIds?: string[],
    registeredToolNames?: Set<string>,
  ) {
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

    // Filter by allowed tools if specified
    if (allowedTools && allowedTools.length > 0) {
      // Note: For external tools, we need to check the proxied name, so we can't filter sources yet.
      // We filter individual tools below.
      // For component tools, we can filter here.
      // But let's simplify and just filter inside the loops.
    }

    // 1. Register Internal Tools
    const internalTools = allRegistered.filter((t) => t.type === 'component');
    for (const tool of internalTools) {
      // Some tool-mode nodes are "providers" only (e.g. MCP groups) and should not be agent-callable.
      if (tool.exposedToAgent === false) {
        continue;
      }

      if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(tool.toolName)) {
        continue;
      }

      if (registeredToolNames?.has(tool.toolName)) {
        continue;
      }

      const component = tool.componentId ? componentRegistry.get(tool.componentId) : null;
      const inputShape = component ? getToolInputShape(component) : undefined;

      server.registerTool(
        tool.toolName,
        {
          description: tool.description,
          inputSchema: inputShape,
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
      registeredToolNames?.add(tool.toolName);
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
          tools = await this.discoverToolsFromEndpoint(source.endpoint);
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

          if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(proxiedName)) {
            this.logger.debug(`[registerTools]   Skipping ${proxiedName} - not in allowedTools`);
            continue;
          }

          if (registeredToolNames?.has(proxiedName)) {
            this.logger.debug(`[registerTools]   Skipping ${proxiedName} - already registered`);
            continue;
          }

          this.logger.debug(`[registerTools]   Registering tool: ${proxiedName}`);
          // Store raw JSON schema separately — McpServer.registerTool() expects Zod
          // schemas, but external tools provide raw JSON Schema. We inject schemas
          // via patchListToolsWithExternalSchemas() after registration.
          if (t.inputSchema) {
            this.externalToolSchemas.set(proxiedName, t.inputSchema);
          }
          server.registerTool(
            proxiedName,
            {
              description: t.description,
            },
            async (args: Record<string, unknown>) => {
              this.logger.debug(
                `[ToolCall] ${proxiedName} → ${t.name} | args: ${JSON.stringify(args)}`,
              );
              const startTime = Date.now();
              const nodeRef = `mcp:${proxiedName}`;
              await this.logToolCall(runId, proxiedName, 'STARTED', nodeRef);

              try {
                const result = await this.proxyCallToExternal(source, t.name, args);
                this.logger.debug(
                  `[ToolCall] ${proxiedName} result: ${JSON.stringify(result).slice(0, 200)}`,
                );

                await this.logToolCall(runId, proxiedName, 'COMPLETED', nodeRef, {
                  duration: Date.now() - startTime,
                  output: result,
                });
                return result;
              } catch (err) {
                await this.logToolCall(runId, proxiedName, 'FAILED', nodeRef, {
                  duration: Date.now() - startTime,
                  error: err,
                });
                throw err;
              }
            },
          );
          registeredToolNames?.add(proxiedName);
        }
      } catch (error) {
        this.logger.error(`Failed to fetch tools from external source ${source.toolName}:`, error);
      }
    }
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
   * We cache one client per endpoint and reuse it for both discovery and tool calls.
   */
  private async getOrCreateExternalClient(endpoint: string): Promise<Client> {
    const existing = this.externalClients.get(endpoint);
    if (existing) {
      return existing;
    }

    this.logger.debug(`[getOrCreateExternalClient] Creating new persistent client for ${endpoint}`);
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: {
        headers: {
          Accept: 'application/json, text/event-stream',
        },
      },
    });

    const client = new Client(
      { name: 'sentris-gateway-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.externalClients.set(endpoint, client);
    this.logger.debug(`[getOrCreateExternalClient] Client connected and cached for ${endpoint}`);
    return client;
  }

  /**
   * Discover tools on-the-fly from an MCP endpoint (for local-mcp type)
   * Uses the persistent client pool so the same connection is reused for later tool calls.
   */
  private async discoverToolsFromEndpoint(endpoint: string): Promise<DiscoveredTool[]> {
    try {
      this.logger.debug(`[discoverToolsFromEndpoint] START: endpoint=${endpoint}`);

      const client = await this.getOrCreateExternalClient(endpoint);
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
      return tools;
    } catch (error) {
      this.logger.error(`[discoverToolsFromEndpoint] FAILED for ${endpoint}: ${error}`);
      // If the client failed, remove it from cache so next attempt creates a fresh one
      this.externalClients.delete(endpoint);
      return [];
    }
  }

  /**
   * Proxies a tool call to an external MCP source using the persistent client pool.
   * The client is initialized once per endpoint and reused for all subsequent calls.
   */
  private async proxyCallToExternal(
    source: RegisteredTool,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (!source.endpoint) {
      throw new McpError(
        ErrorCode.InternalError,
        `Missing endpoint for external source ${source.toolName}`,
      );
    }

    const TIMEOUT_MS = 30000;
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const client = await this.getOrCreateExternalClient(source.endpoint);

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

        return result as CallToolResult;
      } catch (error) {
        lastError = error;
        this.logger.warn(`External tool call attempt ${attempt} failed: ${error}`);
        // Evict the broken client so next attempt creates a fresh one
        this.externalClients.delete(source.endpoint);
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError;
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

  /**
   * Cleanup server instance and external clients for a run
   */
  async cleanupRun(runId: string) {
    // Close MCP gateway server
    const server = this.servers.get(runId);
    if (server) {
      await server.close();
      this.servers.delete(runId);
    }

    // Close all cached external MCP clients
    // We close all of them since external endpoints are tied to the run's Docker containers
    const clientEntries = Array.from(this.externalClients.entries());
    for (const [endpoint, client] of clientEntries) {
      await client.close().catch((err) => {
        this.logger.warn(`Failed to close external client for ${endpoint}: ${err}`);
      });
      this.externalClients.delete(endpoint);
    }
  }
}
