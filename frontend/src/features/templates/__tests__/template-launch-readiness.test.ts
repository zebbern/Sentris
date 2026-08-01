import { describe, expect, it } from 'bun:test';
import type { ComponentMetadata } from '@/schemas/component';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import {
  evaluateTemplateLaunchReadiness,
  parseTemplateLaunchRequirements,
} from '../template-launch-readiness';

const agent = (id = 'core.ai.agent', inputId = 'chatModel') =>
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
    ],
    outputs: [],
    parameters: [],
  }) as unknown as ComponentMetadata;

const customMcp = {
  id: 'mcp.custom',
  slug: 'mcp.custom',
  name: 'Custom MCP',
  inputs: [],
  outputs: [],
  parameters: [],
} as unknown as ComponentMetadata;

const unmarkedComponent = {
  id: 'core.process.unmarked',
  slug: 'core.process.unmarked',
  name: 'Unmarked',
  inputs: [{ id: 'chatModel', label: 'Model' }],
  outputs: [],
  parameters: [],
} as unknown as ComponentMetadata;

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

function parse(
  graph: Record<string, unknown> | undefined,
  components: readonly ComponentMetadata[] = [agent(), customMcp],
) {
  const byRef = new Map<string, ComponentMetadata>();
  for (const component of components) {
    byRef.set(component.id, component);
    byRef.set(component.slug, component);
  }
  return parseTemplateLaunchRequirements(graph, (ref) => byRef.get(ref) ?? null);
}

function evaluate(requirements: ReturnType<typeof parse>, overrides: Record<string, unknown> = {}) {
  return evaluateTemplateLaunchReadiness({
    requirements,
    requiredSecretNames: [],
    secretMappings: {},
    secrets: { items: [], isLoading: false, error: null },
    mcpServers: { items: [], isLoading: false, error: null },
    mcpTools: { items: [], isLoading: false, error: null },
    componentCatalog: { isLoading: false, error: null },
    ...overrides,
  });
}

const geminiTemplateGraph = {
  nodes: [
    {
      id: 'custom_mcp_tools',
      type: 'mcp.custom',
      data: {
        config: {
          params: { enabledServers: [], useAllEnabled: true, toolExclusions: [] },
          inputOverrides: {},
        },
      },
    },
    {
      id: 'gemini_investigator',
      type: 'core.ai.agent',
      data: {
        config: {
          params: { toolAvailability: 'best-effort' },
          inputOverrides: {
            chatModel: {
              provider: 'gemini',
              modelId: 'gemini-3.5-flash',
              apiKeySecretId: '{{SECRET:GEMINI_API_KEY}}',
            },
          },
        },
      },
    },
  ],
  edges: [
    {
      id: 'custom_mcp_tools-tools-gemini_investigator-tools',
      source: 'custom_mcp_tools',
      target: 'gemini_investigator',
      targetHandle: 'tools',
    },
  ],
};

describe('template launch readiness', () => {
  it('returns empty requirements for missing and malformed graphs', () => {
    expect(parse(undefined)).toEqual({ models: [], mcp: [] });
    expect(parse({ nodes: {}, edges: 'not-an-array' })).toEqual({ models: [], mcp: [] });
  });

  it('extracts different editor-marked input IDs and deduplicates identical provider-model pairs', () => {
    const first = agent('core.ai.agent', 'primaryModel');
    const second = agent('core.ai.agent.secondary', 'secondaryModel');
    const requirements = parse(
      {
        nodes: [
          {
            id: 'first',
            data: {
              componentId: first.id,
              config: {
                inputOverrides: { primaryModel: { provider: 'openai', modelId: 'gpt-5' } },
              },
            },
          },
          {
            id: 'second',
            data: {
              componentSlug: second.slug,
              config: {
                inputOverrides: { secondaryModel: { provider: 'openai', modelId: 'gpt-5' } },
              },
            },
          },
        ],
        edges: [],
      },
      [first, second, customMcp],
    );

    expect(requirements.models).toEqual([
      expect.objectContaining({
        componentId: first.id,
        inputId: 'primaryModel',
        provider: 'openai',
        modelId: 'gpt-5',
        nodeCount: 2,
      }),
    ]);
  });

  it('ignores provider-shaped overrides on ports without the llm-provider editor', () => {
    expect(
      parse(
        {
          nodes: [
            {
              id: 'unmarked',
              type: unmarkedComponent.id,
              data: {
                config: { inputOverrides: { chatModel: { provider: 'openai', modelId: 'gpt-5' } } },
              },
            },
          ],
          edges: [],
        },
        [unmarkedComponent, customMcp],
      ).models,
    ).toEqual([]);
  });

  it('preserves an exact model id absent from the curated catalog', () => {
    const modelId = 'vendor/model:release-candidate+custom';
    expect(
      parse({
        nodes: [
          {
            id: 'agent',
            type: 'core.ai.agent',
            data: { config: { inputOverrides: { chatModel: { provider: 'openai', modelId } } } },
          },
        ],
        edges: [],
      }).models[0]?.modelId,
    ).toBe(modelId);
  });

  it('uses the canonical provider label for OpenRouter and preserves non-ready model detail', () => {
    const openRouterRequirements = parse({
      nodes: [
        {
          id: 'agent',
          type: 'core.ai.agent',
          data: {
            config: {
              inputOverrides: {
                chatModel: { provider: 'openrouter', modelId: 'openrouter/auto' },
              },
            },
          },
        },
      ],
      edges: [],
    });
    const invalidRequirements = parse({
      nodes: [
        {
          id: 'agent',
          type: 'core.ai.agent',
          data: {
            config: {
              inputOverrides: {
                chatModel: { provider: 'unrecognized-provider', modelId: 'custom-model' },
              },
            },
          },
        },
      ],
      edges: [],
    });

    expect(evaluate(openRouterRequirements).find((row) => row.kind === 'model')).toMatchObject({
      state: 'ready',
      label: 'OpenRouter · openrouter/auto',
    });
    expect(evaluate(invalidRequirements).find((row) => row.kind === 'model')).toMatchObject({
      state: 'not-configured',
      label: 'unrecognized-provider · custom-model',
      detail: 'Choose a supported provider and a model.',
    });
  });

  it('blocks unsupported OAuth template models while allowing Claude Code OAuth', () => {
    const genericRequirements = parse({
      nodes: [
        {
          id: 'generic',
          type: 'core.ai.agent',
          data: {
            config: {
              inputOverrides: {
                chatModel: {
                  provider: 'openai',
                  modelId: 'gpt-5',
                  authMode: 'subscription_oauth',
                },
              },
            },
          },
        },
      ],
      edges: [],
    });
    const claude = agent('core.ai.claude-code');
    const claudeRequirements = parse(
      {
        nodes: [
          {
            id: 'claude',
            type: 'core.ai.claude-code',
            data: {
              config: {
                inputOverrides: {
                  chatModel: {
                    provider: 'anthropic',
                    modelId: 'claude-sonnet-5',
                    authMode: 'subscription_oauth',
                  },
                },
              },
            },
          },
        ],
        edges: [],
      },
      [claude, customMcp],
    );

    expect(evaluate(genericRequirements).find((row) => row.kind === 'model')).toMatchObject({
      state: 'error',
      label: 'OpenAI · gpt-5',
      blocksCreation: true,
    });
    expect(evaluate(claudeRequirements).find((row) => row.kind === 'model')).toMatchObject({
      state: 'ready',
      label: 'Anthropic · claude-sonnet-5',
      blocksCreation: false,
    });
  });

  it('blocks mixed Claude Code and generic OAuth configurations regardless of node order', () => {
    const claude = agent('core.ai.claude-code');
    const generic = agent('core.ai.agent');
    const nodeFor = (id: string, type: string) => ({
      id,
      type,
      data: {
        config: {
          inputOverrides: {
            chatModel: {
              provider: 'anthropic',
              modelId: 'claude-sonnet-5',
              authMode: 'subscription_oauth',
            },
          },
        },
      },
    });
    const evaluateOrder = (nodes: Record<string, unknown>[]) =>
      evaluate(parse({ nodes, edges: [] }, [claude, generic, customMcp])).find(
        (row) => row.kind === 'model',
      );

    const claudeFirst = evaluateOrder([
      nodeFor('claude', claude.id),
      nodeFor('generic', generic.id),
    ]);
    const genericFirst = evaluateOrder([
      nodeFor('generic', generic.id),
      nodeFor('claude', claude.id),
    ]);

    expect(claudeFirst).toMatchObject({
      state: 'error',
      blocksCreation: true,
      label: 'Anthropic · claude-sonnet-5 (2 agents)',
    });
    expect(genericFirst).toMatchObject({
      state: 'error',
      blocksCreation: true,
      label: 'Anthropic · claude-sonnet-5 (2 agents)',
    });
  });

  it('extracts use-all, explicit server, exclusion, and target-agent policy settings', () => {
    const graph = {
      nodes: [
        {
          id: 'all',
          type: 'mcp.custom',
          data: {
            config: { params: { useAllEnabled: true, toolExclusions: ['server-1:search'] } },
          },
        },
        {
          id: 'explicit',
          type: 'mcp.custom',
          data: { config: { params: { enabledServers: ['server-2'] } } },
        },
        {
          id: 'optional-agent',
          type: 'core.ai.agent',
          data: { config: { params: { toolAvailability: 'best-effort' } } },
        },
        { id: 'required-agent', type: 'core.ai.agent', data: { config: { params: {} } } },
      ],
      edges: [
        { source: 'all', target: 'optional-agent', targetHandle: 'tools' },
        { source: 'explicit', target: 'required-agent', targetHandle: 'tools' },
      ],
    };

    expect(parse(graph).mcp).toEqual([
      expect.objectContaining({
        mcpNodeId: 'all',
        agentNodeId: 'optional-agent',
        policy: 'best-effort',
        selection: { useAllEnabled: true, serverIds: [], toolExclusions: ['server-1:search'] },
      }),
      expect.objectContaining({
        mcpNodeId: 'explicit',
        agentNodeId: 'required-agent',
        policy: 'required',
        selection: { useAllEnabled: false, serverIds: ['server-2'], toolExclusions: [] },
      }),
    ]);
  });

  it('ignores an unconnected mcp.custom node', () => {
    expect(
      parse({
        nodes: [geminiTemplateGraph.nodes[0]],
        edges: [],
      }).mcp,
    ).toEqual([]);
  });

  it('creates one MCP requirement per connected target agent', () => {
    const graph = {
      ...geminiTemplateGraph,
      nodes: [
        geminiTemplateGraph.nodes[0],
        geminiTemplateGraph.nodes[1],
        { id: 'second-agent', type: 'core.ai.agent', data: { config: { params: {} } } },
      ],
      edges: [
        ...geminiTemplateGraph.edges,
        { source: 'custom_mcp_tools', target: 'second-agent', targetHandle: 'tools' },
        { source: 'custom_mcp_tools', target: 'second-agent', targetHandle: 'tools' },
      ],
    };

    expect(parse(graph).mcp.map((requirement) => requirement.agentNodeId)).toEqual([
      'gemini_investigator',
      'second-agent',
    ]);
  });

  it('selects every enabled server for useAllEnabled and ignores disabled servers', () => {
    const requirements = parse(geminiTemplateGraph);
    expect(
      evaluate(requirements, {
        mcpServers: {
          items: [
            server(),
            server({ id: 'server-2', enabled: false, lastHealthStatus: 'unhealthy' }),
          ],
          isLoading: false,
          error: null,
        },
        mcpTools: { items: [tool()], isLoading: false, error: null },
      }).find((row) => row.kind === 'mcp-tools'),
    ).toMatchObject({ state: 'ready' });
  });

  it('selects only explicitly configured enabled server IDs', () => {
    const requirements = parse({
      nodes: [
        {
          id: 'mcp',
          type: 'mcp.custom',
          data: { config: { params: { enabledServers: ['server-1'] } } },
        },
        { id: 'agent', type: 'core.ai.agent', data: { config: { params: {} } } },
      ],
      edges: [{ source: 'mcp', target: 'agent', targetHandle: 'tools' }],
    });
    expect(
      evaluate(requirements, {
        mcpServers: {
          items: [server(), server({ id: 'server-2', lastHealthStatus: 'unhealthy' })],
          isLoading: false,
          error: null,
        },
        mcpTools: { items: [tool()], isLoading: false, error: null },
      }).find((row) => row.kind === 'mcp-tools'),
    ).toMatchObject({ state: 'ready' });
  });

  it('excludes disabled and template-excluded tools from readiness counts', () => {
    const requirements = parse({
      nodes: [
        {
          id: 'mcp',
          type: 'mcp.custom',
          data: {
            config: {
              params: { enabledServers: ['server-1'], toolExclusions: ['server-1:search'] },
            },
          },
        },
        { id: 'agent', type: 'core.ai.agent', data: { config: { params: {} } } },
      ],
      edges: [{ source: 'mcp', target: 'agent', targetHandle: 'tools' }],
    });
    expect(
      evaluate(requirements, {
        mcpServers: { items: [server()], isLoading: false, error: null },
        mcpTools: {
          items: [tool(), tool({ id: 'disabled', toolName: 'disabled', enabled: false })],
          isLoading: false,
          error: null,
        },
      }).find((row) => row.kind === 'mcp-tools'),
    ).toMatchObject({ state: 'not-configured', blocksCreation: true });
  });

  it('keeps the current Gemini template best-effort MCP state non-blocking', () => {
    const requirements = parse(geminiTemplateGraph);
    expect(requirements.models).toEqual([
      expect.objectContaining({ provider: 'gemini', modelId: 'gemini-3.5-flash' }),
    ]);
    expect(evaluate(requirements).find((row) => row.kind === 'mcp-tools')).toMatchObject({
      state: 'degraded',
      blocksCreation: false,
      blocksExecution: false,
    });
  });

  it('reports unavailable component metadata instead of treating the template as ready', () => {
    expect(
      evaluate(
        { models: [], mcp: [] },
        { componentCatalog: { isLoading: false, error: Error('offline') } },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'model', state: 'error', blocksCreation: true }),
      ]),
    );
  });
});
