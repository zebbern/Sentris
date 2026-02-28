import { api } from '@/services/api';
import { logger } from '@/lib/logger';

// Types matching backend DTOs
export interface McpGroupResponse {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  serverIds: string[];
  enabled: boolean;
  defaultDockerImage?: string | null;
  createdAt: string;
  updatedAt: string;
  servers?: McpGroupServerResponse[];
}

export interface McpGroupServerResponse {
  id?: string;
  name?: string;
  serverId: string;
  serverName: string;
  description?: string | null;
  transportType: 'http' | 'stdio';
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  enabled: boolean;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
  lastHealthStatus?: 'healthy' | 'unhealthy' | 'unknown';
  toolCount: number;
  recommended?: boolean;
  defaultSelected?: boolean;
}

export interface McpGroupTemplateResponse {
  slug: string;
  name: string;
  description?: string | null;
  credentialContractName: string;
  credentialMapping?: Record<string, unknown> | null;
  defaultDockerImage: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  servers: {
    name: string;
    description?: string | null;
    transportType: 'http' | 'stdio';
    endpoint?: string | null;
    command?: string | null;
    args?: string[] | null;
    recommended: boolean;
    defaultSelected: boolean;
  }[];
  templateHash: string;
}

/**
 * MCP Groups API Service
 *
 * Provides methods to interact with MCP group endpoints.
 * Groups are predefined collections of MCP servers (e.g., AWS MCPs, GitHub MCPs).
 */
export const mcpGroupsApi = {
  /**
   * Fetch all MCP groups
   */
  async listGroups(): Promise<McpGroupResponse[]> {
    return api.get<McpGroupResponse[]>('/mcp-groups');
  },

  /**
   * Fetch all MCP groups with their servers embedded (avoids N+1 queries)
   */
  async listGroupsWithServers(): Promise<McpGroupResponse[]> {
    return api.get<McpGroupResponse[]>('/mcp-groups?includeServers=true');
  },

  /**
   * Fetch available group templates
   */
  async listTemplates(): Promise<McpGroupTemplateResponse[]> {
    return api.get<McpGroupTemplateResponse[]>('/mcp-groups/templates');
  },

  /**
   * Fetch a specific group by ID
   */
  async getGroup(groupId: string): Promise<McpGroupResponse> {
    return api.get<McpGroupResponse>(`/mcp-groups/${groupId}`);
  },

  /**
   * Fetch servers in a group with health status and tool counts
   */
  async getGroupServers(groupId: string): Promise<McpGroupServerResponse[]> {
    const data = await api.get<McpGroupServerResponse[]>(`/mcp-groups/${groupId}/servers`);
    return data.map((server: McpGroupServerResponse) => ({
      ...server,
      serverId: server.serverId ?? server.id ?? '',
      serverName: server.serverName ?? server.name ?? 'Server',
      endpoint: server.endpoint ?? null,
      command: server.command ?? null,
      args: server.args ?? null,
      toolCount: server.toolCount ?? 0,
      healthStatus: server.healthStatus ?? server.lastHealthStatus ?? 'unknown',
    }));
  },

  /**
   * Fetch health status for all servers in a group
   */
  async getGroupHealth(
    groupId: string,
  ): Promise<Record<string, 'healthy' | 'unhealthy' | 'unknown'>> {
    try {
      const data = await api.get<{
        statuses?: Record<string, 'healthy' | 'unhealthy' | 'unknown'>;
      }>(`/mcp-groups/${groupId}/health`);
      return data.statuses || {};
    } catch {
      // Health check failures should not throw - return empty status
      logger.warn('Failed to fetch group health status');
      return {};
    }
  },

  /**
   * Sync group templates from code to database
   */
  async syncTemplates(): Promise<{
    syncedCount: number;
    createdCount: number;
    updatedCount: number;
    templates: string[];
  }> {
    return api.post('/mcp-groups/sync-templates');
  },

  /**
   * Import a specific group template
   * @param slug - The template slug to import
   * @param serverCacheTokens - Optional map of server name -> cacheToken from pre-discovery
   */
  async importTemplate(
    slug: string,
    serverCacheTokens?: Record<string, string>,
  ): Promise<{ action: 'created' | 'updated' | 'skipped'; group: McpGroupResponse }> {
    return api.post(`/mcp-groups/templates/${slug}/import`, { serverCacheTokens });
  },

  /**
   * Delete an imported group
   */
  async deleteGroup(groupId: string): Promise<void> {
    return api.del(`/mcp-groups/${groupId}`);
  },
};
