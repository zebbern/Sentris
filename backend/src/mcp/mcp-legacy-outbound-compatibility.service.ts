import { Injectable, Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { Client as LegacyMcpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyStreamableHttpClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  CallToolResult as LegacyCallToolResult,
  Tool as LegacyTool,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpToolRegistrationDescriptor } from '@sentris/shared';

import { ToolRegistryService, type RegisteredTool } from './tool-registry.service';

const CALL_TIMEOUT_MS = 30_000;
const MAX_CALL_ATTEMPTS = 3;

@Injectable()
export class McpLegacyOutboundCompatibilityService {
  private readonly logger = new Logger(McpLegacyOutboundCompatibilityService.name);
  private readonly clients = new Map<string, LegacyMcpClient>();
  private readonly pendingConnections = new Map<string, Promise<LegacyMcpClient>>();

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async discoverTools(
    runId: string,
    source: RegisteredTool,
  ): Promise<McpToolRegistrationDescriptor[]> {
    if (!source.endpoint) return [];

    let client: LegacyMcpClient | undefined;
    try {
      const headers = await this.getRequestHeaders(runId, source);
      client = await this.getOrCreateClient(runId, source.endpoint, headers);
      const response = await client.listTools();
      return (response.tools ?? []).map(convertLegacyDiscoveredTool);
    } catch (error) {
      this.logger.error(`Legacy MCP discovery failed for ${source.endpoint}: ${error}`);
      if (client) {
        await this.evictClient(this.clientKey(runId, source.endpoint), client);
      }
      return [];
    }
  }

  async callTool(
    runId: string,
    source: RegisteredTool,
    upstreamName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (!source.endpoint) {
      throw new Error(`Missing endpoint for external source ${source.toolName}`);
    }

    const headers = await this.getRequestHeaders(runId, source);
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_CALL_ATTEMPTS; attempt += 1) {
      let client: LegacyMcpClient | undefined;
      try {
        client = await this.getOrCreateClient(runId, source.endpoint, headers);
        const result = await Promise.race([
          client.callTool({ name: upstreamName, arguments: args }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Tool call timed out after ${CALL_TIMEOUT_MS}ms`)),
              CALL_TIMEOUT_MS,
            ),
          ),
        ]);
        return convertLegacyCallToolResult(result as LegacyCallToolResult);
      } catch (error) {
        lastError = error;
        this.logger.warn(`Legacy MCP tool call attempt ${attempt} failed: ${error}`);
        if (client) {
          await this.evictClient(this.clientKey(runId, source.endpoint), client);
        }
        if (attempt < MAX_CALL_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
        }
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : String(lastError));
  }

  async cleanupRun(runId: string): Promise<void> {
    const prefix = `${runId}\u0000`;
    const pending = [...this.pendingConnections.entries()].filter(([key]) =>
      key.startsWith(prefix),
    );
    await Promise.allSettled(pending.map(([, connection]) => connection));

    for (const [key, client] of [...this.clients.entries()]) {
      if (key.startsWith(prefix)) {
        await this.closeClient(key, client);
      }
    }
  }

  private async getOrCreateClient(
    runId: string,
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<LegacyMcpClient> {
    const key = this.clientKey(runId, endpoint);
    const existing = this.clients.get(key);
    if (existing) return existing;

    const pending = this.pendingConnections.get(key);
    if (pending) return pending;

    const connection = this.connectLegacyOutboundClient(endpoint, headers);
    this.pendingConnections.set(key, connection);
    try {
      const client = await connection;
      if (this.pendingConnections.get(key) === connection) {
        this.clients.set(key, client);
      }
      return client;
    } finally {
      if (this.pendingConnections.get(key) === connection) {
        this.pendingConnections.delete(key);
      }
    }
  }

  private async connectLegacyOutboundClient(
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<LegacyMcpClient> {
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
    return client;
  }

  private async getRequestHeaders(
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
      new Headers([[name, value]]);
      headers[name] = value;
    }
    return headers;
  }

  private clientKey(runId: string, endpoint: string): string {
    return `${runId}\u0000${endpoint}`;
  }

  private async evictClient(key: string, client: LegacyMcpClient): Promise<void> {
    await this.closeClient(key, client);
  }

  private async closeClient(key: string, client: LegacyMcpClient): Promise<void> {
    if (this.clients.get(key) !== client) return;
    this.clients.delete(key);
    await client.close().catch((error) => {
      this.logger.warn(`Failed to close legacy outbound client for ${key}: ${error}`);
    });
  }
}

function convertLegacyDiscoveredTool(tool: LegacyTool): McpToolRegistrationDescriptor {
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

function convertLegacyCallToolResult(result: LegacyCallToolResult): CallToolResult {
  return {
    content: result.content,
    ...(result._meta !== undefined && { _meta: result._meta }),
    ...(result.structuredContent !== undefined && {
      structuredContent: result.structuredContent,
    }),
    ...(result.isError !== undefined && { isError: result.isError }),
  };
}
