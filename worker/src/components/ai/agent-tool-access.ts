import { ConfigurationError } from '@sentris/component-sdk';
import { getGatewaySessionToken } from './utils';

export type AgentToolAvailability = 'required' | 'best-effort';

export interface AgentToolStatus {
  requested: boolean;
  status: 'not-requested' | 'configured' | 'degraded';
  connectedNodeCount: number;
  availableToolCount?: number;
  message?: string;
}

interface GatewayToolDiscoveryResult<T> {
  tools: T;
  availableToolCount: number;
  close?: () => Promise<void>;
}

interface PrepareAgentGatewayAccessInput<T> {
  runId: string;
  organizationId: string | null;
  invokingNodeId?: string;
  connectedToolNodeIds?: readonly string[];
  ttlSeconds: number;
  toolAvailability?: AgentToolAvailability;
  requestToken?: typeof getGatewaySessionToken;
  discoverTools?: (gatewayToken: string) => Promise<GatewayToolDiscoveryResult<T>>;
  onDegraded?: (message: string) => void;
}

export interface AgentGatewayAccess<T> {
  gatewayToken: string;
  toolStatus: AgentToolStatus;
  discovery?: GatewayToolDiscoveryResult<T>;
}

export async function prepareAgentGatewayAccess<T = never>(
  input: PrepareAgentGatewayAccessInput<T>,
): Promise<AgentGatewayAccess<T>> {
  const connectedToolNodeIds = input.connectedToolNodeIds ?? [];
  const toolAvailability = input.toolAvailability ?? 'required';
  const connectedNodeCount = connectedToolNodeIds.length;

  if (connectedNodeCount === 0) {
    return {
      gatewayToken: '',
      toolStatus: {
        requested: false,
        status: 'not-requested',
        connectedNodeCount,
      },
    };
  }

  try {
    const gatewayToken = await (input.requestToken ?? getGatewaySessionToken)(
      input.runId,
      input.organizationId,
      [...connectedToolNodeIds],
      input.ttlSeconds,
      input.invokingNodeId,
    );
    const discovery = input.discoverTools ? await input.discoverTools(gatewayToken) : undefined;

    if (discovery && discovery.availableToolCount === 0) {
      try {
        await discovery.close?.();
      } catch {
        // Preserve the unavailable-tools result if cleanup itself fails.
      }
      throw new Error('gateway discovery returned zero tools');
    }

    return {
      gatewayToken,
      toolStatus: {
        requested: true,
        status: 'configured',
        connectedNodeCount,
        ...(discovery ? { availableToolCount: discovery.availableToolCount } : {}),
      },
      ...(discovery ? { discovery } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown gateway configuration error';
    if (toolAvailability === 'required') {
      throw new ConfigurationError(`Connected MCP tools are required but unavailable: ${message}`, {
        configKey: 'toolAvailability',
      });
    }

    input.onDegraded?.(message);
    return {
      gatewayToken: '',
      toolStatus: {
        requested: true,
        status: 'degraded',
        connectedNodeCount,
        message,
      },
    };
  }
}

export function getToolAvailabilityPrompt(toolStatus: AgentToolStatus): string {
  if (toolStatus.status !== 'degraded' || !toolStatus.message) {
    return '';
  }

  return (
    '\n\n# Tool Availability\n' +
    `Connected MCP tools are unavailable for this run: ${toolStatus.message}.\n` +
    'Continue with built-in capabilities and state this limitation in the final result.'
  );
}
