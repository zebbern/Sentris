import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { TimelineStatusCounts, TimelinePlaybackState } from '../TimelineStatusBar';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimelineStatusCounts', () => {
  afterEach(cleanup);

  it('renders event count and node count', () => {
    render(<TimelineStatusCounts eventCount={42} nodeCount={7} />);

    expect(screen.getByText('42 events')).toBeTruthy();
    expect(screen.getByText('7 nodes')).toBeTruthy();
  });
});

describe('TimelinePlaybackState', () => {
  afterEach(cleanup);

  it('shows "Seeking" when isSeeking is true', () => {
    render(<TimelinePlaybackState playbackMode="replay" isSeeking isPlaying={false} />);

    expect(screen.getByText('Seeking')).toBeTruthy();
  });

  it('does not show "Seeking" when isSeeking is false', () => {
    render(<TimelinePlaybackState playbackMode="replay" isSeeking={false} isPlaying={false} />);

    expect(screen.queryByText('Seeking')).toBeNull();
  });

  it('shows "Playing" when isPlaying is true in replay mode', () => {
    render(<TimelinePlaybackState playbackMode="replay" isSeeking={false} isPlaying />);

    expect(screen.getByText('Playing')).toBeTruthy();
  });

  it('does not show "Playing" when isPlaying is true in live mode', () => {
    render(<TimelinePlaybackState playbackMode="live" isSeeking={false} isPlaying />);

    expect(screen.queryByText('Playing')).toBeNull();
  });

  it('does not show "Playing" when isPlaying is false', () => {
    render(<TimelinePlaybackState playbackMode="replay" isSeeking={false} isPlaying={false} />);

    expect(screen.queryByText('Playing')).toBeNull();
  });
});
