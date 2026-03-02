import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { createQueryKeysMock } from '@/test/mocks/queryKeysMock';
import { realModuleExports } from '@/test/restore-mocks';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockSelectedRunId: string | null = null;
let mockPlaybackMode = 'replay';
const mockSelectRun = mock(() => {});

const mockTimelineState: Record<string, any> = {
  selectedRunId: null as string | null,
  playbackMode: 'replay',
  selectRun: mockSelectRun,
};

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    const state = {
      ...mockTimelineState,
      selectedRunId: mockSelectedRunId,
      playbackMode: mockPlaybackMode,
    };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionTimelineStore.getState = () => ({
    ...mockTimelineState,
    selectedRunId: mockSelectedRunId,
    playbackMode: mockPlaybackMode,
  });
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

let mockExecutionRunId: string | null = null;
const mockMonitorRun = mock(() => {});

mock.module('@/store/executionStore', () => {
  const useExecutionStore = ((selector?: any) => {
    const state = { runId: mockExecutionRunId, monitorRun: mockMonitorRun };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionStore.getState = () => ({ runId: mockExecutionRunId, monitorRun: mockMonitorRun });
  useExecutionStore.setState = () => {};
  useExecutionStore.subscribe = () => () => {};
  return { useExecutionStore };
});

mock.module('@/store/workflowStore', () => {
  const useWorkflowStore = ((selector?: any) => {
    const state = { metadata: { id: 'wf-1', currentVersion: 2 } };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowStore.getState = () => ({ metadata: { id: 'wf-1', currentVersion: 2 } });
  useWorkflowStore.subscribe = () => () => {};
  return { useWorkflowStore };
});

mock.module('@/store/workflowUiStore', () => {
  const useWorkflowUiStore = ((selector?: any) => {
    const state = { mode: 'execution' };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowUiStore.getState = () => ({ mode: 'execution' });
  useWorkflowUiStore.subscribe = () => () => {};
  return { useWorkflowUiStore };
});

let mockRunsData: { runs: ExecutionRun[]; hasMore: boolean } | undefined = undefined;
let mockIsLoadingRuns = false;

mock.module('@/hooks/queries/useRunQueries', () => ({
  useWorkflowRuns: () => ({ data: mockRunsData, isLoading: mockIsLoadingRuns }),
  fetchMoreRuns: mock(async () => {}),
}));

mock.module('@tanstack/react-query', () => ({
  ...realModuleExports('@tanstack/react-query'),
  useQueryClient: () => ({
    invalidateQueries: mock(() => {}),
  }),
}));

mock.module('@/lib/queryKeys', () =>
  createQueryKeysMock({
    runs: {
      byWorkflow: (id: string) => ['runs', 'workflow', id],
      global: () => ['runs', 'global'],
    },
  }),
);

const mockNavigate = mock(() => {});

mock.module('react-router-dom', () => ({
  ...realModuleExports('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/workflows/wf-1' }),
  useParams: () => ({ id: 'wf-1' }),
}));

mock.module('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy: mock(async () => {}) }),
}));

mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

mock.module('@/utils/timeFormat', () => ({
  formatDuration: (ms: number) => `${ms}ms`,
  formatStartTime: (ts: string) => `started-${ts}`,
}));

mock.module('@/features/workflow-builder/utils/executionRuns', () => ({
  isRunLive: (run?: any) => run?.isLive ?? false,
}));

mock.module('@/components/timeline/RunInfoDisplay', () => ({
  RunInfoDisplay: ({ run }: any) => <div data-testid={`run-info-${run.id}`} />,
}));

// Mock Radix DropdownMenu to render inline (no portal) for testing
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, open, _onOpenChange }: any) => {
    return <div data-open={open}>{children}</div>;
  },
  DropdownMenuTrigger: ({ children, _asChild }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({ children, onSelect, className }: any) => (
    <div role="menuitem" className={className} onClick={onSelect}>
      {children}
    </div>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

// Dynamic import with query param to bypass stale mock.module from ExecutionInspector.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { RunSelector } = await import('../RunSelector?unmocked');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    status: 'COMPLETED' as any,
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T00:01:00Z',
    duration: 60_000,
    nodeCount: 3,
    eventCount: 12,
    createdAt: '2026-01-01T00:00:00Z',
    isLive: false,
    workflowVersionId: 'v1',
    workflowVersion: 2,
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    ...overrides,
  };
}

function resetMocks() {
  mockSelectedRunId = null;
  mockPlaybackMode = 'replay';
  mockExecutionRunId = null;
  mockRunsData = undefined;
  mockIsLoadingRuns = false;
  mockSelectRun.mockClear();
  mockMonitorRun.mockClear();
  mockNavigate.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunSelector', () => {
  afterEach(() => {
    cleanup();
    resetMocks();
  });

  it('shows "Select a run..." when nothing is selected', () => {
    mockRunsData = { runs: [], hasMore: false };
    render(<RunSelector />);

    expect(screen.getByText('Select a run...')).toBeTruthy();
  });

  it('shows run ID when a run is selected', () => {
    const run = makeRun({ id: 'abc-def-ghi-jkl' });
    mockRunsData = { runs: [run], hasMore: false };
    mockSelectedRunId = 'abc-def-ghi-jkl';
    render(<RunSelector />);

    // Truncated ID appears in trigger and in dropdown list
    const matches = screen.getAllByText('abc-def-ghi');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // The trigger has a span with the truncated ID
    const triggerSpan = matches.find((el) => el.tagName === 'SPAN');
    expect(triggerSpan).toBeTruthy();
  });

  it('renders trigger filter tabs', () => {
    mockRunsData = { runs: [makeRun()], hasMore: false };
    render(<RunSelector />);

    // Content renders inline due to mocked dropdown
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
  });

  it('shows "Load more runs" button when hasMore is true', () => {
    mockRunsData = {
      runs: [makeRun({ id: 'run-1' }), makeRun({ id: 'run-2' })],
      hasMore: true,
    };
    render(<RunSelector />);

    expect(screen.getByText('Load more runs')).toBeTruthy();
  });

  it('shows "No more runs to load" when hasMore is false', () => {
    mockRunsData = {
      runs: [makeRun({ id: 'run-1' })],
      hasMore: false,
    };
    render(<RunSelector />);

    expect(screen.getByText('No more runs to load')).toBeTruthy();
  });

  it('shows "No previous runs found" when no historical runs exist', () => {
    mockRunsData = { runs: [], hasMore: false };
    render(<RunSelector />);

    expect(screen.getByText('No previous runs found')).toBeTruthy();
  });

  it('renders Historical Runs header', () => {
    mockRunsData = { runs: [makeRun()], hasMore: false };
    render(<RunSelector />);

    expect(screen.getByText('Historical Runs')).toBeTruthy();
  });
});
