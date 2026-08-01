import type { ComponentMetadata } from '@/schemas/component';
import type { SecretSummary } from '@/schemas/secret';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import { isLlmModelProvider, LLM_PROVIDER_CATALOG } from '@sentris/shared';
import { getMcpAgentReadiness } from '@/lib/mcpReadiness';
import {
  evaluateCredentialMappingReadiness,
  evaluateLlmModelReadiness,
  evaluateMcpToolsReadiness,
  findLlmProviderInput,
  type AgentReadinessRow,
  type CatalogState,
  type LlmAuthMode,
  type McpSelection,
} from '@/features/agent-readiness/readiness';

export interface TemplateModelRequirement {
  componentId: string;
  inputId: string;
  provider: string;
  modelId: string;
  rawValue: Record<string, unknown>;
  nodeCount: number;
  supportedAuthModes: readonly LlmAuthMode[];
}

export interface TemplateMcpRequirement {
  mcpNodeId: string;
  agentNodeId: string;
  policy: 'required' | 'best-effort';
  selection: McpSelection;
}

export interface TemplateLaunchRequirements {
  models: TemplateModelRequirement[];
  mcp: TemplateMcpRequirement[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function nodeData(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node.data) ? node.data : {};
}

function nodeConfig(node: Record<string, unknown>): Record<string, unknown> {
  const config = nodeData(node).config;
  return isRecord(config) ? config : {};
}

function componentForNode(
  node: Record<string, unknown>,
  resolveComponent: (ref: string) => ComponentMetadata | null,
): ComponentMetadata | null {
  const data = nodeData(node);
  const refs = [data.componentId, node.type, data.componentSlug];
  for (const ref of refs) {
    const componentRef = nonEmptyString(ref);
    const resolved = componentRef ? resolveComponent(componentRef) : null;
    if (resolved) return resolved;
  }
  return null;
}

function inputOverrides(node: Record<string, unknown>): Record<string, unknown> {
  const overrides = nodeConfig(node).inputOverrides;
  return isRecord(overrides) ? overrides : {};
}

function params(node: Record<string, unknown>): Record<string, unknown> {
  const value = nodeConfig(node).params;
  return isRecord(value) ? value : {};
}

function selection(node: Record<string, unknown>): McpSelection {
  const value = params(node);
  return {
    useAllEnabled: value.useAllEnabled === true,
    serverIds: strings(value.enabledServers),
    toolExclusions: strings(value.toolExclusions),
  };
}

function toolAvailability(node: Record<string, unknown>): 'required' | 'best-effort' {
  return params(node).toolAvailability === 'best-effort' ? 'best-effort' : 'required';
}

function supportedAuthModes(componentId: string): readonly LlmAuthMode[] {
  return componentId === 'core.ai.claude-code' ? ['api_key', 'subscription_oauth'] : ['api_key'];
}

export function parseTemplateLaunchRequirements(
  graph: Record<string, unknown> | undefined,
  resolveComponent: (ref: string) => ComponentMetadata | null,
): TemplateLaunchRequirements {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { models: [], mcp: [] };
  }

  const nodes = graph.nodes.filter(isRecord);
  const edges = graph.edges.filter(isRecord);
  const nodesById = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    const id = nonEmptyString(node.id);
    if (id && !nodesById.has(id)) nodesById.set(id, node);
  }

  const models = new Map<string, TemplateModelRequirement>();
  for (const node of nodes) {
    const component = componentForNode(node, resolveComponent);
    if (!component) continue;

    const llmInput = findLlmProviderInput(component.inputs);
    if (!llmInput) continue;

    const rawValue = inputOverrides(node)[llmInput.id];
    if (!isRecord(rawValue)) continue;

    const provider = rawValue.provider;
    const modelId = nonEmptyString(rawValue.modelId);
    if (typeof provider !== 'string' || !modelId) continue;

    const key = `${provider}\u0000${modelId}`;
    const existing = models.get(key);
    if (existing) {
      existing.nodeCount += 1;
      continue;
    }

    models.set(key, {
      componentId: component.id,
      inputId: llmInput.id,
      provider,
      modelId,
      rawValue,
      nodeCount: 1,
      supportedAuthModes: supportedAuthModes(component.id),
    });
  }

  const mcp: TemplateMcpRequirement[] = [];
  const seenMcpConnections = new Set<string>();
  for (const edge of edges) {
    if (edge.targetHandle !== 'tools') continue;

    const sourceId = nonEmptyString(edge.source);
    const targetId = nonEmptyString(edge.target);
    if (!sourceId || !targetId) continue;

    const source = nodesById.get(sourceId);
    const target = nodesById.get(targetId);
    if (!source || !target || componentForNode(source, resolveComponent)?.id !== 'mcp.custom')
      continue;

    const targetComponent = componentForNode(target, resolveComponent);
    if (!targetComponent || !findLlmProviderInput(targetComponent.inputs)) continue;

    const key = `${sourceId}\u0000${targetId}`;
    if (seenMcpConnections.has(key)) continue;
    seenMcpConnections.add(key);
    mcp.push({
      mcpNodeId: sourceId,
      agentNodeId: targetId,
      policy: toolAvailability(target),
      selection: selection(source),
    });
  }

  return { models: [...models.values()], mcp };
}

function providerLabel(provider: string): string {
  return isLlmModelProvider(provider) ? LLM_PROVIDER_CATALOG[provider].label : provider;
}

function modelCatalogRow(state: 'loading' | 'error'): AgentReadinessRow {
  return state === 'loading'
    ? {
        kind: 'model',
        state,
        label: 'Model status unavailable',
        detail: 'Checking component metadata.',
        blocksCreation: true,
        blocksExecution: false,
      }
    : {
        kind: 'model',
        state,
        label: 'Model status unavailable',
        detail: 'Component metadata could not be loaded.',
        blocksCreation: true,
        blocksExecution: false,
      };
}

function selectedServers(
  selection: McpSelection,
  servers: readonly McpServerResponse[],
): McpServerResponse[] {
  const explicitIds = new Set(selection.serverIds);
  return servers.filter(
    (server) => server.enabled && (selection.useAllEnabled || explicitIds.has(server.id)),
  );
}

function mcpDetail(input: {
  requirement: TemplateMcpRequirement;
  readiness: AgentReadinessRow;
  servers: CatalogState<McpServerResponse>;
  tools: CatalogState<McpToolResponse>;
}): string {
  if (input.servers.isLoading || input.tools.isLoading) return 'Checking…';
  if (input.servers.error || input.tools.error) return 'Status unavailable.';

  const servers = selectedServers(input.requirement.selection, input.servers.items);
  if (servers.length === 0) return 'No enabled servers.';

  const exclusions = new Set(input.requirement.selection.toolExclusions);
  const ready = servers.filter((server) => {
    const enabledTools = input.tools.items.filter(
      (tool) =>
        tool.serverId === server.id &&
        tool.enabled &&
        !exclusions.has(`${server.id}:${tool.toolName}`),
    );
    return (
      getMcpAgentReadiness({
        enabled: server.enabled,
        healthStatus: server.lastHealthStatus,
        toolCounts: { enabled: enabledTools.length, total: enabledTools.length },
      }).status === 'ready'
    );
  }).length;
  const attention = servers.length - ready;
  const attentionSummary = `${attention} ${attention === 1 ? 'needs' : 'need'} attention.`;
  if (input.readiness.state === 'ready' || ready > 0) {
    return `${ready} ready, ${attentionSummary}`;
  }
  return attentionSummary;
}

export function evaluateTemplateLaunchReadiness(input: {
  requirements: TemplateLaunchRequirements;
  requiredSecretNames: readonly string[];
  secretMappings: Readonly<Record<string, string>>;
  secrets: CatalogState<SecretSummary>;
  mcpServers: CatalogState<McpServerResponse>;
  mcpTools: CatalogState<McpToolResponse>;
  componentCatalog: { isLoading: boolean; error: unknown | null };
}): AgentReadinessRow[] {
  const models = input.componentCatalog.isLoading
    ? [modelCatalogRow('loading')]
    : input.componentCatalog.error
      ? [modelCatalogRow('error')]
      : input.requirements.models.map((requirement) => {
          const readiness = evaluateLlmModelReadiness({
            value: requirement.rawValue,
            supportedAuthModes: requirement.supportedAuthModes,
          });
          return {
            ...readiness,
            label: `${providerLabel(requirement.provider)} · ${requirement.modelId}${
              requirement.nodeCount > 1 ? ` (${requirement.nodeCount} agents)` : ''
            }`,
            detail:
              readiness.state === 'ready'
                ? requirement.nodeCount > 1
                  ? `Configured for ${requirement.nodeCount} agents.`
                  : 'Configured for 1 agent.'
                : readiness.detail,
          };
        });

  const credentials = evaluateCredentialMappingReadiness({
    requiredNames: input.requiredSecretNames,
    mappings: input.secretMappings,
    secrets: input.secrets,
  });

  const mcp = input.requirements.mcp.map((requirement) => {
    const readiness = evaluateMcpToolsReadiness({
      connected: true,
      policy: requirement.policy,
      selection: requirement.selection,
      servers: input.mcpServers,
      tools: input.mcpTools,
    });
    return {
      ...readiness,
      label: requirement.policy === 'best-effort' ? 'MCP tools (optional)' : 'MCP tools',
      detail: mcpDetail({
        requirement,
        readiness,
        servers: input.mcpServers,
        tools: input.mcpTools,
      }),
    };
  });

  return [...models, credentials, ...mcp];
}
