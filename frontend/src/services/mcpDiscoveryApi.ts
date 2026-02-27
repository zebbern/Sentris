import { api } from '@/services/api';

// Types for MCP discovery workflow
export interface DiscoveryInput {
  transport: 'http' | 'stdio';
  name: string;
  endpoint?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  image?: string;
}

export interface GroupDiscoveryInput {
  image?: string;
  servers: DiscoveryInput[];
}

export interface McpToolResponse {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface DiscoveryStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpToolResponse[];
  toolCount?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GroupDiscoveryResult {
  name: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpToolResponse[];
  toolCount?: number;
  error?: string;
  cacheToken?: string;
}

export interface GroupDiscoveryStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  results?: GroupDiscoveryResult[];
  error?: string;
}

/**
 * MCP Discovery API Service
 *
 * Provides pre-save discovery functionality for MCP servers.
 * Uses Temporal workflows for async tool discovery.
 */
export const mcpDiscoveryApi = {
  /**
   * Start a discovery workflow for a potential MCP server configuration
   */
  async discover(
    input: DiscoveryInput,
  ): Promise<{ workflowId: string; cacheToken?: string; status: string }> {
    return api.post('/mcp/discover', input);
  },

  /**
   * Get the status of a discovery workflow
   */
  async getStatus(workflowId: string): Promise<DiscoveryStatus> {
    return api.get<DiscoveryStatus>(`/mcp/discover/${workflowId}`);
  },

  async discoverGroup(
    input: GroupDiscoveryInput,
  ): Promise<{ workflowId: string; cacheTokens: Record<string, string>; status: string }> {
    return api.post('/mcp/discover-group', input);
  },

  async getGroupStatus(workflowId: string): Promise<GroupDiscoveryStatus> {
    return api.get<GroupDiscoveryStatus>(`/mcp/discover-group/${workflowId}`);
  },
};
