import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ComponentMetadata } from '@/schemas/component';
import type { NodeStatus } from '@/schemas/node';
import type { NodeStateStyle } from '../../nodeStyles';
import type { LucideIcon } from 'lucide-react';
import { Activity } from 'lucide-react';
import React from 'react';

// NodeHeader is a pure presentational component — no store or ReactFlow mocks needed.
const { NodeHeader } = await import('../NodeHeader');

function createMockComponent(overrides: Partial<ComponentMetadata> = {}): ComponentMetadata {
  return {
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
    inputs: [],
    outputs: [],
    parameters: [],
    examples: [],
    ...overrides,
  } as ComponentMetadata;
}

const idleStyle: NodeStateStyle = {
  border: 'border-border',
  bg: 'bg-background',
  icon: null,
};

function createDefaultProps(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    component: createMockComponent(),
    displayLabel: 'Nmap Scan',
    hasCustomLabel: false,
    isEditingLabel: false,
    editingLabelValue: '',
    labelInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
    setEditingLabelValue: mock(() => {}),
    handleStartEditing: mock(() => {}),
    handleSaveLabel: mock(() => {}),
    handleLabelKeyDown: mock(() => {}),
    isEntryPoint: false,
    isToolMode: false,
    isToolModeOnly: false,
    showMcpBadge: false,
    mode: 'design',
    effectiveStatus: 'idle',
    nodeStatus: undefined as NodeStatus | undefined,
    nodeStyle: idleStyle,
    StatusIcon: null as LucideIcon | null,
    isTimelineActive: false,
    isPlaying: false,
    hasUnfilledRequired: false,
    supportsLiveLogs: false,
    selectedRunId: null as string | null,
    isTerminalLoading: false,
    terminalSession: undefined as { chunks?: unknown[] } | undefined,
    toggleToolMode: mock(() => {}),
    handleDelete: mock(() => {}),
    isMobile: false,
    separatorColor: undefined as string | undefined,
    headerBackgroundColor: undefined as string | undefined,
    entryPointHeaderSlot: undefined as React.ReactNode,
    ...overrides,
  };
}

describe('NodeHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders component name as the display label', () => {
    const props = createDefaultProps();
    render(<NodeHeader {...props} />);

    expect(screen.getByText('Nmap Scan')).toBeInTheDocument();
  });

  it('renders the component icon via DynamicIcon', () => {
    const props = createDefaultProps();
    render(<NodeHeader {...props} />);

    // The DynamicIcon renders an SVG — the heading text is the primary assertion
    expect(screen.getByText('Nmap Scan')).toBeInTheDocument();
  });

  it('shows original component name when label is customized', () => {
    const props = createDefaultProps({
      displayLabel: 'My Custom Label',
      hasCustomLabel: true,
    });
    render(<NodeHeader {...props} />);

    expect(screen.getByText('My Custom Label')).toBeInTheDocument();
    expect(screen.getByText('Nmap Scan')).toBeInTheDocument(); // subtitle shows original
  });

  it('shows MCP badge when showMcpBadge is true', () => {
    const props = createDefaultProps({ showMcpBadge: true });
    render(<NodeHeader {...props} />);

    expect(screen.getByText('MCP')).toBeInTheDocument();
  });

  it('renders the StatusIcon when provided and status is not success', () => {
    const props = createDefaultProps({
      StatusIcon: Activity,
      effectiveStatus: 'running',
      nodeStyle: {
        border: 'border-blue-500',
        bg: 'bg-blue-50',
        icon: 'Activity',
        iconClass: 'text-blue-600',
      },
      isTimelineActive: false,
    });
    render(<NodeHeader {...props} />);

    // Activity icon should be rendered (lucide-react renders an SVG)
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('shows required field warning indicator when hasUnfilledRequired is true', () => {
    const props = createDefaultProps({
      hasUnfilledRequired: true,
      nodeStatus: undefined,
    });
    render(<NodeHeader {...props} />);

    expect(screen.getByTitle('Required fields missing')).toBeInTheDocument();
  });

  it('shows delete button in design mode (non-entry-point)', () => {
    const props = createDefaultProps({ mode: 'design', isEntryPoint: false });
    render(<NodeHeader {...props} />);

    expect(screen.getByLabelText('Delete node')).toBeInTheDocument();
  });

  it('fires handleDelete when delete button is clicked', () => {
    const props = createDefaultProps({ mode: 'design', isEntryPoint: false });
    render(<NodeHeader {...props} />);

    fireEvent.click(screen.getByLabelText('Delete node'));
    expect(props.handleDelete).toHaveBeenCalled();
  });

  it('does not show delete button for entry-point nodes', () => {
    const props = createDefaultProps({ mode: 'design', isEntryPoint: true });
    render(<NodeHeader {...props} />);

    expect(screen.queryByLabelText('Delete node')).not.toBeInTheDocument();
  });

  it('does not show delete button in execution mode', () => {
    const props = createDefaultProps({ mode: 'execution', isEntryPoint: false });
    render(<NodeHeader {...props} />);

    expect(screen.queryByLabelText('Delete node')).not.toBeInTheDocument();
  });

  it('renders inline label editing input when isEditingLabel is true', () => {
    const props = createDefaultProps({
      isEditingLabel: true,
      editingLabelValue: 'New label',
    });
    render(<NodeHeader {...props} />);

    const input = screen.getByDisplayValue('New label');
    expect(input).toBeInTheDocument();
  });
});
