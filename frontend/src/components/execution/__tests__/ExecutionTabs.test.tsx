import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { TrackedRun } from '@/store/executionStore';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockTrackedRuns: TrackedRun[] = [];
let mockActiveRunId: string | null = null;
const mockSwitchToRun = mock((_runId: string) => {});
const mockRemoveTrackedRun = mock((_runId: string) => {});
const mockDisconnectStream = mock(() => {});

mock.module('@/store/executionStore', () => ({
  useExecutionStore: (selector: (state: any) => any) => {
    const state = {
      trackedRuns: mockTrackedRuns,
      runId: mockActiveRunId,
      switchToRun: mockSwitchToRun,
      removeTrackedRun: mockRemoveTrackedRun,
      disconnectStream: mockDisconnectStream,
    };
    return selector(state);
  },
}));

// Tooltip components need to render children in jsdom
mock.module('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

import { ExecutionTabs } from '@/components/execution/ExecutionTabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRun = (overrides: Partial<TrackedRun> & { runId: string }): TrackedRun => ({
  workflowId: 'wf-1',
  workflowName: `Workflow ${overrides.runId}`,
  status: 'running',
  startedAt: new Date().toISOString(),
  ...overrides,
});

function resetMocks() {
  mockTrackedRuns = [];
  mockActiveRunId = null;
  mockSwitchToRun.mockClear();
  mockRemoveTrackedRun.mockClear();
  mockDisconnectStream.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionTabs', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  it('renders nothing when there are 0 tracked runs', () => {
    mockTrackedRuns = [];
    const { container } = render(<ExecutionTabs />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when there is exactly 1 tracked run', () => {
    mockTrackedRuns = [makeRun({ runId: 'run-1' })];
    mockActiveRunId = 'run-1';
    const { container } = render(<ExecutionTabs />);
    expect(container.innerHTML).toBe('');
  });

  it('renders tabs when there are 2+ tracked runs', () => {
    mockTrackedRuns = [makeRun({ runId: 'run-1' }), makeRun({ runId: 'run-2' })];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
  });

  it('renders workflow name for each tab', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'Deploy Prod' }),
      makeRun({ runId: 'run-2', workflowName: 'Scan Assets' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    // Each name appears in both the tab button and the tooltip content
    expect(screen.getAllByText('Deploy Prod').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Scan Assets').length).toBeGreaterThanOrEqual(1);
  });

  it('marks the active run tab with aria-selected=true', () => {
    mockTrackedRuns = [makeRun({ runId: 'run-1' }), makeRun({ runId: 'run-2' })];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const tabs = screen.getAllByRole('tab');
    const activeTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    expect(activeTab).toBeTruthy();
    expect(activeTab!.textContent).toContain('Workflow run-1');
  });

  it('calls switchToRun when a tab is clicked', () => {
    mockTrackedRuns = [makeRun({ runId: 'run-1' }), makeRun({ runId: 'run-2' })];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const tabs = screen.getAllByRole('tab');
    const inactiveTab = tabs.find((t) => t.getAttribute('aria-selected') === 'false');
    fireEvent.click(inactiveTab!);

    expect(mockSwitchToRun).toHaveBeenCalledWith('run-2');
  });

  it('calls removeTrackedRun when close button is clicked', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'My Flow' }),
      makeRun({ runId: 'run-2', workflowName: 'Other Flow' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const closeButton = screen.getByLabelText('Close Other Flow');
    fireEvent.click(closeButton);

    expect(mockRemoveTrackedRun).toHaveBeenCalledWith('run-2');
  });

  it('calls disconnectStream when closing the active tab', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'Active Flow' }),
      makeRun({ runId: 'run-2', workflowName: 'Other Flow' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const closeButton = screen.getByLabelText('Close Active Flow');
    fireEvent.click(closeButton);

    expect(mockDisconnectStream).toHaveBeenCalledTimes(1);
    expect(mockRemoveTrackedRun).toHaveBeenCalledWith('run-1');
  });

  it('shows "Untitled" for runs without a workflow name', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: undefined }),
      makeRun({ runId: 'run-2', workflowName: undefined }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const untitledElements = screen.getAllByText('Untitled');
    expect(untitledElements.length).toBeGreaterThanOrEqual(2);
  });

  it('has tablist role on the container', () => {
    mockTrackedRuns = [makeRun({ runId: 'run-1' }), makeRun({ runId: 'run-2' })];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('calls removeTrackedRun when Enter is pressed on close button', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'Flow A' }),
      makeRun({ runId: 'run-2', workflowName: 'Flow B' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const closeButton = screen.getByLabelText('Close Flow B');
    fireEvent.keyDown(closeButton, { key: 'Enter' });

    expect(mockRemoveTrackedRun).toHaveBeenCalledWith('run-2');
  });

  it('calls removeTrackedRun when Space is pressed on close button', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'Flow A' }),
      makeRun({ runId: 'run-2', workflowName: 'Flow B' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const closeButton = screen.getByLabelText('Close Flow B');
    fireEvent.keyDown(closeButton, { key: ' ' });

    expect(mockRemoveTrackedRun).toHaveBeenCalledWith('run-2');
  });

  it('calls disconnectStream when Enter is pressed on the active tab close button', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'Active Flow' }),
      makeRun({ runId: 'run-2', workflowName: 'Other Flow' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const closeButton = screen.getByLabelText('Close Active Flow');
    fireEvent.keyDown(closeButton, { key: 'Enter' });

    expect(mockDisconnectStream).toHaveBeenCalledTimes(1);
    expect(mockRemoveTrackedRun).toHaveBeenCalledWith('run-1');
  });

  it('does not call removeTrackedRun for non-activation keys on close button', () => {
    mockTrackedRuns = [
      makeRun({ runId: 'run-1', workflowName: 'Flow A' }),
      makeRun({ runId: 'run-2', workflowName: 'Flow B' }),
    ];
    mockActiveRunId = 'run-1';

    render(<ExecutionTabs />);

    const closeButton = screen.getByLabelText('Close Flow B');
    fireEvent.keyDown(closeButton, { key: 'Tab' });

    expect(mockRemoveTrackedRun).not.toHaveBeenCalled();
  });
});
