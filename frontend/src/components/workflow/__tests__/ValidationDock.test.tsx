import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';

// Control validation warnings per test
let validationWarningsMap: Record<string, string[]> = {};
let secretCatalog = { data: [] as { id: string; name: string }[], isLoading: false, error: null };
let mcpServerCatalog = { data: [] as object[], isLoading: false, error: null };
let mcpToolCatalog = { data: [] as object[], isLoading: false, error: null };
let mcpQueryEnabledValues: boolean[] = [];

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: {
      byId: {
        'core.scanner.nmap': {
          id: 'core.scanner.nmap',
          name: 'Nmap Scan',
          inputs: [{ id: 'target', label: 'Target', required: true }],
          outputs: [],
          parameters: [],
        },
        'core.llm.openai': {
          id: 'core.llm.openai',
          name: 'OpenAI Chat',
          inputs: [{ id: 'prompt', label: 'Prompt', required: true }],
          outputs: [],
          parameters: [],
        },
        'core.output.report': {
          id: 'core.output.report',
          name: 'Report',
          inputs: [],
          outputs: [],
          parameters: [],
        },
        'core.ai.agent': {
          id: 'core.ai.agent',
          slug: 'ai-agent',
          name: 'AI Agent',
          inputs: [
            {
              id: 'chatModel',
              label: 'Model',
              editor: 'llm-provider',
              connectionType: { kind: 'contract', name: 'core.ai.llm-provider.v1' },
            },
            { id: 'tools', label: 'Tools', connectionType: { kind: 'contract', name: 'mcp.tool' } },
          ],
          outputs: [],
          parameters: [],
        },
        'mcp.custom': {
          id: 'mcp.custom',
          slug: 'mcp.custom',
          name: 'Custom MCP',
          inputs: [],
          outputs: [],
          parameters: [],
        },
      },
      slugIndex: {},
    },
    isLoading: false,
  }),
}));

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => secretCatalog,
}));

mock.module('@/hooks/queries/useMcpServerQueries', () => ({
  useMcpServers: (options?: { enabled?: boolean }) => {
    mcpQueryEnabledValues.push(options?.enabled ?? true);
    return mcpServerCatalog;
  },
  useMcpAllTools: (options?: { enabled?: boolean }) => {
    mcpQueryEnabledValues.push(options?.enabled ?? true);
    return mcpToolCatalog;
  },
}));

mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

mock.module('@/utils/connectionValidation', () => ({
  getNodeValidationWarnings: (node: Node<FrontendNodeData>) => {
    return validationWarningsMap[node.id] || [];
  },
}));

const { ValidationDock } = await import('../ValidationDock');

function createNode(id: string, componentId: string, label: string): Node<FrontendNodeData> {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      label,
      config: { params: {}, inputOverrides: {} },
      componentId,
      status: 'idle',
    } as FrontendNodeData,
  };
}

describe('ValidationDock', () => {
  afterEach(() => {
    cleanup();
    validationWarningsMap = {};
    secretCatalog = { data: [], isLoading: false, error: null };
    mcpServerCatalog = { data: [], isLoading: false, error: null };
    mcpToolCatalog = { data: [], isLoading: false, error: null };
    mcpQueryEnabledValues = [];
  });

  it('shows "All validated" when there are no issues', () => {
    const nodes = [createNode('n1', 'core.output.report', 'Report')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(screen.getByText('All validated')).toBeInTheDocument();
  });

  it('keeps MCP catalog queries skipped without a connected custom MCP tool edge', () => {
    const nodes = [createNode('n1', 'core.output.report', 'Report')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(mcpQueryEnabledValues).toEqual([false, false]);
  });

  it('prompts for a runnable step when the graph only contains the entry point', () => {
    const nodes = [createNode('entry', 'core.workflow.entrypoint', 'Entry Point')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(screen.getByText('Add a step to make this runnable')).toBeInTheDocument();
    expect(screen.queryByText('All validated')).not.toBeInTheDocument();
  });

  it('displays validation issues with node names and messages', () => {
    validationWarningsMap = {
      n1: ['Missing required input: Target'],
      n2: ['Missing required input: Prompt'],
    };

    const nodes = [
      createNode('n1', 'core.scanner.nmap', 'Nmap Scan'),
      createNode('n2', 'core.llm.openai', 'OpenAI Chat'),
    ];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(screen.getByText('2 issues')).toBeInTheDocument();
    expect(screen.getByText('Nmap Scan')).toBeInTheDocument();
    expect(screen.getByText('· Missing required input: Target')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Chat')).toBeInTheDocument();
    expect(screen.getByText('· Missing required input: Prompt')).toBeInTheDocument();
  });

  it('shows singular "issue" label for a single issue', () => {
    validationWarningsMap = {
      n1: ['Missing required input: Target'],
    };

    const nodes = [createNode('n1', 'core.scanner.nmap', 'Nmap Scan')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(screen.getByText('1 issue')).toBeInTheDocument();
  });

  it('calls onNodeClick with nodeId when an issue is clicked', () => {
    validationWarningsMap = {
      n1: ['Missing required input: Target'],
    };

    const nodes = [createNode('n1', 'core.scanner.nmap', 'Nmap Scan')];
    const onNodeClick = mock(() => {});

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={onNodeClick} />);

    fireEvent.click(screen.getByText('Nmap Scan'));
    expect(onNodeClick).toHaveBeenCalledWith('n1');
  });

  it('returns null when not in design mode', () => {
    const nodes = [createNode('n1', 'core.scanner.nmap', 'Nmap Scan')];

    const { container } = render(
      <ValidationDock nodes={nodes} edges={[]} mode="execution" onNodeClick={mock(() => {})} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows expand/collapse button when issues exceed threshold', () => {
    validationWarningsMap = {
      n1: ['Warning 1', 'Warning 2', 'Warning 3'],
    };

    const nodes = [createNode('n1', 'core.scanner.nmap', 'Nmap Scan')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    // 3 issues > threshold of 2 → expand/collapse control should appear
    expect(screen.getByText('3 issues')).toBeInTheDocument();
    expect(screen.getByText('Expand')).toBeInTheDocument();
  });

  it('toggles expand/collapse when header is clicked', () => {
    validationWarningsMap = {
      n1: ['Warning 1', 'Warning 2', 'Warning 3'],
    };

    const nodes = [createNode('n1', 'core.scanner.nmap', 'Nmap Scan')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(screen.getByText('Expand')).toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('3 issues'));
    expect(screen.getByText('Collapse')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByText('3 issues'));
    expect(screen.getByText('Expand')).toBeInTheDocument();
  });

  it('links a missing generic-agent model issue to the agent node', () => {
    const agent = createNode('agent', 'core.ai.agent', 'Agent');
    const onNodeClick = mock(() => {});

    render(<ValidationDock nodes={[agent]} edges={[]} mode="design" onNodeClick={onNodeClick} />);

    fireEvent.click(screen.getByText(/Not configured: Choose a supported provider and a model\./));
    fireEvent.click(
      screen.getByText(/Needs mapping: Select a stored secret for this credential\./),
    );

    expect(onNodeClick).toHaveBeenNthCalledWith(1, 'agent');
    expect(onNodeClick).toHaveBeenNthCalledWith(2, 'agent');
  });

  it('shows Needs mapping for a deleted agent credential', () => {
    const agent = createNode('agent', 'core.ai.agent', 'Agent');
    agent.data.config.inputOverrides = {
      chatModel: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'deleted-secret' },
    };

    render(
      <ValidationDock nodes={[agent]} edges={[]} mode="design" onNodeClick={mock(() => {})} />,
    );

    expect(
      screen.getByText(/Needs mapping: The referenced stored secret no longer exists\./),
    ).toBeInTheDocument();
  });

  it('does not flag optional degraded MCP tools', () => {
    secretCatalog = {
      data: [{ id: 'secret-1', name: 'OPENAI_API_KEY' }],
      isLoading: false,
      error: null,
    };
    mcpServerCatalog = {
      data: [
        {
          id: 'server-1',
          name: 'MCP Server',
          transportType: 'http',
          hasHeaders: false,
          enabled: true,
          lastHealthStatus: 'unhealthy',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    };
    mcpToolCatalog = {
      data: [
        {
          id: 'tool-1',
          toolName: 'search',
          serverId: 'server-1',
          serverName: 'MCP Server',
          enabled: true,
          discoveredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    };
    const agent = createNode('agent', 'core.ai.agent', 'Agent');
    agent.data.config = {
      params: { toolAvailability: 'best-effort' },
      inputOverrides: {
        chatModel: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' },
      },
    };
    const mcp = createNode('mcp', 'mcp.custom', 'MCP');
    mcp.data.config.params = { enabledServers: ['server-1'] };

    render(
      <ValidationDock
        nodes={[agent, mcp]}
        edges={[{ id: 'mcp-tools', source: 'mcp', target: 'agent', targetHandle: 'tools' }]}
        mode="design"
        onNodeClick={mock(() => {})}
      />,
    );

    expect(screen.getByText('All validated')).toBeInTheDocument();
  });

  it('flags required MCP with no usable tools', () => {
    secretCatalog = {
      data: [{ id: 'secret-1', name: 'OPENAI_API_KEY' }],
      isLoading: false,
      error: null,
    };
    mcpServerCatalog = {
      data: [
        {
          id: 'server-1',
          name: 'MCP Server',
          transportType: 'http',
          hasHeaders: false,
          enabled: true,
          lastHealthStatus: 'healthy',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    };
    mcpToolCatalog = {
      data: [
        {
          id: 'tool-1',
          toolName: 'search',
          serverId: 'server-1',
          serverName: 'MCP Server',
          enabled: false,
          discoveredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    };
    const agent = createNode('agent', 'core.ai.agent', 'Agent');
    agent.data.config.inputOverrides = {
      chatModel: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' },
    };
    const mcp = createNode('mcp', 'mcp.custom', 'MCP');
    mcp.data.config.params = { enabledServers: ['server-1'] };

    render(
      <ValidationDock
        nodes={[agent, mcp]}
        edges={[{ id: 'mcp-tools', source: 'mcp', target: 'agent', targetHandle: 'tools' }]}
        mode="design"
        onNodeClick={mock(() => {})}
      />,
    );

    expect(
      screen.getByText(/Not configured: No selected MCP servers expose usable tools\./),
    ).toBeInTheDocument();
  });
});
