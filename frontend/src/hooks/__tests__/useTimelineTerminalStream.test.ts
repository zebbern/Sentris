import { describe, it, expect, afterEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';

// Mock the terminal stream hook — use the alias path matching the source import
const mockChunks = { value: [] as any[] };
const mockTerminalResult = {
  get chunks() {
    return mockChunks.value;
  },
  isHydrating: false,
  isStreaming: false,
  error: null,
  mode: 'idle' as string,
  refresh: mock(),
  fetchMore: mock(),
  exportText: mock(),
};

mock.module('@/hooks/useTerminalStream', () => ({
  useTerminalStream: () => mockTerminalResult,
}));

// Mock the execution timeline store
const mockTimelineState = {
  playbackMode: 'live' as string,
  currentTime: 0,
  timelineStartTime: 1000,
  selectedRunId: 'run-1',
  isLiveFollowing: true,
  totalDuration: 10000,
};

mock.module('@/store/executionTimelineStore', () => ({
  useExecutionTimelineStore: Object.assign(
    (selector: (s: typeof mockTimelineState) => any) => selector(mockTimelineState),
    {
      getState: () => mockTimelineState,
    },
  ),
}));

// Mock API and logger
mock.module('@/services/api', () => ({
  api: {
    executions: {
      getTerminalChunks: mock().mockResolvedValue({ chunks: [] }),
    },
  },
}));

mock.module('@/lib/logger', () => ({
  logger: { error: mock(), warn: mock(), info: mock(), debug: mock() },
}));

import { useTimelineTerminalStream } from '../useTimelineTerminalStream';

afterEach(() => {
  cleanup();
  mockChunks.value = [];
  mockTerminalResult.mode = 'idle';
  mockTimelineState.playbackMode = 'live';
  mockTimelineState.currentTime = 0;
  mockTimelineState.timelineStartTime = 1000;
  mockTimelineState.selectedRunId = 'run-1';
  mockTimelineState.isLiveFollowing = true;
});

describe('useTimelineTerminalStream', () => {
  it('returns base terminal stream results', () => {
    const { result } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
      }),
    );

    expect(result.current.chunks).toBeDefined();
    expect(typeof result.current.isTimelineSync).toBe('boolean');
    expect(typeof result.current.isFetchingTimeline).toBe('boolean');
    expect(typeof result.current.hasData).toBe('boolean');
  });

  it('isTimelineSync is false when timelineSync option is not set', () => {
    const { result } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
      }),
    );

    expect(result.current.isTimelineSync).toBe(false);
  });

  it('isTimelineSync reflects timelineSync option when not in live mode', () => {
    mockTimelineState.playbackMode = 'replay';
    mockTimelineState.isLiveFollowing = false;

    const { result } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
        timelineSync: true,
      }),
    );

    expect(result.current.isTimelineSync).toBe(true);
  });

  it('returns live chunks in live mode', () => {
    mockChunks.value = [
      {
        nodeRef: 'node-1',
        stream: 'pty',
        chunkIndex: 1,
        payload: 'data',
        recordedAt: new Date().toISOString(),
      },
    ];

    const { result } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
        timelineSync: false,
      }),
    );

    expect(result.current.chunks).toHaveLength(1);
    expect(result.current.hasData).toBe(true);
  });

  it('hasData is false when no chunks exist', () => {
    mockChunks.value = [];

    const { result } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
      }),
    );

    expect(result.current.hasData).toBe(false);
  });

  it('cleans up without errors on unmount', () => {
    const { unmount } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
        timelineSync: true,
      }),
    );

    unmount();
  });

  it('mode is "replay" in timeline sync mode (non-live)', () => {
    mockTimelineState.playbackMode = 'replay';
    mockTimelineState.isLiveFollowing = false;

    const { result } = renderHook(() =>
      useTimelineTerminalStream({
        runId: 'run-1',
        nodeId: 'node-1',
        timelineSync: true,
      }),
    );

    expect(result.current.mode).toBe('replay');
  });
});
