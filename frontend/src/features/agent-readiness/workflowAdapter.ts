import type { Edge, Node } from '@xyflow/react';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import type { ComponentMetadata } from '@/schemas/component';
import type { FrontendNodeData } from '@/schemas/node';
import type { SecretSummary } from '@/schemas/secret';
import { getNodeValidationWarnings } from '@/utils/connectionValidation';
import {
  evaluateLlmProviderReadiness,
  evaluateMcpCapabilitiesReadiness,
  findLlmProviderInput,
  getAcceptedLlmProviderIds,
  getProducedLlmProviderId,
  type AgentReadinessRow,
  type CatalogState,
  type McpSelection,
} from './readiness';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function inputOverrides(node: Node<FrontendNodeData>): Record<string, unknown> {
  return asRecord(asRecord(node.data.config).inputOverrides);
}

function parameters(node: Node<FrontendNodeData>): Record<string, unknown> {
  return asRecord(asRecord(node.data.config).params);
}

function sourceLabel(edge: Edge, nodes: readonly Node<FrontendNodeData>[]): string {
  const source = nodes.find((node) => node.id === edge.source);
  return source?.data.label?.trim() || edge.source;
}

function selection(node: Node<FrontendNodeData>): McpSelection {
  const params = parameters(node);
  return {
    useAllEnabled: params.useAllEnabled === true,
    serverIds: stringValues(params.enabledServers),
    toolExclusions: stringValues(params.toolExclusions),
  };
}

function toolAvailability(node: Node<FrontendNodeData>): 'required' | 'best-effort' {
  return parameters(node).toolAvailability === 'best-effort' ? 'best-effort' : 'required';
}

function componentRef(node: Node<FrontendNodeData>): string | undefined {
  return node.data.componentId ?? node.data.componentSlug;
}

function connectedMcpCustomToolEdges(input: {
  nodes: readonly Node<FrontendNodeData>[];
  edges: readonly Edge[];
  getComponent: (ref: string | undefined) => ComponentMetadata | null;
}): Edge[] {
  return input.edges.filter((edge) => {
    if (edge.targetHandle !== 'tools') return false;
    const source = input.nodes.find((node) => node.id === edge.source);
    const target = input.nodes.find((node) => node.id === edge.target);
    const targetComponent = input.getComponent(target ? componentRef(target) : undefined);
    return (
      input.getComponent(source ? componentRef(source) : undefined)?.id === 'mcp.custom' &&
      Boolean(
        targetComponent &&
        findLlmProviderInput(target?.data.dynamicInputs ?? targetComponent.inputs),
      )
    );
  });
}

export function hasConnectedWorkflowMcpCustom(input: {
  nodes: readonly Node<FrontendNodeData>[];
  edges: readonly Edge[];
  getComponent: (ref: string | undefined) => ComponentMetadata | null;
}): boolean {
  return connectedMcpCustomToolEdges(input).length > 0;
}

export function evaluateWorkflowAgentNodeReadiness(input: {
  node: Node<FrontendNodeData>;
  component: ComponentMetadata;
  nodes: readonly Node<FrontendNodeData>[];
  edges: readonly Edge[];
  getComponent: (ref: string | undefined) => ComponentMetadata | null;
  secrets: CatalogState<SecretSummary>;
  mcpServers: CatalogState<McpServerResponse>;
  mcpTools: CatalogState<McpToolResponse>;
}): AgentReadinessRow[] {
  const llmInput = findLlmProviderInput(input.node.data.dynamicInputs ?? input.component.inputs);
  if (!llmInput) return [];

  const connectedProvider = input.edges.find(
    (edge) => edge.target === input.node.id && edge.targetHandle === llmInput.id,
  );
  const connectedProviderNode = connectedProvider
    ? input.nodes.find((node) => node.id === connectedProvider.source)
    : undefined;
  const connectedProviderComponent = input.getComponent(
    connectedProviderNode ? componentRef(connectedProviderNode) : undefined,
  );
  const rows = evaluateLlmProviderReadiness({
    value: inputOverrides(input.node)[llmInput.id],
    connectedSource: connectedProvider ? sourceLabel(connectedProvider, input.nodes) : undefined,
    connectedProviderId:
      connectedProvider && connectedProviderComponent
        ? getProducedLlmProviderId(
            connectedProviderComponent.outputs,
            connectedProvider.sourceHandle,
          )
        : undefined,
    acceptedProviderIds: getAcceptedLlmProviderIds(llmInput),
    supportedAuthModes:
      input.component.id === 'core.ai.claude-code'
        ? ['api_key', 'subscription_oauth']
        : ['api_key'],
    secrets: input.secrets,
  });

  const mcpEdges = connectedMcpCustomToolEdges(input).filter(
    (edge) => edge.target === input.node.id,
  );

  if (mcpEdges.length === 0) {
    return [
      ...rows,
      evaluateMcpCapabilitiesReadiness({
        connected: false,
        policy: toolAvailability(input.node),
        servers: input.mcpServers,
        tools: input.mcpTools,
      }),
    ];
  }

  return [
    ...rows,
    ...mcpEdges.map((edge) => {
      const source = input.nodes.find((node) => node.id === edge.source);
      return evaluateMcpCapabilitiesReadiness({
        connected: true,
        policy: toolAvailability(input.node),
        selection: source ? selection(source) : undefined,
        servers: input.mcpServers,
        tools: input.mcpTools,
      });
    }),
  ];
}

export interface WorkflowRunReadinessIssue {
  nodeId: string;
  nodeLabel: string;
  message: string;
}

export interface WorkflowRunReadiness {
  rows: AgentReadinessRow[];
  issues: WorkflowRunReadinessIssue[];
  configurationIssues: WorkflowRunReadinessIssue[];
}

export function evaluateWorkflowRunReadiness(input: {
  nodes: readonly Node<FrontendNodeData>[];
  edges: readonly Edge[];
  getComponent: (ref: string | undefined) => ComponentMetadata | null;
  secrets: CatalogState<SecretSummary>;
  mcpServers: CatalogState<McpServerResponse>;
  mcpTools: CatalogState<McpToolResponse>;
}): WorkflowRunReadiness {
  const rows: AgentReadinessRow[] = [];
  const issues: WorkflowRunReadinessIssue[] = [];
  const configurationIssues: WorkflowRunReadinessIssue[] = [];

  for (const node of input.nodes) {
    const component = input.getComponent(componentRef(node));
    if (!component) continue;

    const nodeLabel = node.data.label || component.name || node.id;
    for (const message of getNodeValidationWarnings(node, [...input.edges], component, [
      ...input.secrets.items,
    ])) {
      const issue = { nodeId: node.id, nodeLabel, message };
      issues.push(issue);
      configurationIssues.push(issue);
    }

    const nodeRows = evaluateWorkflowAgentNodeReadiness({
      node,
      component,
      nodes: input.nodes,
      edges: input.edges,
      getComponent: input.getComponent,
      secrets: input.secrets,
      mcpServers: input.mcpServers,
      mcpTools: input.mcpTools,
    });
    rows.push(
      ...nodeRows.map((row, index) => ({
        ...row,
        id: `${node.id}:${row.kind}:${index}`,
        label: `${nodeLabel}: ${row.label}`,
      })),
    );
    for (const row of nodeRows) {
      if (!row.blocksExecution) continue;
      issues.push({
        nodeId: node.id,
        nodeLabel,
        message: `${row.label}: ${row.detail}`,
      });
    }
  }

  return { rows, issues, configurationIssues };
}
