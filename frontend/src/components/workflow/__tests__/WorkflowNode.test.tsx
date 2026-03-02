import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FrontendNodeData } from '@/schemas/node';

// Inline provider avoids reactflow ESM resolution issues when running in test suite
const ReactFlowProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

mock.module('reactflow', () => ({
  ReactFlowProvider: ({ children }: any) => children,
  NodeResizer: () => <div data-testid="node-resizer" />,
  Handle: ({ id, ...rest }: any) => <div data-testid={`handle-${id}`} {...rest} />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({
    getNodes: () => [],
    getEdges: () => [],
    setEdges: () => {},
    setNodes: () => {},
  }),
  useNodeId: () => 'test-node-id',
  useUpdateNodeInternals: () => () => {},
}));

const scannerComponent = {
  id: 'core.scanner.nmap',
  slug: 'nmap-scan',
  name: 'Nmap Scan',
  version: '1.0.0',
  type: 'process' as const,
  category: 'scanner' as const,
  categoryConfig: {
    label: 'Scanner',
    color: 'text-green-600',
    description: 'Security scanning',
    emoji: '🔍',
    icon: 'Search',
  },
  description: 'Runs an Nmap port scan',
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

const entryPointComponent = {
  id: 'core.workflow.entrypoint',
  slug: 'entrypoint',
  name: 'Entry Point',
  version: '1.0.0',
  type: 'trigger' as const,
  category: 'input' as const,
  categoryConfig: {
    label: 'Input',
    color: 'text-blue-600',
    description: 'Workflow inputs',
    emoji: '📥',
    icon: 'ArrowDownCircle',
  },
  description: 'Workflow entry point',
  documentation: null,
  documentationUrl: null,
  icon: 'Play',
  logo: null,
  author: { name: 'SentrisAI', type: 'sentris' as const },
  isLatest: true,
  deprecated: false,
  example: null,
  runner: { kind: 'inline' as const },
  inputs: [],
  outputs: [
    {
      id: 'output',
      label: 'Output',
      connectionType: { kind: 'primitive', name: 'any' },
    },
  ],
  parameters: [],
  examples: [],
};

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: {
      byId: {
        'core.scanner.nmap': scannerComponent,
        'core.workflow.entrypoint': entryPointComponent,
      },
      slugIndex: {
        'nmap-scan': 'core.scanner.nmap',
        entrypoint: 'core.workflow.entrypoint',
      },
    },
    isLoading: false,
    error: null,
  }),
  useComponent: () => ({ data: null }),
  useAllComponents: () => ({ data: [] }),
  getComponentFromCache: () => null,
}));

mock.module('@/store/executionTimelineStore', () => ({
  useExecutionTimelineStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      nodeStates: {},
      selectedRunId: null,
      selectNode: () => {},
      isPlaying: false,
      playbackMode: 'static',
    }),
}));

mock.module('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      metadata: { id: 'wf-1' },
      markDirty: () => {},
    }),
}));

mock.module('@/store/workflowUiStore', () => ({
  useWorkflowUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      mode: 'design',
      openHumanInputDialog: () => {},
      dockedTerminals: [],
    }),
}));

mock.module('@/store/themeStore', () => ({
  useThemeStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'light' }),
}));

mock.module('@/hooks/queries/useApiKeyQueries', () => ({
  useApiKeyUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ lastCreatedKey: null }),
}));

mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

mock.module('@/services/api', () => ({
  API_BASE_URL: 'http://localhost:4400/api',
  API_V1_URL: 'http://localhost:4400/api/v1',
  getApiAuthHeaders: () => ({}),
  api: {},
}));

const { WorkflowNode } = await import('../WorkflowNode');

describe('WorkflowNode', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  afterEach(() => {
    cleanup();
  });

  function renderNode(data: FrontendNodeData, selected = false) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ReactFlowProvider>
            <WorkflowNode
              id="node-1"
              data={data}
              selected={selected}
              type="workflow"
              xPos={0}
              yPos={0}
              zIndex={0}
              isConnectable={true}
              dragging={false}
            />
          </ReactFlowProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders with component name in the header', () => {
    const data: FrontendNodeData = {
      label: 'Nmap Scan',
      config: { params: {}, inputOverrides: {} },
      componentId: 'core.scanner.nmap',
      componentSlug: 'nmap-scan',
      componentVersion: '1.0.0',
      inputs: {},
      status: 'idle',
    };

    renderNode(data);
    expect(screen.getByText('Nmap Scan')).toBeInTheDocument();
  });

  it('shows custom label and original component name', () => {
    const data: FrontendNodeData = {
      label: 'My Custom Scanner',
      config: { params: {}, inputOverrides: {} },
      componentId: 'core.scanner.nmap',
      componentSlug: 'nmap-scan',
      componentVersion: '1.0.0',
      inputs: {},
      status: 'idle',
    };

    renderNode(data);
    expect(screen.getByText('My Custom Scanner')).toBeInTheDocument();
    // Original component name shows as subtitle
    expect(screen.getByText('Nmap Scan')).toBeInTheDocument();
  });

  it('renders input port labels from component metadata', () => {
    const data: FrontendNodeData = {
      label: 'Nmap Scan',
      config: { params: {}, inputOverrides: {} },
      componentId: 'core.scanner.nmap',
      componentSlug: 'nmap-scan',
      componentVersion: '1.0.0',
      inputs: {},
      status: 'idle',
    };

    renderNode(data);
    expect(screen.getByText('Target')).toBeInTheDocument();
  });

  it('renders output port labels from component metadata', () => {
    const data: FrontendNodeData = {
      label: 'Nmap Scan',
      config: { params: {}, inputOverrides: {} },
      componentId: 'core.scanner.nmap',
      componentSlug: 'nmap-scan',
      componentVersion: '1.0.0',
      inputs: {},
      status: 'idle',
    };

    renderNode(data);
    expect(screen.getByText('Scan Result')).toBeInTheDocument();
  });

  it('renders entry-point node with entry-point body', () => {
    const data: FrontendNodeData = {
      label: 'Entry Point',
      config: { params: {}, inputOverrides: {} },
      componentId: 'core.workflow.entrypoint',
      componentSlug: 'entrypoint',
      componentVersion: '1.0.0',
      inputs: {},
      status: 'idle',
    };

    renderNode(data);
    expect(screen.getByText('Entry Point')).toBeInTheDocument();
  });

  it('shows loading state when component metadata is not yet loaded', () => {
    // Use an unknown component ID that won't be in the index
    const data: FrontendNodeData = {
      label: 'Unknown',
      config: { params: {}, inputOverrides: {} },
      componentId: 'nonexistent.component',
      componentSlug: 'nonexistent',
      componentVersion: '1.0.0',
      inputs: {},
      status: 'idle',
    };

    renderNode(data);
    // When component is not found and not loading, ComponentNotFoundCard is shown
    expect(screen.getByText(/metadata could not be loaded/i)).toBeInTheDocument();
  });
});
