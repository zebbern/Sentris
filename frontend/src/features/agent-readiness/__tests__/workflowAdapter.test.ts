import { describe, expect, it } from 'bun:test';
import type { Edge, Node } from '@xyflow/react';
import type { ComponentMetadata } from '@/schemas/component';
import type { FrontendNodeData } from '@/schemas/node';
import type { SecretSummary } from '@/schemas/secret';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import type { CatalogState } from '../readiness';
import { evaluateWorkflowAgentNodeReadiness } from '../workflowAdapter';

const secretCatalog: CatalogState<SecretSummary> = {
  items: [
    {
      id: 'secret-1',
      name: 'OPENAI_API_KEY',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  isLoading: false,
  error: null,
};

const agentComponent = (id = 'core.ai.agent', inputId = 'chatModel') =>
  ({
    id,
    slug: id,
    name: 'AI Agent',
    inputs: [
      {
        id: inputId,
        label: 'Model',
        editor: 'llm-provider',
        connectionType: { kind: 'contract', name: 'core.ai.llm-provider.v1' },
      },
      { id: 'tools', label: 'Tools', connectionType: { kind: 'contract', name: 'mcp.tool' } },
    ],
    outputs: [],
    parameters: [],
  }) as unknown as ComponentMetadata;

const customMcpComponent = {
  id: 'mcp.custom',
  slug: 'mcp.custom',
  name: 'Custom MCP',
  inputs: [],
  outputs: [],
  parameters: [],
} as unknown as ComponentMetadata;

function node(
  id: string,
  componentId: string,
  config: FrontendNodeData['config'] = { params: {}, inputOverrides: {} },
  label = componentId,
): Node<FrontendNodeData> {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: { label, componentId, config },
  } as Node<FrontendNodeData>;
}

const server = (overrides: Partial<McpServerResponse> = {}): McpServerResponse => ({
  id: 'server-1',
  name: 'MCP Server',
  transportType: 'http',
  hasHeaders: false,
  enabled: true,
  lastHealthStatus: 'healthy',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const tool = (overrides: Partial<McpToolResponse> = {}): McpToolResponse => ({
  id: 'tool-1',
  toolName: 'search',
  serverId: 'server-1',
  serverName: 'MCP Server',
  enabled: true,
  discoveredAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function evaluate(input: {
  component?: ComponentMetadata;
  agent?: Node<FrontendNodeData>;
  nodes?: Node<FrontendNodeData>[];
  edges?: Edge[];
  servers?: McpServerResponse[];
  tools?: McpToolResponse[];
}) {
  const component = input.component ?? agentComponent();
  const agent =
    input.agent ??
    node('agent', component.id, {
      params: {},
      inputOverrides: {
        chatModel: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' },
      },
    });
  const nodes = input.nodes ?? [agent];
  const components = new Map<string, ComponentMetadata>([
    [component.id, component],
    [customMcpComponent.id, customMcpComponent],
  ]);

  return evaluateWorkflowAgentNodeReadiness({
    node: agent,
    component,
    nodes,
    edges: input.edges ?? [],
    getComponent: (ref) => (ref ? (components.get(ref) ?? null) : null),
    secrets: secretCatalog,
    mcpServers: { items: input.servers ?? [], isLoading: false, error: null },
    mcpTools: { items: input.tools ?? [], isLoading: false, error: null },
  });
}

describe('evaluateWorkflowAgentNodeReadiness', () => {
  it('uses the semantic llm-provider input and its raw override', () => {
    const component = agentComponent('core.ai.agent', 'chatModel');
    const agent = node('agent', component.id, {
      params: {},
      inputOverrides: {
        chatModel: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' },
        model: { provider: 'not-real', modelId: '' },
      },
    });

    expect(evaluate({ component, agent })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'model', state: 'ready' }),
        expect.objectContaining({ kind: 'credential', label: 'Mapped' }),
      ]),
    );
  });

  it('uses the connected provider node label for model and credential readiness', () => {
    const component = agentComponent();
    const agent = node('agent', component.id);
    const provider = node('provider', 'core.llm.openai', undefined, 'Primary OpenAI');

    expect(
      evaluate({
        component,
        agent,
        nodes: [agent, provider],
        edges: [
          {
            id: 'provider-to-agent',
            source: 'provider',
            sourceHandle: 'model',
            target: 'agent',
            targetHandle: 'chatModel',
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'model', label: 'Connected' }),
        expect.objectContaining({ kind: 'credential', label: 'Connected' }),
      ]),
    );
  });

  it('evaluates only mcp.custom edges connected to the tools handle', () => {
    const component = agentComponent();
    const agent = node('agent', component.id);
    const mcp = node('mcp', 'mcp.custom', {
      params: {
        enabledServers: ['server-1', 42],
        useAllEnabled: 'yes',
        toolExclusions: ['server-1:search', false],
      },
      inputOverrides: {},
    });

    const ignored = evaluate({
      component,
      agent,
      nodes: [agent, mcp],
      edges: [{ id: 'wrong-handle', source: 'mcp', target: 'agent', targetHandle: 'prompt' }],
      servers: [server()],
      tools: [tool()],
    });
    const required = evaluate({
      component,
      agent,
      nodes: [agent, mcp],
      edges: [{ id: 'tools-handle', source: 'mcp', target: 'agent', targetHandle: 'tools' }],
      servers: [server()],
      tools: [tool()],
    });

    expect(ignored.find((row) => row.kind === 'mcp-tools')).toMatchObject({
      label: 'Not connected',
      blocksExecution: false,
    });
    expect(required.find((row) => row.kind === 'mcp-tools')).toMatchObject({
      label: 'Not configured',
      blocksExecution: true,
    });
  });

  it('uses mcp selection and agent tool policy through the readiness domain', () => {
    const component = agentComponent();
    const agent = node('agent', component.id, {
      params: { toolAvailability: 'best-effort' },
      inputOverrides: {
        chatModel: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' },
      },
    });
    const mcp = node('mcp', 'mcp.custom', {
      params: { enabledServers: [], useAllEnabled: true, toolExclusions: ['server-1:search'] },
      inputOverrides: {},
    });

    expect(
      evaluate({
        component,
        agent,
        nodes: [agent, mcp],
        edges: [{ id: 'tools-handle', source: 'mcp', target: 'agent', targetHandle: 'tools' }],
        servers: [server()],
        tools: [tool()],
      }).find((row) => row.kind === 'mcp-tools'),
    ).toMatchObject({ state: 'degraded', blocksExecution: false });
  });

  it('permits subscription OAuth only for the Claude Code component', () => {
    const config = {
      params: {},
      inputOverrides: {
        chatModel: {
          provider: 'anthropic',
          modelId: 'claude-sonnet',
          authMode: 'subscription_oauth',
          oauthTokenSecretId: 'secret-1',
        },
      },
    };
    const generic = agentComponent();
    const openCode = agentComponent('core.ai.opencode');
    const claude = agentComponent('core.ai.claude-code');

    expect(
      evaluate({ component: generic, agent: node('agent', generic.id, config) }).find(
        (row) => row.kind === 'credential',
      ),
    ).toMatchObject({ state: 'error', blocksExecution: true });
    expect(
      evaluate({ component: openCode, agent: node('agent', openCode.id, config) }).find(
        (row) => row.kind === 'credential',
      ),
    ).toMatchObject({ state: 'error', blocksExecution: true });
    expect(
      evaluate({ component: claude, agent: node('agent', claude.id, config) }).find(
        (row) => row.kind === 'credential',
      ),
    ).toMatchObject({ state: 'ready', blocksExecution: false });
  });
});
