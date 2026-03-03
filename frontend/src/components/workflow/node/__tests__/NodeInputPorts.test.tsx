import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { InputPort } from '@/schemas/component';

// Mock reactflow — NodeInputPorts uses useReactFlow for getNodes/getEdges
// All reactflow mocks must provide a consistent superset of exports because
// bun:test mock.module is global and the last registered factory wins.
mock.module('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: any) => children,
  NodeResizer: () => <div data-testid="node-resizer" />,
  Handle: ({ id, ...rest }: { id: string; [key: string]: unknown }) => (
    <div data-testid={`handle-${id}`} {...rest} />
  ),
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

// Mock useSecrets hook
mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({ data: [], isLoading: false }),
}));

// Mock port utilities
mock.module('@/utils/portUtils', () => ({
  inputSupportsManualValue: () => false,
  isCredentialInput: (input: InputPort) => input.connectionType?.kind === 'contract',
}));

mock.module('../hooks/useNodeValidation', () => ({
  manualValueProvidedForInput: () => false,
}));

mock.module('@/api/secrets', () => ({
  getSecretLabel: (s: { name: string }) => s.name,
}));

const { NodeInputPorts } = await import('../NodeInputPorts');

function createInputPort(overrides: Partial<InputPort> = {}): InputPort {
  return {
    id: `input-${Math.random().toString(36).slice(2, 6)}`,
    label: 'Default Input',
    connectionType: { kind: 'primitive' as const, name: 'text' as const },
    required: false,
    ...overrides,
  };
}

const stubGetComponent = () => null;

describe('NodeInputPorts', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correct number of input port labels', () => {
    const inputs: InputPort[] = [
      createInputPort({ id: 'in-1', label: 'Source Text' }),
      createInputPort({ id: 'in-2', label: 'Target URL' }),
      createInputPort({ id: 'in-3', label: 'API Key' }),
    ];

    render(
      <NodeInputPorts
        id="node-1"
        componentInputs={inputs}
        isToolMode={false}
        inputOverrides={{}}
        getComponent={stubGetComponent}
      />,
    );

    expect(screen.getByText('Source Text')).toBeInTheDocument();
    expect(screen.getByText('Target URL')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
  });

  it('shows required indicator for required unconnected inputs', () => {
    const inputs: InputPort[] = [
      createInputPort({ id: 'in-1', label: 'Required Input', required: true }),
      createInputPort({ id: 'in-2', label: 'Optional Input', required: false }),
    ];

    render(
      <NodeInputPorts
        id="node-1"
        componentInputs={inputs}
        isToolMode={false}
        inputOverrides={{}}
        getComponent={stubGetComponent}
      />,
    );

    expect(screen.getByText('Required Input')).toBeInTheDocument();
    expect(screen.getByText('*required')).toBeInTheDocument();
    expect(screen.getByText('Optional Input')).toBeInTheDocument();
  });

  it('returns null when there are no visible inputs and not in tool mode', () => {
    const { container } = render(
      <NodeInputPorts
        id="node-1"
        componentInputs={[]}
        isToolMode={false}
        inputOverrides={{}}
        getComponent={stubGetComponent}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows "No configuration required" in tool mode with no credential inputs', () => {
    const inputs: InputPort[] = [
      createInputPort({
        id: 'in-1',
        label: 'Normal Input',
        connectionType: { kind: 'primitive', name: 'text' },
      }),
    ];

    render(
      <NodeInputPorts
        id="node-1"
        componentInputs={inputs}
        isToolMode={true}
        inputOverrides={{}}
        getComponent={stubGetComponent}
      />,
    );

    expect(screen.getByText('No configuration required')).toBeInTheDocument();
  });

  it('renders handles for each input port', () => {
    const inputs: InputPort[] = [
      createInputPort({ id: 'port-alpha', label: 'Alpha' }),
      createInputPort({ id: 'port-beta', label: 'Beta' }),
    ];

    render(
      <NodeInputPorts
        id="node-1"
        componentInputs={inputs}
        isToolMode={false}
        inputOverrides={{}}
        getComponent={stubGetComponent}
      />,
    );

    expect(screen.getByTestId('handle-port-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('handle-port-beta')).toBeInTheDocument();
  });
});
