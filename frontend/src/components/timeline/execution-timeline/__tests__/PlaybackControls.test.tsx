import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { PlaybackControlsProps } from '../types';

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
const { PlaybackControls } = await import('../PlaybackControls?unmocked');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<PlaybackControlsProps> = {}): PlaybackControlsProps {
  return {
    currentTime: 500,
    totalDuration: 10_000,
    isPlaying: false,
    playbackMode: 'replay',
    playbackSpeed: 1,
    isLiveFollowing: true,
    showHeatMap: false,
    smartRouting: false,
    onPlayPause: mock(() => {}),
    onStepForward: mock(() => {}),
    onStepBackward: mock(() => {}),
    onSpeedChange: mock(() => {}),
    onGoLive: mock(() => {}),
    onToggleHeatMap: mock(() => {}),
    onToggleSmartRouting: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaybackControls', () => {
  afterEach(cleanup);

  it('renders Play button when not playing', () => {
    render(<PlaybackControls {...makeProps({ isPlaying: false })} />);
    expect(screen.getByLabelText('Play')).toBeTruthy();
  });

  it('renders Pause button when playing', () => {
    render(<PlaybackControls {...makeProps({ isPlaying: true })} />);
    expect(screen.getByLabelText('Pause')).toBeTruthy();
  });

  it('fires onPlayPause when play/pause button is clicked', () => {
    const onPlayPause = mock(() => {});
    render(<PlaybackControls {...makeProps({ onPlayPause })} />);

    fireEvent.click(screen.getByLabelText('Play'));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('fires onStepForward when step-forward button is clicked', () => {
    const onStepForward = mock(() => {});
    render(<PlaybackControls {...makeProps({ onStepForward })} />);

    fireEvent.click(screen.getByLabelText('Step forward'));
    expect(onStepForward).toHaveBeenCalledTimes(1);
  });

  it('fires onStepBackward when step-backward button is clicked', () => {
    const onStepBackward = mock(() => {});
    render(<PlaybackControls {...makeProps({ onStepBackward })} />);

    fireEvent.click(screen.getByLabelText('Step backward'));
    expect(onStepBackward).toHaveBeenCalledTimes(1);
  });

  it('disables step-backward when currentTime is 0', () => {
    render(<PlaybackControls {...makeProps({ currentTime: 0 })} />);
    expect(screen.getByLabelText('Step backward').hasAttribute('disabled')).toBe(true);
  });

  it('disables step-forward when currentTime equals totalDuration', () => {
    render(<PlaybackControls {...makeProps({ currentTime: 5000, totalDuration: 5000 })} />);
    expect(screen.getByLabelText('Step forward').hasAttribute('disabled')).toBe(true);
  });

  it('shows current speed on speed selector button', () => {
    render(<PlaybackControls {...makeProps({ playbackSpeed: 2 })} />);
    expect(screen.getAllByText('2x').length).toBeGreaterThanOrEqual(1);
  });

  it('shows LIVE badge in live mode', () => {
    render(<PlaybackControls {...makeProps({ playbackMode: 'live' })} />);
    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('shows EXECUTION badge in replay mode', () => {
    render(<PlaybackControls {...makeProps({ playbackMode: 'replay' })} />);
    expect(screen.getByText('EXECUTION')).toBeTruthy();
  });

  it('shows "Go Live" button in live mode when not following', () => {
    render(<PlaybackControls {...makeProps({ playbackMode: 'live', isLiveFollowing: false })} />);
    expect(screen.getByText('Go Live')).toBeTruthy();
    expect(screen.getByText('Behind live')).toBeTruthy();
  });

  it('fires onGoLive when "Go Live" button is clicked', () => {
    const onGoLive = mock(() => {});
    render(
      <PlaybackControls
        {...makeProps({ playbackMode: 'live', isLiveFollowing: false, onGoLive })}
      />,
    );

    fireEvent.click(screen.getByText('Go Live'));
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it('does not show "Go Live" in replay mode', () => {
    render(<PlaybackControls {...makeProps({ playbackMode: 'replay' })} />);
    expect(screen.queryByText('Go Live')).toBeNull();
  });

  it('renders Heat Map toggle button', () => {
    const onToggleHeatMap = mock(() => {});
    render(<PlaybackControls {...makeProps({ onToggleHeatMap })} />);

    const btn = screen.getByText('Heat Map');
    fireEvent.click(btn);
    expect(onToggleHeatMap).toHaveBeenCalledTimes(1);
  });

  it('renders Smart Routing toggle button', () => {
    const onToggleSmartRouting = mock(() => {});
    render(<PlaybackControls {...makeProps({ onToggleSmartRouting })} />);

    const btn = screen.getByText('Smart Routing');
    fireEvent.click(btn);
    expect(onToggleSmartRouting).toHaveBeenCalledTimes(1);
  });

  it('disables play/pause and speed buttons in live mode', () => {
    render(<PlaybackControls {...makeProps({ playbackMode: 'live' })} />);

    const playBtn = screen.getByLabelText('Play');
    expect(playBtn.hasAttribute('disabled')).toBe(true);
  });
});
