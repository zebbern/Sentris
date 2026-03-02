import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
// Dynamic import with query param to bypass stale mock.module from ExecutionTimeline.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { TimelineStatusBar } = await import('../TimelineStatusBar?unmocked');
import type { TimelineStatusBarProps } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<TimelineStatusBarProps> = {}): TimelineStatusBarProps {
  return {
    eventCount: 24,
    nodeCount: 5,
    playbackSpeed: 1,
    playbackMode: 'replay',
    isSeeking: false,
    isPlaying: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimelineStatusBar', () => {
  afterEach(cleanup);

  it('renders event count and node count', () => {
    render(<TimelineStatusBar {...makeProps({ eventCount: 42, nodeCount: 7 })} />);

    expect(screen.getByText('42 events')).toBeTruthy();
    expect(screen.getByText('7 nodes')).toBeTruthy();
  });

  it('shows speed label in replay mode', () => {
    render(<TimelineStatusBar {...makeProps({ playbackSpeed: 2 })} />);

    expect(screen.getByText('Speed: 2x')).toBeTruthy();
  });

  it('hides speed label in live mode', () => {
    render(<TimelineStatusBar {...makeProps({ playbackMode: 'live', playbackSpeed: 1 })} />);

    expect(screen.queryByText(/Speed:/)).toBeNull();
  });

  it('shows "Seeking..." when isSeeking is true', () => {
    render(<TimelineStatusBar {...makeProps({ isSeeking: true })} />);

    expect(screen.getByText('Seeking...')).toBeTruthy();
  });

  it('does not show "Seeking..." when isSeeking is false', () => {
    render(<TimelineStatusBar {...makeProps({ isSeeking: false })} />);

    expect(screen.queryByText('Seeking...')).toBeNull();
  });

  it('shows "Playing..." when isPlaying is true in replay mode', () => {
    render(<TimelineStatusBar {...makeProps({ isPlaying: true, playbackMode: 'replay' })} />);

    expect(screen.getByText('Playing...')).toBeTruthy();
  });

  it('does not show "Playing..." when isPlaying is true in live mode', () => {
    render(<TimelineStatusBar {...makeProps({ isPlaying: true, playbackMode: 'live' })} />);

    expect(screen.queryByText('Playing...')).toBeNull();
  });

  it('does not show "Playing..." when isPlaying is false', () => {
    render(<TimelineStatusBar {...makeProps({ isPlaying: false, playbackMode: 'replay' })} />);

    expect(screen.queryByText('Playing...')).toBeNull();
  });
});
