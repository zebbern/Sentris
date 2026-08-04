import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { UriTemplate } from '@modelcontextprotocol/server';
import type {
  McpPromptGetOperation,
  McpResourceReadOperation,
  McpSavedServerPreviewRequest,
} from '@sentris/shared';

import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository, type McpServerUpdateData } from './mcp-servers.repository';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import type {
  CreateMcpServerDto,
  UpdateMcpServerDto,
  McpServerResponse,
  McpToolResponse,
  McpServerCapabilitiesResponse,
  McpSavedServerPreviewResponse,
  TransportType,
  HealthStatus,
  TestEnabledServerResponse,
} from './dto/mcp-servers.dto';
import type { McpServerRecord, McpServerToolRecord } from '../database/schema';
import { SecretResolver, extractMcpSecretReferences } from '../secrets/secret-resolver';
import { McpServerRuntimeConfigService } from './mcp-server-runtime-config.service';
import { McpSavedServerRuntimeService } from './mcp-saved-server-runtime.service';

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
    private readonly auditLogService: AuditLogService,
    private readonly runtimeConfigService: McpServerRuntimeConfigService,
    private readonly savedServerRuntime: McpSavedServerRuntimeService,
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

  async getServerCapabilities(
    auth: AuthContext | null,
    id: string,
  ): Promise<McpServerCapabilitiesResponse> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });
    return {
      catalog: server.capabilityCatalog,
      discoveredAt: server.capabilityCatalogDiscoveredAt?.toISOString() ?? null,
      resourceTemplateVariables: Object.fromEntries(
        (server.capabilityCatalog?.resourceTemplates ?? []).map((template) => [
          template.uriTemplate,
          new UriTemplate(template.uriTemplate).variableNames,
        ]),
      ),
    };
  }

  async previewCapability(
    auth: AuthContext | null,
    id: string,
    request: McpSavedServerPreviewRequest,
  ): Promise<McpSavedServerPreviewResponse> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });
    const catalog = server.capabilityCatalog;
    if (!catalog) {
      throw new BadRequestException('Discover this MCP server before previewing capabilities');
    }

    let operation: McpResourceReadOperation | McpPromptGetOperation;
    switch (request.kind) {
      case 'resource': {
        const matches = catalog.resources.filter(
          (resource) => resource.sourceId === id && resource.uri === request.uri,
        );
        if (matches.length !== 1) {
          throw new BadRequestException('Resource is not present in the saved capability catalog');
        }
        operation = { kind: 'resource-read', uri: request.uri };
        break;
      }
      case 'resource-template': {
        const matches = catalog.resourceTemplates.filter(
          (template) => template.sourceId === id && template.uriTemplate === request.uriTemplate,
        );
        if (matches.length !== 1) {
          throw new BadRequestException(
            'Resource template is not present in the saved capability catalog',
          );
        }
        const template = new UriTemplate(request.uriTemplate);
        const unknownArguments = Object.keys(request.arguments).filter(
          (name) => !template.variableNames.includes(name),
        );
        if (unknownArguments.length > 0) {
          throw new BadRequestException(
            `Unknown resource template arguments: ${unknownArguments.join(', ')}`,
          );
        }
        operation = { kind: 'resource-read', uri: template.expand(request.arguments) };
        break;
      }
      case 'prompt': {
        const matches = catalog.prompts.filter(
          (prompt) => prompt.sourceId === id && prompt.name === request.name,
        );
        if (matches.length !== 1) {
          throw new BadRequestException('Prompt is not present in the saved capability catalog');
        }
        const prompt = matches[0]!;
        const argumentNames = new Set(prompt.arguments.map((argument) => argument.name));
        const unknownArguments = Object.keys(request.arguments).filter(
          (name) => !argumentNames.has(name),
        );
        if (unknownArguments.length > 0) {
          throw new BadRequestException(`Unknown prompt arguments: ${unknownArguments.join(', ')}`);
        }
        const missingArguments = prompt.arguments
          .filter((argument) => argument.required && !request.arguments[argument.name])
          .map((argument) => argument.name);
        if (missingArguments.length > 0) {
          throw new BadRequestException(
            `Missing required prompt arguments: ${missingArguments.join(', ')}`,
          );
        }
        operation = { kind: 'prompt-get', name: request.name, arguments: request.arguments };
        break;
      }
      default: {
        const exhaustive: never = request;
        throw new BadRequestException(`Unsupported preview request: ${String(exhaustive)}`);
      }
    }

    if (!auth) throw new BadRequestException('MCP runtime services are unavailable');
    const runtimeKey = await this.runtimeConfigService.buildRuntimeKey(auth, server.id);
    return this.savedServerRuntime.preview(runtimeKey, operation);
  }

  async createServer(
    auth: AuthContext | null,
    input: CreateMcpServerDto,
  ): Promise<McpServerResponse> {
    const organizationId = requireOrganizationId(auth);

    // Validate transport-specific requirements
    this.validateTransportConfig(input);

    // A discovery cache token is a bearer capability. Resolve and authorize it
    // before any database mutation so a foreign token cannot create a partial server.
    const cachedDiscovery =
      input.cacheToken && this.redis
        ? await this.getCachedDiscovery(input.cacheToken, organizationId)
        : null;

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

    const secretReferences = extractMcpSecretReferences(input.headers, input.args);
    const server = await this.repository.create(
      {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        transportType: input.transportType,
        endpoint: input.transportType === 'http' ? input.endpoint || null : null,
        command: input.transportType === 'stdio' ? input.command || null : null,
        args: input.transportType === 'stdio' ? input.args || null : null,
        headers: encryptedHeaders,
        headerSecretReferences: secretReferences.headers,
        argSecretReferences: input.transportType === 'stdio' ? secretReferences.args : [],
        healthCheckUrl: input.healthCheckUrl || null,
        enabled: input.enabled ?? true,
        organizationId,
        createdBy: auth?.userId || null,
      },
      (executor, created) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'mcp_server.create',
          resourceType: 'mcp_server',
          resourceId: created.id,
          resourceName: created.name,
          metadata: { transportType: created.transportType },
        }),
    );

    if (cachedDiscovery && input.cacheToken && this.redis) {
      if (cachedDiscovery.tools.length > 0) {
        this.logger.log(
          `Creating server ${server.id} with ${cachedDiscovery.tools.length} cached tools`,
        );
        await this.repository.upsertTools(
          server.id,
          cachedDiscovery.tools.map((tool) => ({
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

    // Return header keys from input (we know the keys since we just created with them)
    const headerKeys = input.headers ? Object.keys(input.headers) : null;

    return this.mapServerToResponse(server, headerKeys);
  }

  /**
   * Get cached discovery results from Redis
   */
  private async getCachedDiscovery(
    cacheToken: string,
    organizationId: string,
  ): Promise<{
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
    let cached: {
      status?: string;
      organizationId?: string;
      tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      toolCount?: number;
    };
    try {
      cached = JSON.parse(value) as typeof cached;
    } catch {
      throw new ForbiddenException('Discovery cache access denied');
    }
    if (cached.organizationId !== organizationId) {
      throw new ForbiddenException('Discovery cache access denied');
    }
    if (cached.status !== 'completed') {
      return null;
    }
    return {
      tools: cached.tools ?? [],
      toolCount: cached.toolCount ?? cached.tools?.length ?? 0,
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
    const transportChanged = effectiveTransportType !== current.transportType;
    const effectiveEndpoint =
      input.endpoint !== undefined ? input.endpoint : transportChanged ? null : current.endpoint;
    const effectiveCommand =
      input.command !== undefined ? input.command : transportChanged ? null : current.command;

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

    if (effectiveTransportType === 'http') {
      if (transportChanged || input.command !== undefined || current.command !== null) {
        updates.command = null;
      }
      if (transportChanged || input.args !== undefined || current.args !== null) {
        updates.args = null;
        updates.argSecretReferences = [];
      }

      if (input.headers !== undefined) {
        if (input.headers && Object.keys(input.headers).length > 0) {
          const material = await this.encryption.encryptHeaders(input.headers);
          updates.headers = {
            ciphertext: material.ciphertext,
            iv: material.iv,
            authTag: material.authTag,
            keyId: material.keyId,
          };
        } else {
          updates.headers = null;
        }
        updates.headerSecretReferences = extractMcpSecretReferences(input.headers, null).headers;
      } else if (transportChanged) {
        updates.headers = null;
        updates.headerSecretReferences = [];
      }
    } else {
      if (transportChanged || input.command !== undefined) {
        updates.command = effectiveCommand;
      }
      if (input.args !== undefined) {
        updates.args = input.args;
        updates.argSecretReferences = extractMcpSecretReferences(null, input.args).args;
      } else if (transportChanged) {
        updates.args = null;
        updates.argSecretReferences = [];
      }

      if (transportChanged || input.endpoint !== undefined || current.endpoint !== null) {
        updates.endpoint = null;
      }
      if (input.headers !== undefined) {
        if (input.headers && Object.keys(input.headers).length > 0) {
          const material = await this.encryption.encryptHeaders(input.headers);
          updates.headers = {
            ciphertext: material.ciphertext,
            iv: material.iv,
            authTag: material.authTag,
            keyId: material.keyId,
          };
        } else {
          updates.headers = null;
        }
        updates.headerSecretReferences = extractMcpSecretReferences(input.headers, null).headers;
      } else if (transportChanged) {
        updates.headers = null;
        updates.headerSecretReferences = [];
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

    const server = await this.repository.update(
      id,
      updates,
      { organizationId },
      (executor, updated) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'mcp_server.update',
          resourceType: 'mcp_server',
          resourceId: updated.id,
          resourceName: updated.name,
          metadata: { transportType: updated.transportType },
        }),
    );

    // Determine header keys for response
    let headerKeys: string[] | null = null;
    if (input.headers !== undefined) {
      // Headers were explicitly set in this update
      headerKeys = input.headers ? Object.keys(input.headers) : null;
    } else {
      // Headers unchanged, extract from existing
      headerKeys = await this.extractHeaderKeys(server.headers);
    }

    return this.mapServerToResponse(server, headerKeys);
  }

  async toggleServer(auth: AuthContext | null, id: string): Promise<McpServerResponse> {
    const organizationId = requireOrganizationId(auth);
    const current = await this.repository.findById(id, { organizationId });
    const server = await this.repository.update(
      id,
      { enabled: !current.enabled },
      { organizationId },
      (executor, updated) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'mcp_server.toggle',
          resourceType: 'mcp_server',
          resourceId: updated.id,
          resourceName: updated.name,
          metadata: { enabled: updated.enabled },
        }),
    );

    return this.mapServerToResponse(server);
  }

  async deleteServer(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });
    await this.repository.delete(id, { organizationId }, (executor) =>
      this.auditLogService.recordDurableWithExecutor(executor, auth, {
        action: 'mcp_server.delete',
        resourceType: 'mcp_server',
        resourceId: server.id,
        resourceName: server.name,
        metadata: { transportType: server.transportType },
      }),
    );
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
    const tool = await this.repository.toggleToolEnabled(serverId, toolId, (executor, toggled) =>
      this.auditLogService.recordDurableWithExecutor(executor, auth, {
        action: 'mcp_server.tool_toggle',
        resourceType: 'mcp_server',
        resourceId: server.id,
        resourceName: server.name,
        metadata: {
          toolId: toggled.id,
          toolName: toggled.toolName,
          enabled: toggled.enabled,
        },
      }),
    );
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

  async testEnabledServers(auth: AuthContext | null): Promise<TestEnabledServerResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const servers = await this.repository.listEnabled({ organizationId });
    const results: TestEnabledServerResponse[] = [];

    for (const server of servers) {
      try {
        const result = await this.testServerConnection(auth, server.id);
        results.push({
          serverId: server.id,
          serverName: server.name,
          success: result.success,
          message: result.message,
          ...(typeof result.toolCount === 'number' ? { toolCount: result.toolCount } : {}),
        });
      } catch (error) {
        try {
          await this.repository.updateHealthStatus(server.id, 'unhealthy', { organizationId });
        } catch {
          // Preserve the per-server test result even if persisting health also fails.
        }
        results.push({
          serverId: server.id,
          serverName: server.name,
          success: false,
          message: error instanceof Error ? error.message : 'Connection test failed',
        });
      }
    }

    return results;
  }

  /**
   * Test connection to an MCP server.
   * Both HTTP and stdio use the canonical worker-owned runtime path.
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

      if (!auth) {
        throw new Error('MCP runtime discovery services are unavailable');
      }

      const runtimeKey = await this.runtimeConfigService.buildRuntimeKey(auth, server.id);
      this.logger.log(`Testing MCP server ${server.id} through a worker-owned runtime`);

      const catalog = await this.savedServerRuntime.discover(runtimeKey);
      await this.repository.persistDiscovery(id, catalog);
      return {
        success: true,
        message:
          `Connection successful (${catalog.tools.length} tools, ` +
          `${catalog.resources.length} resources, ${catalog.resourceTemplates.length} templates, ` +
          `${catalog.prompts.length} prompts discovered)`,
        toolCount: catalog.tools.length,
      };
    } catch (error) {
      // Update health status to unhealthy (configuration is invalid or test failed)
      await this.repository.updateHealthStatus(id, 'unhealthy', { organizationId });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      };
    }
  }

  private mapDiscoveredTools(
    tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[],
  ): {
    toolName: string;
    description: string | null;
    inputSchema: Record<string, unknown> | null;
  }[] {
    return tools.map((tool) => ({
      toolName: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
    }));
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
