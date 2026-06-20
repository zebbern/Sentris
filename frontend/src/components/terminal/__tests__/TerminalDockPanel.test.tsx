import { describe, it, expect, mock, afterEach, afterAll, beforeEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

// Mock tooltip (Radix portals)
mock.module('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

// Mutable mock state for useWorkflowUiStore
let mockDockedTerminals: any[] = [];
let mockActiveDockedTerminalId: string | null = null;
let mockTerminalPanelHeight = 300;
let mockTerminalPanelCollapsed = false;
let mockMode = 'design';

const mockUndockTerminal = mock((_nodeId: string) => {});
const mockSetActiveDockedTerminal = mock((_nodeId: string) => {});
const mockSetTerminalPanelHeight = mock((_height: number) => {});
const mockToggleTerminalPanelCollapsed = mock(() => {});

mock.module('@/store/workflowUiStore', () => {
  const useWorkflowUiStore = ((selector?: any) => {
    const state = {
      dockedTerminals: mockDockedTerminals,
      activeDockedTerminalId: mockActiveDockedTerminalId,
      terminalPanelHeight: mockTerminalPanelHeight,
      terminalPanelCollapsed: mockTerminalPanelCollapsed,
      undockTerminal: mockUndockTerminal,
      setActiveDockedTerminal: mockSetActiveDockedTerminal,
      setTerminalPanelHeight: mockSetTerminalPanelHeight,
      toggleTerminalPanelCollapsed: mockToggleTerminalPanelCollapsed,
      mode: mockMode,
    };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowUiStore.setState = () => {};
  useWorkflowUiStore.getState = () => ({
    dockedTerminals: mockDockedTerminals,
    activeDockedTerminalId: mockActiveDockedTerminalId,
    terminalPanelHeight: mockTerminalPanelHeight,
    terminalPanelCollapsed: mockTerminalPanelCollapsed,
  });
  useWorkflowUiStore.subscribe = () => () => {};
  useWorkflowUiStore.destroy = () => {};
  return { useWorkflowUiStore };
});

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    const state = { playbackMode: 'live', isLiveFollowing: true, currentTime: 0 };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.getState = () => ({
    playbackMode: 'live',
    isLiveFollowing: true,
    currentTime: 0,
  });
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

// Mock NodeTerminalPanel since it has heavy dependencies (xterm, etc.)
mock.module('../NodeTerminalPanel', () => ({
  NodeTerminalPanel: ({ nodeId, onClose, embedded }: any) => (
    <div data-testid={`terminal-panel-${nodeId}`} data-embedded={embedded}>
      <button onClick={onClose}>Close Terminal</button>
      <span>Terminal: {nodeId}</span>
    </div>
  ),
}));

import { TerminalDockPanel } from '../TerminalDockPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTerminals(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    nodeId: `node-${i + 1}`,
    label: `Step ${i + 1}`,
    runId: `run-${i + 1}`,
    status: 'running' as const,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalDockPanel', () => {
  beforeEach(() => {
    mockDockedTerminals = [];
    mockActiveDockedTerminalId = null;
    mockTerminalPanelHeight = 300;
    mockTerminalPanelCollapsed = false;
    mockMode = 'design';
    mockUndockTerminal.mockReset();
    mockSetActiveDockedTerminal.mockReset();
    mockToggleTerminalPanelCollapsed.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() =>
    restoreMockedModules([
      '@/components/ui/tooltip',
      '@/store/executionTimelineStore',
      '@/store/workflowUiStore',
      '../NodeTerminalPanel',
    ]),
  );

  it('renders nothing when there are no docked terminals', () => {
    mockDockedTerminals = [];
    const { container } = render(<TerminalDockPanel />);

    expect(container.innerHTML).toBe('');
  });

  it('renders tab bar with terminal names', () => {
    mockDockedTerminals = createTerminals(3);
    mockActiveDockedTerminalId = 'node-1';
    render(<TerminalDockPanel />);

    // Labels appear in tabs (and possibly active panel header), so use getAllByText
    expect(screen.getAllByText('Step 1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Step 2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Step 3').length).toBeGreaterThanOrEqual(1);

    // Verify all 3 tabs are present
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);
  });

  it('highlights the active terminal tab', () => {
    mockDockedTerminals = createTerminals(2);
    mockActiveDockedTerminalId = 'node-1';
    render(<TerminalDockPanel />);

    const tabs = screen.getAllByRole('tab');
    const activeTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(activeTab).toBeTruthy();
    expect(activeTab!.textContent).toContain('Step 1');
  });

  it('clicking a tab switches active terminal', () => {
    mockDockedTerminals = createTerminals(2);
    mockActiveDockedTerminalId = 'node-1';
    render(<TerminalDockPanel />);

    const tabs = screen.getAllByRole('tab');
    const step2Tab = tabs.find((t) => t.textContent?.includes('Step 2'));
    expect(step2Tab).toBeTruthy();
    fireEvent.click(step2Tab!);

    expect(mockSetActiveDockedTerminal).toHaveBeenCalledWith('node-2');
  });

  it('collapse/expand toggle works', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    mockTerminalPanelCollapsed = false;
    render(<TerminalDockPanel />);

    const collapseButton = screen.getByLabelText('Collapse terminal panel');
    fireEvent.click(collapseButton);

    expect(mockToggleTerminalPanelCollapsed).toHaveBeenCalledTimes(1);
  });

  it('shows expand label when collapsed', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    mockTerminalPanelCollapsed = true;
    render(<TerminalDockPanel />);

    expect(screen.getByLabelText('Expand terminal panel')).toBeTruthy();
  });

  it('close button removes terminal from dock', () => {
    mockDockedTerminals = createTerminals(2);
    mockActiveDockedTerminalId = 'node-1';
    render(<TerminalDockPanel />);

    // Find close buttons (the X spans with aria-label)
    const closeButtons = screen.getAllByLabelText(/Close Step/);
    expect(closeButtons.length).toBe(2);

    fireEvent.click(closeButtons[0]);

    expect(mockUndockTerminal).toHaveBeenCalledWith('node-1');
  });

  it('renders tablist role for accessibility', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    render(<TerminalDockPanel />);

    expect(screen.getByRole('tablist', { name: 'Terminal sessions' })).toBeTruthy();
  });

  it('renders active terminal panel content when expanded', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    mockTerminalPanelCollapsed = false;
    render(<TerminalDockPanel />);

    // The mocked NodeTerminalPanel should render
    expect(screen.getByTestId('terminal-panel-node-1')).toBeTruthy();
  });

  it('hides terminal panel content when collapsed', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    mockTerminalPanelCollapsed = true;
    render(<TerminalDockPanel />);

    // Terminal panel should NOT be rendered when collapsed
    expect(screen.queryByTestId('terminal-panel-node-1')).toBeNull();
  });

  it('renders resize handle when expanded', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    mockTerminalPanelCollapsed = false;
    render(<TerminalDockPanel />);

    expect(screen.getByRole('separator', { name: 'Resize terminal panel' })).toBeTruthy();
  });

  it('hides resize handle when collapsed', () => {
    mockDockedTerminals = createTerminals(1);
    mockActiveDockedTerminalId = 'node-1';
    mockTerminalPanelCollapsed = true;
    render(<TerminalDockPanel />);

    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('truncates long terminal names', () => {
    mockDockedTerminals = [
      {
        nodeId: 'node-1',
        label: 'A Very Long Terminal Node Name That Exceeds Limits',
        runId: 'run-1',
        status: 'running' as const,
      },
    ];
    mockActiveDockedTerminalId = 'node-1';
    render(<TerminalDockPanel />);

    // The name should be truncated with ellipsis (18 chars max)
    const tab = screen.getByRole('tab');
    expect(tab.textContent).toContain('…');
  });
});
