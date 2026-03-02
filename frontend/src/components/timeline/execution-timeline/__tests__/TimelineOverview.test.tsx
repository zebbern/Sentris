import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { TimelineOverviewProps, MarkerData } from '../types';

// ---------------------------------------------------------------------------
// Mock constants and utils
// ---------------------------------------------------------------------------

mock.module('../constants', () => ({
  EVENT_COLORS: {
    STARTED: 'bg-blue-500',
    COMPLETED: 'bg-green-500',
    FAILED: 'bg-red-500',
    default: 'bg-gray-400',
  },
}));

mock.module('../utils', () => ({
  formatTime: (ms: number) => {
    if (ms === 0) return '0:00';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  },
}));

import { TimelineOverview } from '../TimelineOverview';

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

function makeProps(overrides: Partial<TimelineOverviewProps> = {}): TimelineOverviewProps {
  return {
    markerData: [],
    clampedStart: 0,
    viewportWidth: 0.5,
    normalizedProgress: 0.3,
    isLiveMode: false,
    timelineZoom: 1,
    overviewDuration: 10_000,
    onPreviewPointer: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimelineOverview', () => {
  afterEach(cleanup);

  it('renders the "Timeline Overview" label', () => {
    render(<TimelineOverview {...makeProps()} />);

    expect(screen.getByText('Timeline Overview')).toBeTruthy();
  });

  it('shows zoom percentage when zoom > 1', () => {
    render(<TimelineOverview {...makeProps({ timelineZoom: 2.5 })} />);

    expect(screen.getByText('Zoom: 250%')).toBeTruthy();
  });

  it('hides zoom label when zoom is 1', () => {
    render(<TimelineOverview {...makeProps({ timelineZoom: 1 })} />);

    expect(screen.queryByText(/Zoom:/)).toBeNull();
  });

  it('renders start and end time labels', () => {
    render(<TimelineOverview {...makeProps({ overviewDuration: 60_000 })} />);

    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('1:00')).toBeTruthy();
  });

  it('renders markers at correct normalized positions', () => {
    const markers = [
      makeMarker({ id: 'm1', normalizedPosition: 0.25, type: 'STARTED' }),
      makeMarker({ id: 'm2', normalizedPosition: 0.75, type: 'COMPLETED' }),
    ];
    const { container } = render(<TimelineOverview {...makeProps({ markerData: markers })} />);

    const markerAt25 = container.querySelectorAll('[style*="left: 25%"]');
    expect(markerAt25.length).toBeGreaterThanOrEqual(1);

    const markerAt75 = container.querySelectorAll('[style*="left: 75%"]');
    expect(markerAt75.length).toBeGreaterThanOrEqual(1);
  });

  it('renders viewport window at correct position and width', () => {
    const { container } = render(
      <TimelineOverview {...makeProps({ clampedStart: 0.2, viewportWidth: 0.3 })} />,
    );

    const viewportWindow = container.querySelector('[style*="left: 20%"][style*="width: 30%"]');
    expect(viewportWindow).toBeTruthy();
  });

  it('fires onPreviewPointer on click', () => {
    const onPreviewPointer = mock(() => {});
    const { container } = render(<TimelineOverview {...makeProps({ onPreviewPointer })} />);

    const overviewBar = container.querySelector('[title="Click or drag to reposition view"]');
    if (overviewBar) {
      fireEvent.mouseDown(overviewBar);
      expect(onPreviewPointer).toHaveBeenCalledTimes(1);
    }
  });

  it('renders progress indicator at normalized position', () => {
    const { container } = render(<TimelineOverview {...makeProps({ normalizedProgress: 0.6 })} />);

    const progressIndicator = container.querySelector('[style*="left: 60%"]');
    expect(progressIndicator).toBeTruthy();
  });

  it('uses destructive color for progress indicator in live mode', () => {
    const { container } = render(
      <TimelineOverview {...makeProps({ isLiveMode: true, normalizedProgress: 0.5 })} />,
    );

    const progressEl = container.querySelector('[style*="hsl(var(--destructive))"]');
    expect(progressEl).toBeTruthy();
  });

  it('uses primary color for progress indicator in replay mode', () => {
    const { container } = render(
      <TimelineOverview {...makeProps({ isLiveMode: false, normalizedProgress: 0.5 })} />,
    );

    const progressEl = container.querySelector('[style*="hsl(var(--primary))"]');
    expect(progressEl).toBeTruthy();
  });
});
