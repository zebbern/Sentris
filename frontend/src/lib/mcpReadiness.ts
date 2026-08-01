import type { McpHealthStatus } from '@sentris/shared';

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

export function getMcpAgentReadiness(input: {
  enabled: boolean;
  healthStatus?: McpHealthStatus | null;
  toolCounts?: ToolCounts | null;
}): AgentReadiness {
  if (!input.enabled) {
    return { status: 'disabled', label: 'Disabled', tone: 'muted' };
  }

  if (input.healthStatus === 'unhealthy') {
    return { status: 'unhealthy', label: 'Unhealthy', tone: 'destructive' };
  }

  if (input.healthStatus !== 'healthy') {
    return { status: 'needs-test', label: 'Needs test', tone: 'warning' };
  }

  if (!input.toolCounts || input.toolCounts.enabled <= 0) {
    return { status: 'no-tools', label: 'No tools', tone: 'warning' };
  }

  return { status: 'ready', label: 'Ready', tone: 'success' };
}
