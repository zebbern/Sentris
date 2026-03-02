import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  createTraceHandler,
  createStatusHandler,
  createTerminalHandler,
  createLogsHandler,
  createReadyHandler,
} from '../sseHandlers';
import { useTerminalStreamStore } from '../terminalStreamStore';
import { useExecutionLogStore } from '../executionLogStore';
import type { ExecutionLog } from '@/schemas/execution';

// ---------------------------------------------------------------------------
// SSE accessor mock factory
// ---------------------------------------------------------------------------

function createMockAccessor() {
  const state: Record<string, any> = {
    events: [],
    nodeStates: {},
    cursor: null,
    workflowId: null,
    trackedRuns: [],
    runStatus: null,
    pollingInterval: null,
  };

  const stopPolling = mock(() => {});
  const pollOnce = mock(async () => {});

  const accessor = {
    set: mock((partial: any) => {
      if (typeof partial === 'function') {
        const updates = partial(state);
        Object.assign(state, updates);
      } else {
        Object.assign(state, partial);
      }
    }),
    get: mock((): any => ({
      ...state,
      runStatus: state.runStatus as any,
      pollingInterval: state.pollingInterval as any,
      stopPolling,
      pollOnce,
    })),
    _state: state,
    _stopPolling: stopPolling,
    _pollOnce: pollOnce,
  };

  return accessor;
}

function makeMessageEvent(data: unknown): Event {
  return { data: JSON.stringify(data) } as unknown as Event;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTraceHandler', () => {
  let accessor: ReturnType<typeof createMockAccessor>;

  beforeEach(() => {
    accessor = createMockAccessor();
  });

  it('merges incoming events into state', () => {
    const handler = createTraceHandler(accessor);
    const events: Partial<ExecutionLog>[] = [
      {
        id: 'e1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'STARTED',
        level: 'info',
        timestamp: new Date().toISOString(),
      },
    ];

    handler(makeMessageEvent({ events }));

    expect(accessor.set).toHaveBeenCalled();
    // Verify the set function was called with a function (for state merge)
    const setArg = (accessor.set as any).mock.calls[0][0];
    expect(typeof setArg).toBe('function');
  });

  it('ignores empty events array', () => {
    const handler = createTraceHandler(accessor);
    handler(makeMessageEvent({ events: [] }));
    expect(accessor.set).not.toHaveBeenCalled();
  });

  it('ignores missing events property', () => {
    const handler = createTraceHandler(accessor);
    handler(makeMessageEvent({}));
    expect(accessor.set).not.toHaveBeenCalled();
  });

  it('does not throw on invalid JSON', () => {
    const handler = createTraceHandler(accessor);
    const event = { data: 'not valid json' } as unknown as Event;
    expect(() => handler(event)).not.toThrow();
  });

  it('updates cursor from payload', () => {
    const handler = createTraceHandler(accessor);
    const events: Partial<ExecutionLog>[] = [
      {
        id: 'e1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'STARTED',
        level: 'info',
        timestamp: new Date().toISOString(),
      },
    ];
    handler(makeMessageEvent({ events, cursor: 'cursor-X' }));

    // The set function is called with a function that accesses state
    const setFn = (accessor.set as any).mock.calls[0][0];
    const result = setFn({ events: [], nodeStates: {}, cursor: null });
    expect(result.cursor).toBe('cursor-X');
  });
});

describe('createStatusHandler', () => {
  let accessor: ReturnType<typeof createMockAccessor>;

  beforeEach(() => {
    accessor = createMockAccessor();
  });

  it('updates status and lifecycle in state', () => {
    const handler = createStatusHandler(accessor, 'run-1');
    const statusPayload = {
      status: 'RUNNING',
      runId: 'run-1',
      workflowId: 'wf-1',
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
      taskQueue: 'default',
      historyLength: 5,
    };
    handler(makeMessageEvent(statusPayload));

    expect(accessor.set).toHaveBeenCalled();
    const setFn = (accessor.set as any).mock.calls[0][0];
    const result = setFn({
      workflowId: null,
      trackedRuns: [{ runId: 'run-1', status: 'queued' }],
    });
    expect(result.status).toBe('running');
    expect(result.runStatus).toBeDefined();
  });

  it('stops polling on terminal status', () => {
    const handler = createStatusHandler(accessor, 'run-1');
    const statusPayload = {
      status: 'COMPLETED',
      runId: 'run-1',
      workflowId: 'wf-1',
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:02Z',
      completedAt: '2026-01-01T00:00:02Z',
      taskQueue: 'default',
      historyLength: 10,
    };
    handler(makeMessageEvent(statusPayload));
    expect(accessor._stopPolling).toHaveBeenCalled();
  });

  it('does not stop polling on non-terminal status', () => {
    const handler = createStatusHandler(accessor, 'run-1');
    const statusPayload = {
      status: 'RUNNING',
      runId: 'run-1',
      workflowId: 'wf-1',
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
      taskQueue: 'default',
      historyLength: 3,
    };
    handler(makeMessageEvent(statusPayload));
    expect(accessor._stopPolling).not.toHaveBeenCalled();
  });

  it('does not throw on invalid JSON', () => {
    const handler = createStatusHandler(accessor, 'run-1');
    const event = { data: 'broken' } as unknown as Event;
    expect(() => handler(event)).not.toThrow();
  });
});

describe('createTerminalHandler', () => {
  beforeEach(() => {
    useTerminalStreamStore.getState().resetTerminalStreams();
  });

  it('merges terminal chunks into terminalStreamStore', () => {
    const handler = createTerminalHandler();
    const chunks = [
      {
        nodeRef: 'n1',
        stream: 'pty',
        chunkIndex: 1,
        payload: 'data',
        recordedAt: new Date().toISOString(),
      },
    ];
    handler(makeMessageEvent({ chunks }));

    const session = useTerminalStreamStore.getState().getTerminalSession('n1', 'pty');
    expect(session).toBeDefined();
    expect(session!.chunks).toHaveLength(1);
  });

  it('ignores empty chunks array', () => {
    const handler = createTerminalHandler();
    expect(() => handler(makeMessageEvent({ chunks: [] }))).not.toThrow();
  });

  it('ignores missing chunks property', () => {
    const handler = createTerminalHandler();
    expect(() => handler(makeMessageEvent({}))).not.toThrow();
  });

  it('does not throw on invalid JSON', () => {
    const handler = createTerminalHandler();
    const event = { data: 'nope' } as unknown as Event;
    expect(() => handler(event)).not.toThrow();
  });
});

describe('createLogsHandler', () => {
  beforeEach(() => {
    useExecutionLogStore.getState().resetLogs();
  });

  it('merges logs into executionLogStore', () => {
    const handler = createLogsHandler();
    const logs = [
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        level: 'info',
        message: 'test',
        timestamp: new Date().toISOString(),
      },
    ];
    handler(makeMessageEvent({ logs }));

    const liveLogs = useExecutionLogStore.getState().liveLogs;
    expect(liveLogs).toHaveLength(1);
    expect(liveLogs[0].id).toBe('l1');
  });

  it('maps log entries to ExecutionLog shape with type PROGRESS', () => {
    const handler = createLogsHandler();
    const logs = [
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        level: 'error',
        message: 'oops',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    handler(makeMessageEvent({ logs }));

    const log = useExecutionLogStore.getState().liveLogs[0];
    expect(log.type).toBe('PROGRESS');
    expect(log.level).toBe('error');
    expect(log.message).toBe('oops');
  });

  it('updates cursor when provided', () => {
    const handler = createLogsHandler();
    const logs = [
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        level: 'info',
        message: 'test',
        timestamp: new Date().toISOString(),
      },
    ];
    handler(makeMessageEvent({ logs, cursor: 'cur-1' }));

    expect(useExecutionLogStore.getState().logCursor).toBe('cur-1');
  });

  it('ignores empty logs array', () => {
    const handler = createLogsHandler();
    handler(makeMessageEvent({ logs: [] }));

    expect(useExecutionLogStore.getState().liveLogs).toEqual([]);
  });

  it('does not throw on invalid JSON', () => {
    const handler = createLogsHandler();
    const event = { data: '{broken' } as unknown as Event;
    expect(() => handler(event)).not.toThrow();
  });
});

describe('createReadyHandler', () => {
  let accessor: ReturnType<typeof createMockAccessor>;

  beforeEach(() => {
    accessor = createMockAccessor();
  });

  it('sets streamingMode from payload', () => {
    const handler = createReadyHandler(accessor);
    handler(makeMessageEvent({ mode: 'realtime', runId: 'r1' }));
    expect(accessor.set).toHaveBeenCalledWith({ streamingMode: 'realtime' });
  });

  it('sets polling mode', () => {
    const handler = createReadyHandler(accessor);
    handler(makeMessageEvent({ mode: 'polling', runId: 'r1' }));
    expect(accessor.set).toHaveBeenCalledWith({ streamingMode: 'polling' });
  });

  it('does not throw on invalid JSON', () => {
    const handler = createReadyHandler(accessor);
    const event = { data: 'invalid' } as unknown as Event;
    expect(() => handler(event)).not.toThrow();
  });
});
