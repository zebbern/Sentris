import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { HarTimings } from '../types';

// ---------------------------------------------------------------------------
// Mock utils
// ---------------------------------------------------------------------------

mock.module('../utils', () => ({
  formatDuration: (ms?: number) => {
    if (ms === undefined || ms < 0) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  },
}));

import { TimingBar } from '../TimingBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimings(overrides: Partial<HarTimings> = {}): HarTimings {
  return {
    blocked: 0,
    dns: 0,
    connect: 0,
    ssl: 0,
    send: 0,
    wait: 0,
    receive: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimingBar', () => {
  afterEach(cleanup);

  it('shows "No timing data available" when all timings are zero', () => {
    render(<TimingBar timings={makeTimings()} totalTime={0} />);

    expect(screen.getByText('No timing data available')).toBeTruthy();
  });

  it('shows "No timing data available" when totalTime is zero', () => {
    render(<TimingBar timings={makeTimings({ wait: 100 })} totalTime={0} />);

    expect(screen.getByText('No timing data available')).toBeTruthy();
  });

  it('renders timing segments for non-zero phases', () => {
    const timings = makeTimings({ dns: 50, connect: 100, wait: 200 });
    render(<TimingBar timings={timings} totalTime={350} />);

    expect(screen.getByText('DNS:')).toBeTruthy();
    expect(screen.getByText('50ms')).toBeTruthy();
    expect(screen.getByText('Connect:')).toBeTruthy();
    expect(screen.getByText('100ms')).toBeTruthy();
    expect(screen.getByText('Wait:')).toBeTruthy();
    expect(screen.getByText('200ms')).toBeTruthy();
  });

  it('does not render segments for zero-value phases', () => {
    const timings = makeTimings({ wait: 500 });
    render(<TimingBar timings={timings} totalTime={500} />);

    expect(screen.queryByText('DNS:')).toBeNull();
    expect(screen.queryByText('Connect:')).toBeNull();
    expect(screen.queryByText('SSL:')).toBeNull();
    expect(screen.queryByText('Send:')).toBeNull();
    expect(screen.queryByText('Blocked:')).toBeNull();
    expect(screen.getByText('Wait:')).toBeTruthy();
  });

  it('renders all seven segments when all are non-zero', () => {
    const timings: HarTimings = {
      blocked: 10,
      dns: 20,
      connect: 30,
      ssl: 40,
      send: 5,
      wait: 150,
      receive: 45,
    };
    render(<TimingBar timings={timings} totalTime={300} />);

    expect(screen.getByText('Blocked:')).toBeTruthy();
    expect(screen.getByText('DNS:')).toBeTruthy();
    expect(screen.getByText('Connect:')).toBeTruthy();
    expect(screen.getByText('SSL:')).toBeTruthy();
    expect(screen.getByText('Send:')).toBeTruthy();
    expect(screen.getByText('Wait:')).toBeTruthy();
    expect(screen.getByText('Receive:')).toBeTruthy();
  });

  it('formats durations >= 1s in seconds', () => {
    const timings = makeTimings({ wait: 2500 });
    render(<TimingBar timings={timings} totalTime={2500} />);

    expect(screen.getByText('2.50s')).toBeTruthy();
  });

  it('sets correct width proportions for segments', () => {
    const timings = makeTimings({ dns: 100, wait: 400 });
    const { container } = render(<TimingBar timings={timings} totalTime={500} />);

    // DNS should be 20% and Wait should be 80%
    const bar = container.querySelector('.h-6');
    const segments = bar?.children;
    expect(segments?.length).toBe(2);

    const dnsSegment = segments?.[0] as HTMLElement;
    expect(dnsSegment?.style.width).toBe('20%');

    const waitSegment = segments?.[1] as HTMLElement;
    expect(waitSegment?.style.width).toBe('80%');
  });

  it('renders color legend items matching segment count', () => {
    const timings = makeTimings({ send: 10, wait: 90, receive: 50 });
    const { container } = render(<TimingBar timings={timings} totalTime={150} />);

    // Legend area with colored squares
    const legendSquares = container.querySelectorAll('.w-2\\.5');
    expect(legendSquares.length).toBe(3);
  });
});
