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
 * Compatibility discovery for unsaved group templates. Individual saved servers use the
 * canonical worker-owned runtime through /mcp-servers/:id/test.
 */
export const mcpDiscoveryApi = {
  async discoverGroup(
    input: GroupDiscoveryInput,
  ): Promise<{ workflowId: string; cacheTokens: Record<string, string>; status: string }> {
    return api.post('/mcp/discover-group', input);
  },

  async getGroupStatus(workflowId: string): Promise<GroupDiscoveryStatus> {
    return api.get<GroupDiscoveryStatus>(`/mcp/discover-group/${workflowId}`);
  },
};
