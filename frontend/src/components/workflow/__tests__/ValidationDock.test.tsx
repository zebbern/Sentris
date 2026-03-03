import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';

// Control validation warnings per test
let validationWarningsMap: Record<string, string[]> = {};

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
      },
      slugIndex: {},
    },
    isLoading: false,
  }),
}));

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({ data: [], isLoading: false }),
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
  });

  it('shows "All validated" when there are no issues', () => {
    const nodes = [createNode('n1', 'core.output.report', 'Report')];

    render(<ValidationDock nodes={nodes} edges={[]} mode="design" onNodeClick={mock(() => {})} />);

    expect(screen.getByText('All validated')).toBeInTheDocument();
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
});
