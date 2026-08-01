import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Node } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';
import { createStoreMock } from '@/test/mocks/createStoreMock';

// Mock component index with a known component
const mockComponent = {
  id: 'core.scanner.nmap',
  slug: 'nmap-scan',
  name: 'Nmap Scan',
  version: '1.0.0',
  type: 'process' as const,
  category: 'scanner' as const,
  categoryConfig: {
    label: 'Scanner',
    color: 'text-green-600',
    description: 'Security scans',
    emoji: '🔍',
    icon: 'Search',
  },
  description: 'Runs an Nmap port scan on a target host.',
  documentation: 'Nmap scans hosts for open ports.',
  documentationUrl: null,
  icon: 'Search',
  logo: null,
  author: { name: 'SentrisAI', type: 'sentris' as const },
  isLatest: true,
  deprecated: false,
  example: null,
  runner: { kind: 'inline' as const },
  inputs: [
    {
      id: 'target',
      label: 'Target',
      connectionType: { kind: 'primitive', name: 'text' },
      required: true,
    },
  ],
  outputs: [
    {
      id: 'result',
      label: 'Scan Result',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ],
  parameters: [
    {
      id: 'ports',
      label: 'Port Range',
      type: 'text' as const,
      required: false,
      placeholder: '1-1000',
    },
  ],
  examples: [],
};

const mockAgentComponent = {
  ...mockComponent,
  id: 'core.ai.agent',
  slug: 'ai-agent',
  name: 'AI Agent',
  inputs: [
    {
      id: 'chatModel',
      label: 'Chat model',
      editor: 'llm-provider' as const,
      connectionType: { kind: 'contract' as const, name: 'core.ai.llm-provider.v1' },
      required: true,
    },
    {
      id: 'model',
      label: 'Legacy model',
      hidden: true,
      connectionType: { kind: 'primitive' as const, name: 'text' as const },
    },
  ],
};

const mockOpenCodeComponent = {
  ...mockAgentComponent,
  id: 'core.ai.opencode',
  slug: 'opencode',
  name: 'OpenCode',
  inputs: [
    {
      id: 'llmConfig',
      label: 'LLM configuration',
      editor: 'llm-provider' as const,
      connectionType: { kind: 'contract' as const, name: 'core.ai.llm-provider.v1' },
      required: true,
    },
  ],
};

let flowEdges: { source: string; target: string; targetHandle?: string }[] = [];
let flowNodes: { id: string; data: Partial<FrontendNodeData> }[] = [];

let isComponentsLoading = false;

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: isComponentsLoading
      ? undefined
      : {
          byId: {
            'core.scanner.nmap': mockComponent,
            'core.ai.agent': mockAgentComponent,
            'core.ai.opencode': mockOpenCodeComponent,
          },
          slugIndex: {
            'nmap-scan': 'core.scanner.nmap',
            'ai-agent': 'core.ai.agent',
            opencode: 'core.ai.opencode',
          },
        },
    isLoading: isComponentsLoading,
    error: null,
  }),
  useComponent: () => ({ data: null }),
  useAllComponents: () => ({ data: [] }),
  getComponentFromCache: () => null,
}));

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({
    data: [{ id: 'secret-1', name: 'OPENAI_API_KEY' }],
    isLoading: false,
    error: null,
  }),
}));

mock.module('@/hooks/queries/useAgentModelQueries', () => ({
  useAnthropicModels: () => ({ data: undefined, isFetching: false, isError: false }),
}));

mock.module('@/components/inputs/SecretSelect', () => ({
  SecretSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('secret-1')}>
      Select stored secret
    </button>
  ),
}));

mock.module('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: any) => children,
  NodeResizer: () => null,
  Handle: ({ id, ...rest }: any) => <div data-testid={`handle-${id}`} {...rest} />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({
    getEdges: () => flowEdges,
    getNodes: () => flowNodes,
    setEdges: () => {},
    setNodes: () => {},
  }),
  useNodeId: () => 'test-node-id',
  useUpdateNodeInternals: () => () => {},
}));

mock.module('@/store/workflowStore', () => ({
  useWorkflowStore: createStoreMock({ metadata: { id: 'wf-1' }, markDirty: () => {} }),
}));

mock.module('@/hooks/queries/useApiKeyQueries', () => ({
  useApiKeys: () => ({ data: [] }),
  useApiKeyUiStore: createStoreMock({ lastCreatedKey: null }),
}));

mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

mock.module('@/features/workflow-builder/contexts/useWorkflowSchedulesContext', () => ({
  useOptionalWorkflowSchedulesContext: () => null,
}));

mock.module('@/hooks/useDeepCompareEffect', () => ({
  useDeepCompareEffect: () => {},
}));

mock.module('@/services/api', () => ({
  api: {
    components: { resolvePorts: mock(() => Promise.resolve(null)) },
    files: { upload: mock(() => Promise.resolve({ id: 'f-1' })) },
  },
  API_BASE_URL: 'http://localhost:4400/api',
  API_V1_URL: 'http://localhost:4400/api/v1',
  getApiAuthHeaders: () => ({}),
}));

mock.module('@/lib/logger', () => ({
  logger: {
    error: mock(() => {}),
    warn: mock(() => {}),
    info: mock(() => {}),
    debug: mock(() => {}),
  },
}));

mock.module('@/utils/entryPointUtils', () => ({
  ENTRY_COMPONENT_ID: 'core.workflow.entrypoint',
}));

mock.module('@/utils/runtimeInputUtils', () => ({
  normalizeRuntimeInputs: () => [],
}));

let hideConfigInfoSections = true;
const setHideConfigInfoSections = mock((value: boolean) => {
  hideConfigInfoSections = value;
});

mock.module('@/store/userPreferencesStore', () => ({
  useUserPreferencesStore: createStoreMock(() => ({
    hideConfigInfoSections,
    setHideConfigInfoSections,
  })),
}));

const { ConfigPanel } = await import('../ConfigPanel');

function createSelectedNode(overrides: Partial<FrontendNodeData> = {}): Node<FrontendNodeData> {
  return {
    id: 'node-1',
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      label: 'Nmap Scan',
      config: { params: {}, inputOverrides: {} },
      componentId: 'core.scanner.nmap',
      componentSlug: 'nmap-scan',
      componentVersion: '1.0.0',
      status: 'idle',
      inputs: {},
      ...overrides,
    } as FrontendNodeData,
  };
}

describe('ConfigPanel', () => {
  afterEach(() => {
    cleanup();
    isComponentsLoading = false;
    hideConfigInfoSections = true;
    flowEdges = [];
    flowNodes = [];
    setHideConfigInfoSections.mockClear();
  });

  it('returns null when no node is selected', () => {
    const { container } = render(<ConfigPanel selectedNode={null} onClose={mock(() => {})} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders loading state when component data is not available', () => {
    isComponentsLoading = true;

    render(<ConfigPanel selectedNode={createSelectedNode()} onClose={mock(() => {})} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders component info section for a selected node', () => {
    render(<ConfigPanel selectedNode={createSelectedNode()} onClose={mock(() => {})} />);

    // ConfigPanelHeader renders "Configuration" title
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('fires onClose callback when close button is clicked', () => {
    const onClose = mock(() => {});

    render(<ConfigPanel selectedNode={createSelectedNode()} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close panel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error state when component metadata cannot be loaded', () => {
    isComponentsLoading = false;

    // Use a component ID that doesn't exist in the mock
    const node = createSelectedNode({
      componentId: 'nonexistent.component',
      componentSlug: 'nonexistent',
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ConfigPanel selectedNode={node} onClose={mock(() => {})} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("This component's metadata could not be loaded")).toBeInTheDocument();
    expect(screen.getByText('nonexistent.component')).toBeInTheDocument();
  });

  it('renders panel with tool mode header when node is in tool mode', () => {
    const node = createSelectedNode({
      config: { params: {}, inputOverrides: {}, isToolMode: true },
    });

    render(<ConfigPanel selectedNode={node} onClose={mock(() => {})} />);

    expect(screen.getByRole('heading', { name: 'Tool' })).toBeInTheDocument();
  });

  it('hides info sections by default and shows them when toggled off', () => {
    const { rerender } = render(
      <ConfigPanel selectedNode={createSelectedNode()} onClose={mock(() => {})} />,
    );

    expect(screen.getByLabelText('Show info sections?')).toBeInTheDocument();
    expect(screen.queryByText('Documentation')).toBeNull();
    expect(screen.queryByText('Outputs')).toBeNull();
    expect(screen.getByText('Parameters')).toBeInTheDocument();
    expect(screen.getByText('Inputs')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show info sections?'));
    expect(setHideConfigInfoSections).toHaveBeenCalledWith(false);

    hideConfigInfoSections = false;
    rerender(<ConfigPanel selectedNode={createSelectedNode()} onClose={mock(() => {})} />);

    expect(screen.getByLabelText('Hide info sections?')).toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Outputs')).toBeInTheDocument();
  });

  it('uses the editor-marked chatModel input for core.ai.agent', () => {
    const onUpdateNode = mock(() => {});
    const node = createSelectedNode({
      componentId: 'core.ai.agent',
      componentSlug: 'ai-agent',
      config: { params: {}, inputOverrides: { model: { provider: 'openai', modelId: 'wrong' } } },
    });

    render(
      <ConfigPanel selectedNode={node} onClose={mock(() => {})} onUpdateNode={onUpdateNode} />,
    );
    expect(screen.queryByText('Chat model')).toBeNull();
    expect(screen.queryByText('Legacy model')).toBeNull();
    fireEvent.click(screen.getByText('Select stored secret'));

    expect(onUpdateNode).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({
        config: expect.objectContaining({
          inputOverrides: expect.objectContaining({
            chatModel: expect.objectContaining({ apiKeySecretId: 'secret-1' }),
          }),
        }),
      }),
    );
    const updateCalls = (
      onUpdateNode as unknown as {
        mock: { calls: [string, { config: { inputOverrides: Record<string, unknown> } }][] };
      }
    ).mock.calls;
    const override = updateCalls[0]![1].config.inputOverrides;
    expect(override.model).toEqual({ provider: 'openai', modelId: 'wrong' });
    expect(override.chatModel).not.toHaveProperty('apiKey');
  });

  it('keeps the editor-marked model input for OpenCode without a component port map', () => {
    const onUpdateNode = mock(() => {});
    const node = createSelectedNode({
      componentId: 'core.ai.opencode',
      componentSlug: 'opencode',
      config: { params: {}, inputOverrides: {} },
    });

    render(
      <ConfigPanel selectedNode={node} onClose={mock(() => {})} onUpdateNode={onUpdateNode} />,
    );
    fireEvent.click(screen.getByText('Select stored secret'));

    const updateCalls = (
      onUpdateNode as unknown as {
        mock: { calls: [string, { config: { inputOverrides: Record<string, unknown> } }][] };
      }
    ).mock.calls;
    expect(updateCalls[0]![1].config.inputOverrides).toMatchObject({
      llmConfig: { apiKeySecretId: 'secret-1' },
    });
  });

  it('disables inline controls when the semantic model port is connected', () => {
    flowEdges = [{ source: 'provider-1', target: 'node-1', targetHandle: 'chatModel' }];
    flowNodes = [{ id: 'provider-1', data: { label: 'Configured provider' } }];
    const node = createSelectedNode({ componentId: 'core.ai.agent', componentSlug: 'ai-agent' });

    render(<ConfigPanel selectedNode={node} onClose={mock(() => {})} />);

    expect(
      screen.getByText(/Using provider connected from Configured provider/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Select stored secret')).toBeNull();
  });
});
