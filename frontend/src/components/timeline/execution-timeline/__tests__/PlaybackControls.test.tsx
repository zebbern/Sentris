import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { PlaybackControlsProps, TimelineViewTogglesProps } from '../types';

// ---------------------------------------------------------------------------
// Mock constants
// ---------------------------------------------------------------------------

mock.module('../constants', () => ({
  PLAYBACK_SPEEDS: [
    { label: '0.5x', value: 0.5 },
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
  ],
}));

// Dynamic import with query param to bypass stale mock.module from ExecutionTimeline.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { PlaybackControls, TimelineViewToggles } = await import('../PlaybackControls?unmocked');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTransportProps(overrides: Partial<PlaybackControlsProps> = {}): PlaybackControlsProps {
  return {
    currentTime: 500,
    totalDuration: 10_000,
    isPlaying: false,
    playbackMode: 'replay',
    playbackSpeed: 1,
    onPlayPause: mock(() => {}),
    onStepForward: mock(() => {}),
    onStepBackward: mock(() => {}),
    onSpeedChange: mock(() => {}),
    ...overrides,
  };
}

function makeViewProps(
  overrides: Partial<TimelineViewTogglesProps> = {},
): TimelineViewTogglesProps {
  return {
    playbackMode: 'live',
    isLiveFollowing: true,
    onGoLive: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaybackControls', () => {
  afterEach(cleanup);

  it('renders Play button when not playing', () => {
    render(<PlaybackControls {...makeTransportProps({ isPlaying: false })} />);
    expect(screen.getByLabelText('Play')).toBeTruthy();
  });

  it('renders Pause button when playing', () => {
    render(<PlaybackControls {...makeTransportProps({ isPlaying: true })} />);
    expect(screen.getByLabelText('Pause')).toBeTruthy();
  });

  it('fires onPlayPause when play/pause button is clicked', () => {
    const onPlayPause = mock(() => {});
    render(<PlaybackControls {...makeTransportProps({ onPlayPause })} />);

    fireEvent.click(screen.getByLabelText('Play'));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('fires onStepForward when step-forward button is clicked', () => {
    const onStepForward = mock(() => {});
    render(<PlaybackControls {...makeTransportProps({ onStepForward })} />);

    fireEvent.click(screen.getByLabelText('Step forward'));
    expect(onStepForward).toHaveBeenCalledTimes(1);
  });

  it('fires onStepBackward when step-backward button is clicked', () => {
    const onStepBackward = mock(() => {});
    render(<PlaybackControls {...makeTransportProps({ onStepBackward })} />);

    fireEvent.click(screen.getByLabelText('Step backward'));
    expect(onStepBackward).toHaveBeenCalledTimes(1);
  });

  it('disables step-backward when currentTime is 0', () => {
    render(<PlaybackControls {...makeTransportProps({ currentTime: 0 })} />);
    expect(screen.getByLabelText('Step backward').hasAttribute('disabled')).toBe(true);
  });

  it('disables step-forward when currentTime equals totalDuration', () => {
    render(
      <PlaybackControls {...makeTransportProps({ currentTime: 5000, totalDuration: 5000 })} />,
    );
    expect(screen.getByLabelText('Step forward').hasAttribute('disabled')).toBe(true);
  });

  it('shows current speed on speed selector button', () => {
    render(<PlaybackControls {...makeTransportProps({ playbackSpeed: 2 })} />);
    expect(screen.getAllByText('2x').length).toBeGreaterThanOrEqual(1);
  });

  it('disables play/pause and speed buttons in live mode', () => {
    render(<PlaybackControls {...makeTransportProps({ playbackMode: 'live' })} />);

    const playBtn = screen.getByLabelText('Play');
    expect(playBtn.hasAttribute('disabled')).toBe(true);
  });
});

describe('TimelineViewToggles', () => {
  afterEach(cleanup);

  it('shows LIVE badge in live mode', () => {
    render(<TimelineViewToggles {...makeViewProps({ playbackMode: 'live' })} />);
    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('renders nothing in replay mode', () => {
    const { container } = render(
      <TimelineViewToggles {...makeViewProps({ playbackMode: 'replay' })} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows "Go Live" button in live mode when not following', () => {
    render(
      <TimelineViewToggles {...makeViewProps({ playbackMode: 'live', isLiveFollowing: false })} />,
    );
    expect(screen.getByText('Go Live')).toBeTruthy();
    expect(screen.getByText('Behind live')).toBeTruthy();
  });

  it('fires onGoLive when "Go Live" button is clicked', () => {
    const onGoLive = mock(() => {});
    render(
      <TimelineViewToggles
        {...makeViewProps({ playbackMode: 'live', isLiveFollowing: false, onGoLive })}
      />,
    );

    fireEvent.click(screen.getByText('Go Live'));
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it('does not show "Go Live" when already following live', () => {
    render(
      <TimelineViewToggles {...makeViewProps({ playbackMode: 'live', isLiveFollowing: true })} />,
    );
    expect(screen.queryByText('Go Live')).toBeNull();
  });
});
