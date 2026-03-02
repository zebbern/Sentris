import { Injectable, BadRequestException, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository, type McpServerUpdateData } from './mcp-servers.repository';
import { TemporalService } from '../temporal/temporal.service';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import type {
  CreateMcpServerDto,
  UpdateMcpServerDto,
  McpServerResponse,
  McpToolResponse,
  TransportType,
  HealthStatus,
} from './dto/mcp-servers.dto';
import type { McpServerRecord, McpServerToolRecord } from '../database/schema';
import { SecretResolver } from '../secrets/secret-resolver';
import type { TemporalTaskConfig } from '../config';

// Redis injection token - defined as const to avoid circular dependency
const MCP_SERVERS_REDIS = 'MCP_SERVERS_REDIS';

@Injectable()
export class McpServersService {
  private readonly logger = new Logger(McpServersService.name);

  constructor(
    private readonly repository: McpServersRepository,
    private readonly encryption: McpServersEncryptionService,
    private readonly secretResolver: SecretResolver,
    @Optional() @Inject(MCP_SERVERS_REDIS) private readonly redis: Redis | null,
    @Optional() private readonly temporalService: TemporalService | null,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  private mapServerToResponse(
    record: McpServerRecord,
    headerKeys?: string[] | null,
  ): McpServerResponse {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      transportType: record.transportType as TransportType,
      endpoint: record.endpoint,
      command: record.command,
      args: this.redactSensitiveArgs(record.args),
      hasHeaders: record.headers !== null,
      headerKeys: headerKeys ?? null,
      enabled: record.enabled,
      healthCheckUrl: record.healthCheckUrl,
      lastHealthCheck: record.lastHealthCheck?.toISOString() ?? null,
      lastHealthStatus: record.lastHealthStatus as HealthStatus | null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      groupId: record.groupId ?? null,
    };
  }

  /**
   * Redact values from Docker `-e KEY=VALUE` args that look like secrets.
   */
  private redactSensitiveArgs(args: string[] | null): string[] | null {
    if (!args) return null;
    const SECRET_KEY_PATTERN = /(?:secret|password|token|key|api_key|apikey|auth|credential)/i;
    return args.map((arg, index) => {
      if (index > 0 && args[index - 1] === '-e') {
        const eqIndex = arg.indexOf('=');
        if (eqIndex > 0) {
          const envKey = arg.substring(0, eqIndex);
          if (SECRET_KEY_PATTERN.test(envKey)) {
            return `${envKey}=***REDACTED***`;
          }
        }
      }
      return arg;
    });
  }

  /**
   * Extract header keys from encrypted headers without exposing values
   */
  private async extractHeaderKeys(headers: McpServerRecord['headers']): Promise<string[] | null> {
    if (!headers) return null;
    try {
      const decrypted = await this.encryption.decryptHeaders({
        ciphertext: headers.ciphertext,
        iv: headers.iv,
        authTag: headers.authTag,
        keyId: headers.keyId,
      });
      return Object.keys(decrypted);
    } catch (error) {
      this.logger.warn('Failed to extract header keys', error);
      return null;
    }
  }

  private mapToolToResponse(
    record: McpServerToolRecord & { serverName?: string },
    serverName?: string,
  ): McpToolResponse {
    return {
      id: record.id,
      toolName: record.toolName,
      description: record.description,
      inputSchema: record.inputSchema,
      serverId: record.serverId,
      serverName: record.serverName ?? serverName ?? 'Unknown',
      enabled: record.enabled,
      discoveredAt: record.discoveredAt.toISOString(),
    };
  }

  // --- Registry integration helpers ---

  /**
   * Find a server by its registry source name within an organization.
   * Used by McpRegistryService for duplicate detection during import.
   */
  async findByRegistrySource(
    registrySourceName: string,
    organizationId: string,
  ): Promise<McpServerRecord | null> {
    return this.repository.findByRegistrySource(registrySourceName, organizationId);
  }

  /**
   * Set the registry source name on an existing server.
   */
  async setRegistrySourceName(serverId: string, registrySourceName: string): Promise<void> {
    return this.repository.setRegistrySourceName(serverId, registrySourceName);
  }

  /**
   * List distinct registry source names for an organization.
   * Efficient query that returns only the names, not full server records.
   */
  async listRegistrySourceNames(organizationId: string): Promise<string[]> {
    return this.repository.listRegistrySourceNames(organizationId);
  }

  async listServers(
    auth: AuthContext | null,
    options?: { groupId?: string | null },
  ): Promise<McpServerResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const servers = await this.repository.list({
      organizationId,
      groupId: options?.groupId ?? undefined,
    });
    return servers.map((s) => this.mapServerToResponse(s));
  }

  async listEnabledServers(
    auth: AuthContext | null,
    options?: { groupId?: string | null },
  ): Promise<McpServerResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const servers = await this.repository.listEnabled({
      organizationId,
      groupId: options?.groupId ?? undefined,
    });
    return servers.map((s) => this.mapServerToResponse(s));
  }

  async getServer(auth: AuthContext | null, id: string): Promise<McpServerResponse> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });
    // Extract header keys for single server fetch (used in edit UI)
    const headerKeys = await this.extractHeaderKeys(server.headers);
    return this.mapServerToResponse(server, headerKeys);
  }

  async createServer(
    auth: AuthContext | null,
    input: CreateMcpServerDto,
  ): Promise<McpServerResponse> {
    const organizationId = requireOrganizationId(auth);

    // Validate transport-specific requirements
    this.validateTransportConfig(input);

    // Encrypt headers if provided
    let encryptedHeaders: {
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
    } | null = null;

    if (input.headers && Object.keys(input.headers).length > 0) {
      const material = await this.encryption.encryptHeaders(input.headers);
      encryptedHeaders = {
        ciphertext: material.ciphertext,
        iv: material.iv,
        authTag: material.authTag,
        keyId: material.keyId,
      };
    }

    // Check for existing server with same name in this organization
    const existingServers = await this.repository.list({ organizationId });
    const duplicateName = existingServers.find((s) => s.name === input.name.trim());
    if (duplicateName) {
      throw new BadRequestException(
        `An MCP server with the name "${input.name.trim()}" already exists. Please use a different name or delete the existing server first.`,
      );
    }

    const server = await this.repository.create({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      transportType: input.transportType,
      endpoint: input.endpoint || null,
      command: input.command || null,
      args: input.args || null,
      headers: encryptedHeaders,
      healthCheckUrl: input.healthCheckUrl || null,
      enabled: input.enabled ?? true,
      organizationId,
      createdBy: auth?.userId || null,
    });

    // If cacheToken provided, check Redis for cached discovery results
    if (input.cacheToken && this.redis) {
      try {
        const cached = await this.getCachedDiscovery(input.cacheToken);
        if (cached) {
          if (cached.tools.length > 0) {
            this.logger.log(
              `Creating server ${server.id} with ${cached.tools.length} cached tools`,
            );
            await this.repository.upsertTools(
              server.id,
              cached.tools.map((tool) => ({
                toolName: tool.name,
                description: tool.description ?? null,
                inputSchema: tool.inputSchema ?? null,
              })),
            );
          }
          // Mark healthy when discovery completed (even if tool count is 0)
          await this.repository.updateHealthStatus(server.id, 'healthy', { organizationId });
          // Delete cache after use
          await this.redis.del(`mcp-discovery:${input.cacheToken}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to load cached discovery for ${input.cacheToken}:`, error);
        // Don't fail server creation if cache is invalid
      }
    }

    // Return header keys from input (we know the keys since we just created with them)
    const headerKeys = input.headers ? Object.keys(input.headers) : null;

    this.auditLogService.record(auth, {
      action: 'mcp_server.create',
      resourceType: 'mcp_server',
      resourceId: server.id,
      resourceName: server.name,
      metadata: { transportType: server.transportType },
    });

    return this.mapServerToResponse(server, headerKeys);
  }

  /**
   * Get cached discovery results from Redis
   */
  private async getCachedDiscovery(cacheToken: string): Promise<{
    tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
    toolCount: number;
  } | null> {
    if (!this.redis) {
      return null;
    }
    const key = `mcp-discovery:${cacheToken}`;
    const value = await this.redis.get(key);
    if (!value) {
      return null;
    }
    const cached = JSON.parse(value);
    if (cached.status !== 'completed') {
      return null;
    }
    return {
      tools: cached.tools,
      toolCount: cached.toolCount,
    };
  }

  async updateServer(
    auth: AuthContext | null,
    id: string,
    input: UpdateMcpServerDto,
  ): Promise<McpServerResponse> {
    const organizationId = requireOrganizationId(auth);

    // Get current server to validate transport changes
    const current = await this.repository.findById(id, { organizationId });

    // If transport type is changing, validate the new config
    const effectiveTransportType = input.transportType ?? current.transportType;
    const effectiveEndpoint = input.endpoint !== undefined ? input.endpoint : current.endpoint;
    const effectiveCommand = input.command !== undefined ? input.command : current.command;

    if (
      input.transportType !== undefined ||
      input.endpoint !== undefined ||
      input.command !== undefined
    ) {
      this.validateTransportConfig({
        transportType: effectiveTransportType as TransportType,
        endpoint: effectiveEndpoint ?? undefined,
        command: effectiveCommand ?? undefined,
      });
    }

    const updates: McpServerUpdateData = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('Server name cannot be empty');
      }
      updates.name = trimmed;
    }

    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }

    if (input.transportType !== undefined) {
      updates.transportType = input.transportType;
    }

    if (input.endpoint !== undefined) {
      updates.endpoint = input.endpoint;
    }

    if (input.command !== undefined) {
      updates.command = input.command;
    }

    if (input.args !== undefined) {
      updates.args = input.args;
    }

    if (input.headers !== undefined) {
      if (input.headers === null) {
        updates.headers = null;
      } else if (Object.keys(input.headers).length > 0) {
        const material = await this.encryption.encryptHeaders(input.headers);
        updates.headers = {
          ciphertext: material.ciphertext,
          iv: material.iv,
          authTag: material.authTag,
          keyId: material.keyId,
        };
      }
    }

    if (input.healthCheckUrl !== undefined) {
      updates.healthCheckUrl = input.healthCheckUrl;
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    if (Object.keys(updates).length === 0) {
      const headerKeys = await this.extractHeaderKeys(current.headers);
      return this.mapServerToResponse(current, headerKeys);
    }

    const server = await this.repository.update(id, updates, { organizationId });

    // Determine header keys for response
    let headerKeys: string[] | null = null;
    if (input.headers !== undefined) {
      // Headers were explicitly set in this update
      headerKeys = input.headers ? Object.keys(input.headers) : null;
    } else {
      // Headers unchanged, extract from existing
      headerKeys = await this.extractHeaderKeys(server.headers);
    }

    this.auditLogService.record(auth, {
      action: 'mcp_server.update',
      resourceType: 'mcp_server',
      resourceId: server.id,
      resourceName: server.name,
      metadata: { transportType: server.transportType },
    });

    return this.mapServerToResponse(server, headerKeys);
  }

  async toggleServer(auth: AuthContext | null, id: string): Promise<McpServerResponse> {
    const organizationId = requireOrganizationId(auth);
    const current = await this.repository.findById(id, { organizationId });
    const server = await this.repository.update(
      id,
      { enabled: !current.enabled },
      { organizationId },
    );

    this.auditLogService.record(auth, {
      action: 'mcp_server.toggle',
      resourceType: 'mcp_server',
      resourceId: server.id,
      resourceName: server.name,
      metadata: { enabled: server.enabled },
    });

    return this.mapServerToResponse(server);
  }

  async deleteServer(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });
    await this.repository.delete(id, { organizationId });

    this.auditLogService.record(auth, {
      action: 'mcp_server.delete',
      resourceType: 'mcp_server',
      resourceId: server.id,
      resourceName: server.name,
      metadata: { transportType: server.transportType },
    });
  }

  async getServerWithDecryptedHeaders(
    auth: AuthContext | null,
    id: string,
  ): Promise<{ server: McpServerRecord; headers: Record<string, string> | null }> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });

    let headers: Record<string, string> | null = null;
    if (server.headers) {
      headers = await this.encryption.decryptHeaders({
        ciphertext: server.headers.ciphertext,
        iv: server.headers.iv,
        authTag: server.headers.authTag,
        keyId: server.headers.keyId,
      });
    }

    return { server, headers };
  }

  // Tool management

  async getServerTools(auth: AuthContext | null, serverId: string): Promise<McpToolResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(serverId, { organizationId });
    const tools = await this.repository.listTools(serverId);
    return tools.map((t) => this.mapToolToResponse(t, server.name));
  }

  async getAllTools(auth: AuthContext | null): Promise<McpToolResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const tools = await this.repository.listAllToolsForOrganization({ organizationId });
    return tools.map((t) => this.mapToolToResponse(t));
  }

  async updateServerTools(
    auth: AuthContext | null,
    serverId: string,
    tools: {
      toolName: string;
      description?: string | null;
      inputSchema?: Record<string, unknown> | null;
    }[],
  ): Promise<McpToolResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(serverId, { organizationId });
    const updated = await this.repository.upsertTools(serverId, tools);
    return updated.map((t) => this.mapToolToResponse(t, server.name));
  }

  async toggleToolEnabled(
    auth: AuthContext | null,
    serverId: string,
    toolId: string,
  ): Promise<McpToolResponse> {
    const organizationId = requireOrganizationId(auth);
    // Verify server belongs to organization
    const server = await this.repository.findById(serverId, { organizationId });
    const tool = await this.repository.toggleToolEnabled(toolId);
    return this.mapToolToResponse(tool, server.name);
  }

  async updateHealthStatus(
    auth: AuthContext | null,
    serverId: string,
    status: 'healthy' | 'unhealthy' | 'unknown',
  ): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    await this.repository.updateHealthStatus(serverId, status, { organizationId });
  }

  async getHealthStatuses(
    auth: AuthContext | null,
  ): Promise<{ serverId: string; status: HealthStatus; checkedAt: string | null }[]> {
    const organizationId = requireOrganizationId(auth);
    const servers = await this.repository.listEnabled({ organizationId });
    return servers.map((s) => ({
      serverId: s.id,
      status: (s.lastHealthStatus as HealthStatus) ?? 'unknown',
      checkedAt: s.lastHealthCheck?.toISOString() ?? null,
    }));
  }

  /**
   * Test connection to an MCP server.
   * - HTTP: Direct MCP protocol test (fast, validates endpoint is reachable)
   * - STDIO: Uses Temporal workflow to properly test via worker (spawns container, tests, cleans up)
   *
   * Health status is persisted to the database and returned with server data.
   * Tools are discovered and saved to database during test.
   */
  async testServerConnection(
    auth: AuthContext | null,
    id: string,
  ): Promise<{
    success: boolean;
    message: string;
    toolCount?: number;
  }> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });

    // Validate that the server has a valid configuration for its transport type
    try {
      this.validateTransportConfig({
        transportType: server.transportType as TransportType,
        endpoint: server.endpoint,
        command: server.command,
      });

      // For HTTP: do actual connection test
      if (server.transportType === 'http') {
        return await this.testHttpConnectionDirect(server);
      }

      // For STDIO: use Temporal workflow to properly test via worker
      if (!this.temporalService) {
        throw new Error('TemporalService not available - cannot test stdio servers');
      }

      this.logger.log(`Testing stdio server ${server.id} via Temporal workflow`);

      // Start discovery workflow
      const temporalCfg = this.configService.get<TemporalTaskConfig>('temporalTask')!;
      const workflowResult = await this.temporalService.startWorkflow({
        workflowType: 'mcpDiscoveryWorkflow',
        taskQueue: temporalCfg.taskQueue,
        args: [
          {
            transport: 'stdio',
            name: server.name,
            command: server.command,
            args: server.args,
          } as const,
        ],
      });

      // Wait for workflow to complete (with timeout)
      const WORKFLOW_TIMEOUT_MS = 60_000;
      try {
        await Promise.race([
          this.temporalService.getWorkflowResult({
            workflowId: workflowResult.workflowId,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Connection test timed out after 60 seconds')),
              WORKFLOW_TIMEOUT_MS,
            ),
          ),
        ]);

        // Discovery succeeded - tools are already saved by the workflow
        await this.repository.updateHealthStatus(id, 'healthy', {});
        const tools = await this.repository.listTools(id);
        return {
          success: true,
          message: `Connection successful (${tools.length} tools discovered)`,
          toolCount: tools.length,
        };
      } catch (workflowError) {
        await this.repository.updateHealthStatus(id, 'unhealthy', {});
        const errorMessage =
          workflowError instanceof Error ? workflowError.message : 'Connection test failed';
        const isTimeout = errorMessage.includes('timed out');
        return {
          success: false,
          message: isTimeout ? errorMessage : 'Connection test failed - check server configuration',
        };
      }
    } catch (error) {
      // Update health status to unhealthy (configuration is invalid or test failed)
      await this.repository.updateHealthStatus(id, 'unhealthy', { organizationId });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      };
    }
  }

  /**
   * Direct HTTP connection test
   */
  private async testHttpConnectionDirect(server: McpServerRecord): Promise<{
    success: boolean;
    message: string;
    toolCount?: number;
  }> {
    try {
      // Decrypt headers
      let headers: Record<string, string> | null = null;
      if (server.headers) {
        headers = await this.encryption.decryptHeaders({
          ciphertext: server.headers.ciphertext,
          iv: server.headers.iv,
          authTag: server.headers.authTag,
          keyId: server.headers.keyId,
        });
      }

      if (!server.endpoint) {
        throw new Error('Endpoint is required for HTTP transport');
      }

      // Test MCP initialize
      const initResponse = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'sentris-flow', version: '1.0.0' },
          },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!initResponse.ok) {
        throw new Error(`HTTP ${initResponse.status}: ${initResponse.statusText}`);
      }

      const initData = (await initResponse.json()) as { error?: { message: string } };
      if (initData.error) {
        throw new Error(initData.error.message);
      }

      // Try to get tool count
      const toolsResponse = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
        signal: AbortSignal.timeout(10000),
      });

      let toolCount = 0;
      if (toolsResponse.ok) {
        const toolsData = (await toolsResponse.json()) as {
          result?: { tools?: unknown[] };
        };
        toolCount = toolsData.result?.tools?.length ?? 0;
      }

      // Update health status to healthy
      await this.repository.updateHealthStatus(server.id, 'healthy', {});

      return {
        success: true,
        message: `Connection successful (${toolCount} tools available)`,
        toolCount,
      };
    } catch (error) {
      // Update health status to unhealthy
      await this.repository.updateHealthStatus(server.id, 'unhealthy', {});

      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
      };
    }
  }

  private validateTransportConfig(config: {
    transportType: TransportType;
    endpoint?: string | null;
    command?: string | null;
  }): void {
    const requiresEndpoint = config.transportType === 'http';
    const requiresCommand = config.transportType === 'stdio';

    if (requiresEndpoint && !config.endpoint) {
      throw new BadRequestException(`${config.transportType} transport requires an endpoint URL`);
    }

    if (requiresCommand && !config.command) {
      throw new BadRequestException('stdio transport requires a command');
    }
  }

  /**
   * Get resolved MCP server configuration (with secret references resolved)
   * This is used by the worker to get actual credentials for connecting to MCP servers
   */
  async getResolvedConfig(
    auth: AuthContext | null,
    serverId: string,
  ): Promise<{ headers?: Record<string, string>; args?: string[] }> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.repository.findById(serverId, { organizationId });

    if (!record) {
      throw new BadRequestException(`MCP server ${serverId} not found`);
    }

    // Decrypt headers
    let headers: Record<string, string> | undefined;
    if (record.headers) {
      headers = await this.encryption.decryptHeaders({
        ciphertext: record.headers.ciphertext,
        iv: record.headers.iv,
        authTag: record.headers.authTag,
        keyId: record.headers.keyId,
      });
    }

    // Get args
    const args = record.args;

    // Use SecretResolver to resolve secret references
    const resolved = await this.secretResolver.resolveMcpConfig(headers, args, { auth });

    // Convert null to undefined for return type
    return {
      headers: resolved.headers ?? undefined,
      args: resolved.args ?? undefined,
    };
  }
}
