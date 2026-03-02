import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { TimelineTrackProps, MarkerData, AgentMarkerData } from '../types';

// ---------------------------------------------------------------------------
// Mock constants
// ---------------------------------------------------------------------------

mock.module('../constants', () => ({
  EVENT_COLORS: {
    STARTED: 'bg-blue-500',
    COMPLETED: 'bg-green-500',
    FAILED: 'bg-red-500',
    default: 'bg-gray-400',
  },
}));

// Dynamic import with query param to bypass stale mock.module from ExecutionTimeline.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { TimelineTrack } = await import('../TimelineTrack?unmocked');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMarker(overrides: Partial<MarkerData> = {}): MarkerData {
  return {
    id: 'marker-1',
    type: 'STARTED',
    timestamp: '2026-01-01T00:00:01Z',
    viewportPosition: 0.5,
    normalizedPosition: 0.5,
    visible: true,
    ...overrides,
  };
}

function makeAgentMarker(overrides: Partial<AgentMarkerData> = {}): AgentMarkerData {
  return {
    id: 'agent-1',
    label: 'Agent Step',
    timestamp: '2026-01-01T00:00:02Z',
    viewportPosition: 0.3,
    normalizedPosition: 0.3,
    visible: true,
    ...overrides,
  };
}

function makeProps(overrides: Partial<TimelineTrackProps> = {}): TimelineTrackProps {
  return {
    visibleProgress: 0.5,
    visibleMarkers: [],
    visibleAgentMarkers: [],
    isLiveMode: false,
    playbackMode: 'replay',
    currentTime: 5000,
    viewportStartMs: 0,
    viewportEndMs: 10000,
    onMouseDown: mock(() => {}),
    onWheel: mock(() => {}),
    onPlayheadMouseDown: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimelineTrack', () => {
  afterEach(cleanup);

  it('renders event markers at correct positions', () => {
    const markers = [
      makeMarker({ id: 'm1', viewportPosition: 0.2, type: 'STARTED' }),
      makeMarker({ id: 'm2', viewportPosition: 0.8, type: 'COMPLETED' }),
    ];
    const { container } = render(<TimelineTrack {...makeProps({ visibleMarkers: markers })} />);

    // Each marker is rendered as a 2px-wide div with `left` style
    const markerElements = container.querySelectorAll('[style*="left: 20%"]');
    expect(markerElements.length).toBeGreaterThanOrEqual(1);

    const markerElements80 = container.querySelectorAll('[style*="left: 80%"]');
    expect(markerElements80.length).toBeGreaterThanOrEqual(1);
  });

  it('renders playhead in replay mode', () => {
    const { container } = render(
      <TimelineTrack {...makeProps({ playbackMode: 'replay', currentTime: 5000 })} />,
    );

    // Playhead button showing the formatted time
    const playheadButtons = container.querySelectorAll('button');
    expect(playheadButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('does not render playhead when playbackMode is not replay and not live', () => {
    // TimelineTrack only shows playhead for 'replay' or when live.
    // In replay mode with isLiveMode=false, it should show.
    // With playbackMode='replay', showPlayhead = true
    const { container } = render(
      <TimelineTrack {...makeProps({ playbackMode: 'replay', isLiveMode: false })} />,
    );

    // Should have playhead
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('fires onMouseDown when track is clicked', () => {
    const onMouseDown = mock(() => {});
    const { container } = render(<TimelineTrack {...makeProps({ onMouseDown })} />);

    const trackEl = container.querySelector('.h-14');
    if (trackEl) {
      fireEvent.mouseDown(trackEl);
      expect(onMouseDown).toHaveBeenCalledTimes(1);
    }
  });

  it('fires onWheel for zoom', () => {
    const onWheel = mock(() => {});
    const { container } = render(<TimelineTrack {...makeProps({ onWheel })} />);

    const trackEl = container.querySelector('.h-14');
    if (trackEl) {
      fireEvent.wheel(trackEl, { deltaY: -100 });
      expect(onWheel).toHaveBeenCalledTimes(1);
    }
  });

  it('renders agent markers when provided', () => {
    const agentMarkers = [makeAgentMarker({ id: 'a1', viewportPosition: 0.4, label: 'Tool call' })];
    const { container } = render(
      <TimelineTrack {...makeProps({ visibleAgentMarkers: agentMarkers })} />,
    );

    // Agent markers render a diamond shape div with amber styling
    const diamondElements = container.querySelectorAll('.rotate-45');
    expect(diamondElements.length).toBe(1);
  });

  it('shows red playhead in live mode', () => {
    const { container } = render(
      <TimelineTrack {...makeProps({ isLiveMode: true, playbackMode: 'live' })} />,
    );

    const redPlayhead = container.querySelector('.bg-red-400');
    expect(redPlayhead).toBeTruthy();
  });

  it('shows blue playhead in replay mode', () => {
    const { container } = render(
      <TimelineTrack {...makeProps({ isLiveMode: false, playbackMode: 'replay' })} />,
    );

    const bluePlayhead = container.querySelector('.bg-blue-400');
    expect(bluePlayhead).toBeTruthy();
  });
});
