import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Node } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';

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
  documentation: null,
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

let isComponentsLoading = false;

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: isComponentsLoading
      ? undefined
      : {
          byId: { 'core.scanner.nmap': mockComponent },
          slugIndex: { 'nmap-scan': 'core.scanner.nmap' },
        },
    isLoading: isComponentsLoading,
    error: null,
  }),
  useComponent: () => ({ data: null }),
  useAllComponents: () => ({ data: [] }),
  getComponentFromCache: () => null,
}));

mock.module('reactflow', () => ({
  ReactFlowProvider: ({ children }: any) => children,
  NodeResizer: () => null,
  Handle: ({ id, ...rest }: any) => <div data-testid={`handle-${id}`} {...rest} />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({
    getEdges: () => [],
    getNodes: () => [],
    setEdges: () => {},
    setNodes: () => {},
  }),
  useNodeId: () => 'test-node-id',
  useUpdateNodeInternals: () => () => {},
}));

mock.module('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ metadata: { id: 'wf-1' }, markDirty: () => {} }),
}));

mock.module('@/hooks/queries/useApiKeyQueries', () => ({
  useApiKeys: () => ({ data: [] }),
  useApiKeyUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ lastCreatedKey: null }),
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
});
