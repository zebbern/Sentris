import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { realModuleExports } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Store & hook mocks
// ---------------------------------------------------------------------------

let mockSelectedRunId: string | null = 'run-1';
let mockPlaybackMode = 'replay';
let mockIsPlaying = false;
let mockInspectorTab = 'events';

const mockSetInspectorTab = mock((tab: string) => {
  mockInspectorTab = tab;
});

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    const state = {
      selectedRunId: mockSelectedRunId,
      playbackMode: mockPlaybackMode,
      isPlaying: mockIsPlaying,
    };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionTimelineStore.getState = () => ({
    selectedRunId: mockSelectedRunId,
    playbackMode: mockPlaybackMode,
    isPlaying: mockIsPlaying,
  });
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

mock.module('@/store/workflowUiStore', () => {
  const useWorkflowUiStore = ((selector?: any) => {
    const state = {
      inspectorTab: mockInspectorTab,
      setInspectorTab: mockSetInspectorTab,
    };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowUiStore.getState = () => ({
    inspectorTab: mockInspectorTab,
    setInspectorTab: mockSetInspectorTab,
  });
  useWorkflowUiStore.subscribe = () => () => {};
  return { useWorkflowUiStore };
});

const mockWorkflowId = 'wf-1';
const mockCurrentVersion = 2;

mock.module('@/store/workflowStore', () => {
  const useWorkflowStore = ((selector?: any) => {
    const state = {
      metadata: { id: mockWorkflowId, currentVersion: mockCurrentVersion },
    };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowStore.getState = () => ({
    metadata: { id: mockWorkflowId, currentVersion: mockCurrentVersion },
  });
  useWorkflowStore.subscribe = () => () => {};
  return { useWorkflowStore };
});

let mockExecStatus = 'idle';
let mockExecRunId: string | null = null;
const mockStopExecution = mock(() => {});
const mockSetLogMode = mock(() => {});

mock.module('@/store/executionStore', () => {
  const useExecutionStore = ((selector?: any) => {
    const state = {
      runId: mockExecRunId,
      status: mockExecStatus,
      getDisplayLogs: () => [],
      setLogMode: mockSetLogMode,
    };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionStore.getState = () => ({
    runId: mockExecRunId,
    status: mockExecStatus,
    getDisplayLogs: () => [],
    setLogMode: mockSetLogMode,
  });
  useExecutionStore.subscribe = () => () => {};
  return { useExecutionStore };
});

// Mock runs query
const mockRuns = [
  {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'Test',
    status: 'COMPLETED',
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T00:01:00Z',
    duration: 60000,
    nodeCount: 3,
    eventCount: 10,
    createdAt: '2026-01-01T00:00:00Z',
    isLive: false,
    workflowVersionId: 'v1',
    workflowVersion: 2,
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
  },
];

mock.module('@/hooks/queries/useRunQueries', () => ({
  useWorkflowRuns: () => ({
    data: { runs: mockRuns, hasMore: false },
    isLoading: false,
  }),
}));

mock.module('@/hooks/useWorkflowExecution', () => ({
  useWorkflowExecution: () => ({
    status: mockExecStatus,
    runStatus: null,
    stopExecution: mockStopExecution,
    runId: mockExecRunId,
  }),
}));

mock.module('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy: mock(async () => {}) }),
}));

mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

const mockNavigate = mock(() => {});

mock.module('react-router-dom', () => ({
  ...realModuleExports('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => ({ runId: undefined }),
}));

mock.module('@/utils/triggerDisplay', () => ({
  getTriggerDisplay: () => ({ icon: '▶', label: 'Manual run', variant: 'secondary' }),
}));

mock.module('@/features/workflow-builder/utils/executionRuns', () => ({
  isRunLive: (run?: any) => run?.isLive ?? false,
}));

mock.module('@/lib/logger', () => ({
  logger: { error: mock(() => {}) },
}));

// Mock sub-components to isolate ExecutionInspector
mock.module('@/components/timeline/RunSelector', () => ({
  RunSelector: () => <div data-testid="run-selector" />,
}));

mock.module('@/components/timeline/ExecutionTimeline', () => ({
  ExecutionTimeline: () => <div data-testid="execution-timeline" />,
}));

mock.module('@/components/timeline/EventInspector', () => ({
  EventInspector: () => <div data-testid="event-inspector" />,
}));

mock.module('@/components/artifacts/RunArtifactsPanel', () => ({
  RunArtifactsPanel: () => <div data-testid="artifacts-panel" />,
}));

mock.module('@/components/timeline/AgentTracePanel', () => ({
  AgentTracePanel: () => <div data-testid="agent-trace-panel" />,
}));

mock.module('@/components/timeline/NodeIOInspector', () => ({
  NodeIOInspector: () => <div data-testid="node-io-inspector" />,
}));

mock.module('@/components/timeline/NetworkPanel', () => ({
  NetworkPanel: () => <div data-testid="network-panel" />,
}));

mock.module('@/components/execution/ExecutionTabs', () => ({
  ExecutionTabs: () => <div data-testid="execution-tabs" />,
}));

mock.module('@/components/timeline/RunInfoDisplay', () => ({
  RunInfoDisplay: ({ run }: any) => <div data-testid="run-info-display">{run.id}</div>,
}));

mock.module('@/components/ui/MessageModal', () => ({
  MessageModal: () => null,
}));

import { ExecutionInspector } from '../ExecutionInspector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockSelectedRunId = 'run-1';
  mockPlaybackMode = 'replay';
  mockIsPlaying = false;
  mockInspectorTab = 'events';
  mockExecStatus = 'idle';
  mockExecRunId = null;
  mockSetInspectorTab.mockClear();
  mockStopExecution.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionInspector', () => {
  afterEach(() => {
    cleanup();
    resetMocks();
  });

  it('renders RunSelector and ExecutionTimeline', () => {
    render(<ExecutionInspector />);

    expect(screen.getByTestId('run-selector')).toBeTruthy();
    expect(screen.getByTestId('execution-timeline')).toBeTruthy();
  });

  it('renders Events tab content by default', () => {
    mockInspectorTab = 'events';
    render(<ExecutionInspector />);

    expect(screen.getByTestId('event-inspector')).toBeTruthy();
  });

  it('renders tab navigation buttons', () => {
    render(<ExecutionInspector />);

    expect(screen.getByText('Events')).toBeTruthy();
    expect(screen.getByText('Logs')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('Artifacts')).toBeTruthy();
    expect(screen.getByText('I/O')).toBeTruthy();
    expect(screen.getByText('Network')).toBeTruthy();
  });

  it('calls setInspectorTab when switching tabs', () => {
    render(<ExecutionInspector />);

    fireEvent.click(screen.getByText('Agent'));
    expect(mockSetInspectorTab).toHaveBeenCalledWith('agent');
  });

  it('renders Agent panel when agent tab is active', () => {
    mockInspectorTab = 'agent';
    render(<ExecutionInspector />);

    expect(screen.getByTestId('agent-trace-panel')).toBeTruthy();
  });

  it('renders Artifacts panel when artifacts tab is active', () => {
    mockInspectorTab = 'artifacts';
    render(<ExecutionInspector />);

    expect(screen.getByTestId('artifacts-panel')).toBeTruthy();
  });

  it('renders I/O panel when io tab is active', () => {
    mockInspectorTab = 'io';
    render(<ExecutionInspector />);

    expect(screen.getByTestId('node-io-inspector')).toBeTruthy();
  });

  it('renders Network panel when network tab is active', () => {
    mockInspectorTab = 'network';
    render(<ExecutionInspector />);

    expect(screen.getByTestId('network-panel')).toBeTruthy();
  });

  it('shows Stop button when run is active', () => {
    mockExecRunId = 'run-1';
    mockExecStatus = 'running';
    render(<ExecutionInspector />);

    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('shows Rerun button when onRerunRun is provided', () => {
    const onRerun = mock(() => {});
    render(<ExecutionInspector onRerunRun={onRerun} />);

    expect(screen.getByText('Rerun')).toBeTruthy();
  });

  it('shows "Select a run to explore" when no run is selected', () => {
    mockSelectedRunId = null;
    render(<ExecutionInspector />);

    expect(screen.getByText('Select a run to explore')).toBeTruthy();
  });
});
