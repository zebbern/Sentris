import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import {
  McpGroupsRepository,
  type McpGroupUpdateData,
  type McpGroupServerRow,
} from './mcp-groups.repository';
import { McpGroupsSeedingService } from './mcp-groups-seeding.service';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';
import type {
  CreateMcpGroupDto,
  UpdateMcpGroupDto,
  McpGroupResponse,
  McpGroupServerResponse,
  AddServerToGroupDto,
  UpdateServerInGroupDto,
  SyncTemplatesResponse,
  GroupTemplateDto,
  ImportTemplateRequestDto,
  ImportGroupTemplateResponse,
} from './dto/mcp-groups.dto';
import type { McpGroupRecord } from '../database/schema';
import type { TemplateSyncResult } from './mcp-groups-seeding.service';
import type { IngestConfig } from '../config';

/** Template server shape including optional runtime ID (not in Zod schema but may exist at runtime) */
interface McpTemplateServer {
  id?: string;
  name: string;
  command?: string;
  args?: string[];
  endpoint?: string;
}

// Redis injection token - must match the one in mcp-servers.service.ts
const MCP_SERVERS_REDIS = 'MCP_SERVERS_REDIS';

@Injectable()
export class McpGroupsService implements OnModuleInit {
  private readonly logger = new Logger(McpGroupsService.name);

  constructor(
    private readonly repository: McpGroupsRepository,
    private readonly seedingService: McpGroupsSeedingService,
    private readonly mcpServersRepository: McpServersRepository,
    @Optional() @Inject(MCP_SERVERS_REDIS) private readonly redis: Redis | null,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const ingest = this.configService.get<IngestConfig>('ingest')!;
    if (!ingest.mcpSyncTemplatesOnStartup) {
      return;
    }

    try {
      await this.seedingService.syncAllTemplates();
      this.logger.log('MCP group templates synced on startup.');
    } catch (error: unknown) {
      this.logger.error('Failed to sync MCP group templates on startup', error);
    }
  }

  private mapGroupToResponse(record: McpGroupRecord): McpGroupResponse {
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      description: record.description,
      credentialContractName: record.credentialContractName,
      credentialMapping: record.credentialMapping,
      defaultDockerImage: record.defaultDockerImage,
      enabled: record.enabled,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapGroupServerToResponse(record: McpGroupServerRow): McpGroupServerResponse {
    return {
      id: record.id,
      serverName: record.name,
      name: record.name, // Keep for backwards compatibility
      description: record.description,
      transportType: record.transport_type as 'http' | 'stdio' | 'sse' | 'websocket',
      endpoint: record.endpoint,
      command: record.command,
      args: record.args ?? null,
      enabled: record.enabled,
      healthStatus: (record.last_health_status ?? 'unknown') as 'healthy' | 'unhealthy' | 'unknown',
      toolCount: Number(record.tool_count),
      recommended: record.recommended,
      defaultSelected: record.default_selected,
    };
  }

  async listGroups(enabledOnly = false): Promise<McpGroupResponse[]> {
    const groups = await this.repository.findAll(enabledOnly ? { enabled: true } : {});
    return groups.map((g) => this.mapGroupToResponse(g));
  }

  async listGroupsWithServers(
    enabledOnly = false,
  ): Promise<(McpGroupResponse & { servers: McpGroupServerResponse[] })[]> {
    const [groups, serversMap] = await Promise.all([
      this.repository.findAll(enabledOnly ? { enabled: true } : {}),
      this.repository.findAllServersGrouped(),
    ]);
    return groups.map((g) => ({
      ...this.mapGroupToResponse(g),
      servers: (serversMap.get(g.id) ?? []).map((s) => this.mapGroupServerToResponse(s)),
    }));
  }

  listTemplates(): GroupTemplateDto[] {
    return this.seedingService.getAllTemplates();
  }

  async getGroup(id: string): Promise<McpGroupResponse> {
    const group = await this.repository.findById(id);
    return this.mapGroupToResponse(group);
  }

  async getGroupBySlug(slug: string): Promise<McpGroupResponse> {
    const group = await this.repository.findBySlug(slug);
    if (!group) {
      throw new BadRequestException(`MCP group with slug '${slug}' not found`);
    }
    return this.mapGroupToResponse(group);
  }

  async importTemplate(
    slug: string,
    organizationId: string,
    input?: ImportTemplateRequestDto,
    auth?: AuthContext | null,
  ): Promise<ImportGroupTemplateResponse> {
    const cachedByServerName = new Map<
      string,
      {
        tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
        toolCount: number;
      } | null
    >();

    // Validate every bearer cache token before template synchronization creates
    // groups or servers. Promise.all performs only Redis reads before this barrier.
    if (input?.serverCacheTokens) {
      const cachedEntries = await Promise.all(
        Object.entries(input.serverCacheTokens).map(async ([serverName, cacheToken]) => {
          const cached = await this.getCachedDiscovery(cacheToken, organizationId);
          return [serverName, cached] as const;
        }),
      );
      for (const [serverName, cached] of cachedEntries) {
        cachedByServerName.set(serverName, cached);
      }
    }

    const templateName = this.seedingService.getTemplateBySlug(slug)?.name ?? slug;
    const result: TemplateSyncResult = await this.seedingService.syncTemplate(
      slug,
      false,
      organizationId,
      (executor, syncResult) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth ?? null, {
          action: 'mcp_group.import_template',
          resourceType: 'mcp_group',
          resourceId: syncResult.groupId ?? null,
          resourceName: templateName,
          metadata: { slug, action: syncResult.action },
        }),
    );
    const group = await this.getGroupBySlug(slug);

    // If cache tokens were provided, create tools for each server
    if (input?.serverCacheTokens && Object.keys(input.serverCacheTokens).length > 0) {
      this.logger.log(
        `Processing ${Object.keys(input.serverCacheTokens).length} cache tokens for group '${slug}'`,
      );

      // Get all servers in the group
      const servers = await this.repository.findServersByGroup(group.id);

      // Create tools for each server that has a cache token
      for (const server of servers) {
        const cacheToken = input.serverCacheTokens[server.name];
        if (cacheToken) {
          try {
            // Load tools from discovery cache (same logic as createServer in McpServersService)
            const cached = cachedByServerName.get(server.name) ?? null;
            if (cached && cached.tools.length > 0) {
              this.logger.log(
                `Loading ${cached.tools.length} tools for server '${server.name}' from cache`,
              );
              await this.mcpServersRepository.upsertTools(
                server.id,
                cached.tools.map((tool) => ({
                  toolName: tool.name,
                  description: tool.description ?? null,
                  inputSchema: tool.inputSchema ?? null,
                })),
              );
            }
            if (cached) {
              // Mark server healthy when discovery completed (even if tool count is 0)
              await this.mcpServersRepository.updateHealthStatus(server.id, 'healthy', {});
            }
          } catch (error: unknown) {
            this.logger.warn(`Failed to load cached tools for server '${server.name}':`, error);
          }
        }
      }
    }

    if (result.action === 'skipped') {
      await this.auditLogService.recordDurable(auth ?? null, {
        action: 'mcp_group.import_template',
        resourceType: 'mcp_group',
        resourceId: group.id,
        resourceName: group.name,
        metadata: { slug, action: result.action },
      });
    }

    return {
      action: result.action,
      group,
    };
  }

  async createGroup(auth: AuthContext | null, input: CreateMcpGroupDto): Promise<McpGroupResponse> {
    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(input.slug)) {
      throw new BadRequestException(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      );
    }

    const group = await this.repository.create(
      {
        slug: input.slug.trim(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        credentialContractName: input.credentialContractName.trim(),
        credentialMapping: input.credentialMapping ?? null,
        defaultDockerImage: input.defaultDockerImage?.trim() || null,
        enabled: input.enabled ?? true,
      },
      (executor, created) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'mcp_group.create',
          resourceType: 'mcp_group',
          resourceId: created.id,
          resourceName: created.name,
          metadata: { slug: created.slug },
        }),
    );

    return this.mapGroupToResponse(group);
  }

  async updateGroup(
    auth: AuthContext | null,
    id: string,
    input: UpdateMcpGroupDto,
  ): Promise<McpGroupResponse> {
    const updates: McpGroupUpdateData = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('Group name cannot be empty');
      }
      updates.name = trimmed;
    }

    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }

    if (input.credentialContractName !== undefined) {
      updates.credentialContractName = input.credentialContractName.trim();
    }

    if (input.credentialMapping !== undefined) {
      updates.credentialMapping = input.credentialMapping;
    }

    if (input.defaultDockerImage !== undefined) {
      updates.defaultDockerImage = input.defaultDockerImage?.trim() || null;
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    if (Object.keys(updates).length === 0) {
      const current = await this.repository.findById(id);
      return this.mapGroupToResponse(current);
    }

    const group = await this.repository.update(id, updates, (executor, updated) =>
      this.auditLogService.recordDurableWithExecutor(executor, auth, {
        action: 'mcp_group.update',
        resourceType: 'mcp_group',
        resourceId: updated.id,
        resourceName: updated.name,
        metadata: { slug: updated.slug },
      }),
    );

    return this.mapGroupToResponse(group);
  }

  async deleteGroup(auth: AuthContext | null, id: string): Promise<void> {
    // Verify the group before entering the destructive transaction so audit
    // metadata can retain the human-readable identity.
    const group = await this.repository.findById(id);

    await this.repository.delete(id, (executor, result) =>
      this.auditLogService.recordDurableWithExecutor(executor, auth, {
        action: 'mcp_group.delete',
        resourceType: 'mcp_group',
        resourceId: group.id,
        resourceName: group.name,
        metadata: { slug: group.slug, serverCount: result.serverIds.length },
      }),
    );
  }

  // Group-Server relationship methods

  async getServersInGroup(id: string): Promise<McpGroupServerResponse[]> {
    // Verify group exists
    await this.repository.findById(id);

    const servers = await this.repository.findServersByGroup(id);
    return servers.map((s) => this.mapGroupServerToResponse(s));
  }

  async addServerToGroup(
    auth: AuthContext | null,
    groupId: string,
    input: AddServerToGroupDto,
  ): Promise<McpGroupServerResponse[]> {
    // Verify group exists
    const group = await this.repository.findById(groupId);

    await this.repository.addServerToGroup(
      groupId,
      input.serverId,
      {
        recommended: input.recommended,
        defaultSelected: input.defaultSelected,
      },
      (executor, relation) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'mcp_group.server_add',
          resourceType: 'mcp_group',
          resourceId: group.id,
          resourceName: group.name,
          metadata: {
            serverId: relation.serverId,
            recommended: relation.recommended,
            defaultSelected: relation.defaultSelected,
          },
        }),
    );

    // Return updated list of servers
    const servers = await this.repository.findServersByGroup(groupId);
    return servers.map((s) => this.mapGroupServerToResponse(s));
  }

  async removeServerFromGroup(
    auth: AuthContext | null,
    groupId: string,
    serverId: string,
  ): Promise<void> {
    // Verify group exists
    const group = await this.repository.findById(groupId);

    await this.repository.removeServerFromGroup(groupId, serverId, (executor) =>
      this.auditLogService.recordDurableWithExecutor(executor, auth, {
        action: 'mcp_group.server_remove',
        resourceType: 'mcp_group',
        resourceId: group.id,
        resourceName: group.name,
        metadata: { serverId },
      }),
    );
  }

  async updateServerInGroup(
    auth: AuthContext | null,
    groupId: string,
    serverId: string,
    input: UpdateServerInGroupDto,
  ): Promise<McpGroupServerResponse[]> {
    // Verify group exists
    const group = await this.repository.findById(groupId);

    const updates: { recommended?: boolean; defaultSelected?: boolean } = {};
    if (input.recommended !== undefined) {
      updates.recommended = input.recommended;
    }
    if (input.defaultSelected !== undefined) {
      updates.defaultSelected = input.defaultSelected;
    }

    if (Object.keys(updates).length > 0) {
      await this.repository.updateServerMetadata(groupId, serverId, updates, (executor, relation) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'mcp_group.server_update',
          resourceType: 'mcp_group',
          resourceId: group.id,
          resourceName: group.name,
          metadata: {
            serverId: relation.serverId,
            updatedFields: Object.keys(updates),
            recommended: relation.recommended,
            defaultSelected: relation.defaultSelected,
          },
        }),
      );
    }

    // Return updated list of servers
    const servers = await this.repository.findServersByGroup(groupId);
    return servers.map((s) => this.mapGroupServerToResponse(s));
  }

  /**
   * Sync templates from code to database.
   * This is an admin-only operation that creates/updates group templates.
   */
  async syncTemplates(): Promise<SyncTemplatesResponse> {
    this.logger.log('Syncing MCP group templates from code...');

    // Use the seeding service to sync all templates
    const result = await this.seedingService.syncAllTemplates();

    this.logger.log(
      `Template sync complete: ${result.createdCount} created, ${result.updatedCount} updated`,
    );

    return result;
  }

  /**
   * Get cached discovery results from Redis
   * Shared with McpServersService to load tools from cache
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

  /**
   * Get server configuration for a group template server
   * Used by MCP group runtime to fetch server details
   */
  async getServerConfig(
    groupSlug: string,
    serverId: string,
  ): Promise<{ command: string; args?: string[]; endpoint?: string }> {
    const template = this.seedingService.getTemplateBySlug(groupSlug);
    if (!template) {
      throw new BadRequestException(`MCP group template '${groupSlug}' not found`);
    }

    // Search for server by ID (primary) or name (fallback)
    const server = (template.servers as McpTemplateServer[]).find(
      (s) => s.id === serverId || s.name === serverId,
    );
    if (!server) {
      throw new BadRequestException(`Server '${serverId}' not found in group '${groupSlug}'`);
    }

    // Return server configuration
    const config: { command: string; args?: string[]; endpoint?: string } = {
      command: server.command || '',
    };

    if (server.args && server.args.length > 0) {
      config.args = server.args;
    }

    if (server.endpoint) {
      config.endpoint = server.endpoint;
    }

    return config;
  }
}
