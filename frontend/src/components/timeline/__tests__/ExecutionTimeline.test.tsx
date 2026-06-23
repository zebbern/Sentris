import { describe, it, expect, afterEach, afterAll, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

const defaultTimelineState: Record<string, any> = {
  selectedRunId: 'run-1',
  events: [],
  totalDuration: 10_000,
  eventDuration: 10_000,
  currentTime: 5000,
  playbackMode: 'replay',
  isPlaying: false,
  playbackSpeed: 1,
  isSeeking: false,
  nodeStates: {},
  showTimeline: true,
  timelineZoom: 1,
  isLiveFollowing: true,
  timelineStartTime: null,
  agentMarkersRunId: null,
  agentMarkers: {},
  play: mock(() => {}),
  pause: mock(() => {}),
  seek: mock(() => {}),
  setPlaybackSpeed: mock(() => {}),
  stepForward: mock(() => {}),
  stepBackward: mock(() => {}),
  setTimelineZoom: mock(() => {}),
  goLive: mock(() => {}),
  tickLiveClock: mock(() => {}),
};

let timelineState = { ...defaultTimelineState };

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    return selector ? selector(timelineState) : timelineState;
  }) as any;
  useExecutionTimelineStore.getState = () => timelineState;
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

const defaultWorkflowUiState: Record<string, any> = {
  showHeatMap: false,
  toggleHeatMap: mock(() => {}),
  smartRouting: false,
  toggleSmartRouting: mock(() => {}),
};

mock.module('@/store/workflowUiStore', () => {
  const useWorkflowUiStore = ((selector?: any) => {
    return selector ? selector(defaultWorkflowUiState) : defaultWorkflowUiState;
  }) as any;
  useWorkflowUiStore.getState = () => defaultWorkflowUiState;
  useWorkflowUiStore.setState = () => {};
  useWorkflowUiStore.subscribe = () => () => {};
  return { useWorkflowUiStore };
});

// Mock sub-components to isolate ExecutionTimeline
mock.module('@/components/timeline/execution-timeline/PlaybackControls', () => ({
  PlaybackControls: (props: any) => (
    <div data-testid="playback-controls" data-playing={props.isPlaying} />
  ),
}));

mock.module('@/components/timeline/execution-timeline/TimelineTrack', () => ({
  TimelineTrack: (_props: any) => <div data-testid="timeline-track" />,
}));

mock.module('@/components/timeline/execution-timeline/TimelineOverview', () => ({
  TimelineOverview: () => <div data-testid="timeline-overview" />,
}));

mock.module('@/components/timeline/execution-timeline/TimelineStatusBar', () => ({
  TimelineStatusBar: () => <div data-testid="timeline-status-bar" />,
}));

mock.module('@/components/timeline/execution-timeline/utils', () => ({
  clampValue: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
}));

// Dynamic import with query param to bypass stale mock.module from ExecutionInspector.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { ExecutionTimeline } = await import('../ExecutionTimeline?unmocked');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionTimeline', () => {
  afterAll(() => {
    restoreMockedModules([
      '@/store/executionTimelineStore',
      '@/store/workflowUiStore',
      '@/components/timeline/execution-timeline/PlaybackControls',
      '@/components/timeline/execution-timeline/TimelineTrack',
      '@/components/timeline/execution-timeline/TimelineOverview',
      '@/components/timeline/execution-timeline/TimelineStatusBar',
      '@/components/timeline/execution-timeline/utils',
    ]);
  });

  afterEach(() => {
    cleanup();
    timelineState = { ...defaultTimelineState };
  });

  it('renders PlaybackControls and TimelineTrack when visible', () => {
    render(<ExecutionTimeline />);

    expect(screen.getByTestId('playback-controls')).toBeTruthy();
    expect(screen.getByTestId('timeline-track')).toBeTruthy();
    expect(screen.queryByTestId('timeline-overview')).toBeNull();
    expect(screen.getByTestId('timeline-status-bar')).toBeTruthy();
  });

  it('renders TimelineOverview when zoomed in', () => {
    timelineState = { ...defaultTimelineState, timelineZoom: 2 };
    render(<ExecutionTimeline />);

    expect(screen.getByTestId('timeline-overview')).toBeTruthy();
  });

  it('returns null when showTimeline is false', () => {
    timelineState = { ...defaultTimelineState, showTimeline: false };
    const { container } = render(<ExecutionTimeline />);

    expect(container.innerHTML).toBe('');
  });

  it('returns null when no run is selected', () => {
    timelineState = { ...defaultTimelineState, selectedRunId: null };
    const { container } = render(<ExecutionTimeline />);

    expect(container.innerHTML).toBe('');
  });

  it('passes isPlaying to PlaybackControls', () => {
    timelineState = { ...defaultTimelineState, isPlaying: true };
    render(<ExecutionTimeline />);

    const controls = screen.getByTestId('playback-controls');
    expect(controls.getAttribute('data-playing')).toBe('true');
  });
});
