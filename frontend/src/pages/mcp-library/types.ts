import type { McpHealthStatus } from '@sentris/shared';

export const TRANSPORT_TYPES = [
  { value: 'http', label: 'HTTP' },
  { value: 'stdio', label: 'stdio (Local)' },
] as const;

export type TransportType = (typeof TRANSPORT_TYPES)[number]['value'];

export interface ServerFormData {
  name: string;
  description: string;
  transportType: TransportType;
  endpoint: string;
  command: string;
  args: string;
  headers: string;
  healthCheckUrl: string;
  enabled: boolean;
}

export interface HeaderEntry {
  key: string;
  value: string;
  secretId?: string;
}

export const INITIAL_FORM_DATA: ServerFormData = {
  name: '',
  description: '',
  transportType: 'http',
  endpoint: '',
  command: '',
  args: '',
  headers: '',
  healthCheckUrl: '',
  enabled: true,
};

export interface DiscoveryPreviewItem {
  name: string;
  transportType: 'http' | 'stdio';
  toolCount: number;
  tools?: { name: string; description?: string }[];
  error?: string;
  status: 'pending' | 'discovering' | 'completed' | 'failed';
  cacheToken?: string;
}

export interface DiscoveryStatusState {
  workflowId?: string;
  status?: 'running' | 'completed' | 'failed';
  tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
  toolCount?: number;
  error?: string;
}

export interface DiscoveryCacheEntry {
  cacheToken: string;
  tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
}

export interface ToolCounts {
  enabled: number;
  total: number;
}

export type AgentReadinessStatus = 'ready' | 'needs-test' | 'no-tools' | 'unhealthy' | 'disabled';

export interface AgentReadiness {
  status: AgentReadinessStatus;
  label: string;
  tone: 'success' | 'warning' | 'destructive' | 'muted';
}

export interface ConnectionInfo {
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
}

export interface GroupServerInfo {
  serverId: string;
  serverName: string;
  description?: string | null;
  transportType: TransportType;
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  enabled: boolean;
  healthStatus: McpHealthStatus;
  toolCount: number;
}
