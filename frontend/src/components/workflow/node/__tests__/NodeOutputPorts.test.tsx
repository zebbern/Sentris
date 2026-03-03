import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { OutputPort } from '@/schemas/component';
import type { NodeVisualState } from '@/store/executionTimelineStore';

// Mock reactflow Handle component
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

const { NodeOutputPorts } = await import('../NodeOutputPorts');

const DEFAULT_VISUAL_STATE: NodeVisualState = {
  status: 'idle',
  progress: 0,
  events: 0,
  totalEvents: 0,
};

function createOutputPort(overrides: Partial<OutputPort> = {}): OutputPort {
  return {
    id: `output-${Math.random().toString(36).slice(2, 6)}`,
    label: 'Default Output',
    connectionType: { kind: 'primitive' as const, name: 'text' as const },
    ...overrides,
  };
}

describe('NodeOutputPorts', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correct number of regular output port labels', () => {
    const outputs: OutputPort[] = [
      createOutputPort({ id: 'out-1', label: 'Result' }),
      createOutputPort({ id: 'out-2', label: 'Summary' }),
    ];

    render(
      <NodeOutputPorts
        effectiveOutputs={outputs}
        isToolMode={false}
        isTimelineActive={false}
        visualState={DEFAULT_VISUAL_STATE}
      />,
    );

    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('renders handles for each output port', () => {
    const outputs: OutputPort[] = [
      createOutputPort({ id: 'port-alpha', label: 'Alpha' }),
      createOutputPort({ id: 'port-beta', label: 'Beta' }),
    ];

    render(
      <NodeOutputPorts
        effectiveOutputs={outputs}
        isToolMode={false}
        isTimelineActive={false}
        visualState={DEFAULT_VISUAL_STATE}
      />,
    );

    expect(screen.getByTestId('handle-port-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('handle-port-beta')).toBeInTheDocument();
  });

  it('renders Tool Export in tool mode', () => {
    render(
      <NodeOutputPorts
        effectiveOutputs={[]}
        isToolMode={true}
        isTimelineActive={false}
        visualState={DEFAULT_VISUAL_STATE}
      />,
    );

    expect(screen.getByText('Tool Export')).toBeInTheDocument();
    expect(screen.getByTestId('handle-tools')).toBeInTheDocument();
  });

  it('renders branching outputs with branch labels', () => {
    const outputs: OutputPort[] = [
      createOutputPort({
        id: 'approved',
        label: 'Approved',
        isBranching: true,
        branchColor: 'green',
      }),
      createOutputPort({
        id: 'rejected',
        label: 'Rejected',
        isBranching: true,
        branchColor: 'red',
      }),
    ];

    render(
      <NodeOutputPorts
        effectiveOutputs={outputs}
        isToolMode={false}
        isTimelineActive={false}
        visualState={DEFAULT_VISUAL_STATE}
      />,
    );

    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Branches')).toBeInTheDocument();
  });

  it('separates regular outputs from branching outputs', () => {
    const outputs: OutputPort[] = [
      createOutputPort({ id: 'result', label: 'Result', isBranching: false }),
      createOutputPort({
        id: 'approved',
        label: 'Approved',
        isBranching: true,
        branchColor: 'green',
      }),
    ];

    render(
      <NodeOutputPorts
        effectiveOutputs={outputs}
        isToolMode={false}
        isTimelineActive={false}
        visualState={DEFAULT_VISUAL_STATE}
      />,
    );

    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Branches')).toBeInTheDocument();
  });
});
