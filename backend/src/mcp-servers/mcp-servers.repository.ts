import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { getPostgresErrorCode, PG_ERROR } from '../common/postgres-error';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, type SQL, or, isNull } from 'drizzle-orm';
import type { McpCatalog } from '@sentris/shared';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  mcpServers,
  mcpServerTools,
  type McpServerRecord,
  type NewMcpServerRecord,
  type McpServerToolRecord,
  type NewMcpServerToolRecord,
} from '../database/schema';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';
import type { OutboxExecutor } from '../outbox/enqueue-outbox-event';

export interface McpServerQueryOptions {
  organizationId?: string | null;
  groupId?: string | null;
}

export interface McpServerUpdateData {
  name?: string;
  description?: string | null;
  transportType?: string;
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  headers?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyId: string;
  } | null;
  headerSecretReferences?: string[] | null;
  argSecretReferences?: string[] | null;
  enabled?: boolean;
  healthCheckUrl?: string | null;
  lastHealthCheck?: Date;
  lastHealthStatus?: string;
  capabilityCatalog?: McpCatalog | null;
  capabilityCatalogDiscoveredAt?: Date | null;
}

type McpServerMutationHook<T = void> = (executor: OutboxExecutor, result: T) => Promise<void>;
type McpToolWriteExecutor = Pick<NodePgDatabase, 'delete' | 'insert' | 'select' | 'update'>;

@Injectable()
export class McpServersRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async list(options: McpServerQueryOptions = {}): Promise<McpServerRecord[]> {
    const conditions: (SQL | undefined)[] = [];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }
    if (options.groupId) {
      conditions.push(eq(mcpServers.groupId, options.groupId));
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions.filter((c): c is SQL => c !== undefined));

    const rows = await (
      whereClause
        ? this.db.select().from(mcpServers).where(whereClause)
        : this.db.select().from(mcpServers)
    ).orderBy(mcpServers.name);

    return rows;
  }

  async listEnabled(options: McpServerQueryOptions = {}): Promise<McpServerRecord[]> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.enabled, true)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }
    if (options.groupId) {
      conditions.push(eq(mcpServers.groupId, options.groupId));
    }

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .orderBy(mcpServers.name);

    return rows;
  }

  async findById(id: string, options: McpServerQueryOptions = {}): Promise<McpServerRecord> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`MCP server ${id} not found`);
    }

    return row;
  }

  async findByName(
    name: string,
    options: McpServerQueryOptions = {},
  ): Promise<McpServerRecord | null> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.name, name)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .limit(1);

    return rows[0] ?? null;
  }

  async create(
    data: Omit<NewMcpServerRecord, 'id' | 'createdAt' | 'updatedAt'>,
    onMutated?: McpServerMutationHook<McpServerRecord>,
  ): Promise<McpServerRecord> {
    try {
      const mutate = async (executor: Pick<NodePgDatabase, 'insert'>) => {
        const [server] = await executor
          .insert(mcpServers)
          .values({
            ...data,
            organizationId: data.organizationId ?? DEFAULT_ORGANIZATION_ID,
          })
          .returning();
        await onMutated?.(executor, server);
        return server;
      };
      return await (onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db));
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION) {
        throw new ConflictException(`MCP server name '${data.name}' already exists`);
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: McpServerUpdateData,
    options: McpServerQueryOptions = {},
    onMutated?: McpServerMutationHook<McpServerRecord>,
  ): Promise<McpServerRecord> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }

    try {
      const mutate = async (executor: Pick<NodePgDatabase, 'insert' | 'update'>) => {
        const [updated] = await executor
          .update(mcpServers)
          .set({
            ...data,
            updatedAt: sql`now()`,
          })
          .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
          .returning();

        if (!updated) {
          throw new NotFoundException(`MCP server ${id} not found`);
        }
        await onMutated?.(executor, updated);
        return updated;
      };
      return await (onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db));
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION && data.name) {
        throw new ConflictException(`MCP server name '${data.name}' already exists`);
      }
      throw error;
    }
  }

  async updateHealthStatus(
    id: string,
    status: 'healthy' | 'unhealthy' | 'unknown',
    options: McpServerQueryOptions = {},
  ): Promise<void> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }

    await this.db
      .update(mcpServers)
      .set({
        lastHealthCheck: sql`now()`,
        lastHealthStatus: status,
      })
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)));
  }

  async delete(
    id: string,
    options: McpServerQueryOptions = {},
    onMutated?: McpServerMutationHook,
  ): Promise<void> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }

    const mutate = async (executor: Pick<NodePgDatabase, 'delete' | 'insert'>) => {
      const deleted = await executor
        .delete(mcpServers)
        .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
        .returning({ id: mcpServers.id });

      if (deleted.length === 0) {
        throw new NotFoundException(`MCP server ${id} not found`);
      }
      await onMutated?.(executor, undefined);
    };
    await (onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db));
  }

  // Tool management methods

  async listTools(serverId: string): Promise<McpServerToolRecord[]> {
    return this.db
      .select()
      .from(mcpServerTools)
      .where(eq(mcpServerTools.serverId, serverId))
      .orderBy(mcpServerTools.toolName);
  }

  async listAllToolsForOrganization(
    options: McpServerQueryOptions = {},
  ): Promise<(McpServerToolRecord & { serverName: string })[]> {
    const conditions: (SQL | undefined)[] = [eq(mcpServers.enabled, true)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(mcpServers.organizationId, options.organizationId),
          isNull(mcpServers.organizationId),
        ),
      );
    }

    const rows = await this.db
      .select({
        id: mcpServerTools.id,
        serverId: mcpServerTools.serverId,
        toolName: mcpServerTools.toolName,
        description: mcpServerTools.description,
        inputSchema: mcpServerTools.inputSchema,
        enabled: mcpServerTools.enabled,
        discoveredAt: mcpServerTools.discoveredAt,
        serverName: mcpServers.name,
      })
      .from(mcpServerTools)
      .innerJoin(mcpServers, eq(mcpServerTools.serverId, mcpServers.id))
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .orderBy(mcpServers.name, mcpServerTools.toolName);

    return rows;
  }

  async toggleToolEnabled(
    serverId: string,
    toolId: string,
    onMutated?: McpServerMutationHook<McpServerToolRecord>,
  ): Promise<McpServerToolRecord> {
    const mutate = async (executor: Pick<NodePgDatabase, 'insert' | 'select' | 'update'>) => {
      // Read and write on the same transaction executor so concurrent toggles
      // cannot separate the configuration change from its audit outbox entry.
      const [current] = await executor
        .select()
        .from(mcpServerTools)
        .where(and(eq(mcpServerTools.id, toolId), eq(mcpServerTools.serverId, serverId)))
        .limit(1);

      if (!current) {
        throw new NotFoundException(`Tool ${toolId} not found`);
      }

      const [updated] = await executor
        .update(mcpServerTools)
        .set({ enabled: !current.enabled })
        .where(eq(mcpServerTools.id, toolId))
        .returning();

      await onMutated?.(executor, updated);
      return updated;
    };

    return onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db);
  }

  async upsertTools(
    serverId: string,
    tools: Omit<NewMcpServerToolRecord, 'id' | 'serverId' | 'discoveredAt' | 'enabled'>[],
  ): Promise<McpServerToolRecord[]> {
    return this.db.transaction((tx) => this.upsertToolsWithExecutor(tx, serverId, tools));
  }

  async persistDiscovery(serverId: string, catalog: McpCatalog): Promise<void> {
    const tools = catalog.tools.map((tool) => ({
      toolName: tool.source.kind === 'mcp' ? tool.source.upstreamName : tool.canonicalName,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
    }));

    await this.db.transaction(async (tx) => {
      await this.upsertToolsWithExecutor(tx, serverId, tools);

      await tx
        .update(mcpServers)
        .set({
          capabilityCatalog: catalog,
          capabilityCatalogDiscoveredAt: sql`now()`,
          lastHealthCheck: sql`now()`,
          lastHealthStatus: 'healthy',
        })
        .where(eq(mcpServers.id, serverId));
    });
  }

  private async upsertToolsWithExecutor(
    executor: McpToolWriteExecutor,
    serverId: string,
    tools: Omit<NewMcpServerToolRecord, 'id' | 'serverId' | 'discoveredAt' | 'enabled'>[],
  ): Promise<McpServerToolRecord[]> {
    const existingTools = await executor
      .select()
      .from(mcpServerTools)
      .where(eq(mcpServerTools.serverId, serverId));
    const existingToolMap = new Map(existingTools.map((tool) => [tool.toolName, tool]));
    const discoveredToolNames = new Set(tools.map((tool) => tool.toolName));
    const toolsToDelete = existingTools.filter((tool) => !discoveredToolNames.has(tool.toolName));

    if (toolsToDelete.length > 0) {
      await executor.delete(mcpServerTools).where(
        and(
          eq(mcpServerTools.serverId, serverId),
          sql`${mcpServerTools.toolName} IN (${sql.join(
            toolsToDelete.map((tool) => sql`${tool.toolName}`),
            sql`, `,
          )})`,
        ),
      );
    }

    const results: McpServerToolRecord[] = [];
    for (const tool of tools) {
      const existing = existingToolMap.get(tool.toolName);
      if (existing) {
        const [updated] = await executor
          .update(mcpServerTools)
          .set({
            description: tool.description,
            inputSchema: tool.inputSchema,
            discoveredAt: sql`now()`,
          })
          .where(eq(mcpServerTools.id, existing.id))
          .returning();
        results.push(updated);
      } else {
        const [inserted] = await executor
          .insert(mcpServerTools)
          .values({ ...tool, serverId, enabled: true })
          .returning();
        results.push(inserted);
      }
    }
    return results;
  }

  async clearTools(serverId: string): Promise<void> {
    await this.db.delete(mcpServerTools).where(eq(mcpServerTools.serverId, serverId));
  }

  /**
   * Find a server by its registry source name within an organization.
   * Used for duplicate detection during registry import.
   */
  async findByRegistrySource(
    registrySourceName: string,
    organizationId: string,
  ): Promise<McpServerRecord | null> {
    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.registrySourceName, registrySourceName),
          or(eq(mcpServers.organizationId, organizationId), isNull(mcpServers.organizationId)),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Set the registry source name on an existing server.
   */
  async setRegistrySourceName(serverId: string, registrySourceName: string): Promise<void> {
    await this.db
      .update(mcpServers)
      .set({
        registrySourceName,
        updatedAt: sql`now()`,
      })
      .where(eq(mcpServers.id, serverId));
  }

  /**
   * List distinct registry source names for an organization.
   * Used to efficiently check which registry servers are already imported.
   */
  async listRegistrySourceNames(organizationId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ name: mcpServers.registrySourceName })
      .from(mcpServers)
      .where(
        and(
          sql`${mcpServers.registrySourceName} IS NOT NULL`,
          or(eq(mcpServers.organizationId, organizationId), isNull(mcpServers.organizationId)),
        ),
      );

    return rows.map((r) => r.name).filter((n): n is string => n !== null);
  }
}
