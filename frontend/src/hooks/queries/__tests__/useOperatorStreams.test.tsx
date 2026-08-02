import { afterEach, describe, expect, it, vi } from 'bun:test';
import { act, cleanup, waitFor } from '@testing-library/react';
import type { OperatorSessionDetail } from '@sentris/shared';

import { queryKeys } from '@/lib/queryKeys';
import type { ExecutionStatusResponse, ExecutionTraceStream } from '@/schemas/execution';
import { api } from '@/services/api';
import { createTestQueryClient, renderHookWithProviders } from '@/test/render-with-providers';
import {
  useOperatorRunQueryStream,
  useOperatorRunTrace,
  useOperatorSessionStream,
} from '../useOperatorQueries';

class MockEventSource {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url = 'http://localhost/stream';
  readonly withCredentials = true;
  readyState = this.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = this.CLOSED;
  });

  end(): void {
    this.readyState = this.CLOSED;
    this.onerror?.(new Event('error'));
  }

  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  emit(type: string, payload: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const session = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Operator session',
  approvalMode: 'ask',
  status: 'active',
  model: {
    provider: 'gemini',
    modelId: 'gemini-3.6-flash',
    apiKeySecretId: '11111111-1111-4111-8111-111111111111',
    baseUrl: null,
  },
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  turns: [],
  messages: [],
  actions: [],
} satisfies OperatorSessionDetail;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Operator query streams', () => {
  it('hydrates the canonical session query from authenticated stream snapshots', async () => {
    const source = new MockEventSource();
    vi.spyOn(api.operator, 'streamSession').mockResolvedValue(source as unknown as EventSource);
    vi.spyOn(api.operator, 'getSession').mockResolvedValue(session);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.operator.session(session.id), session);

    const { result, unmount } = renderHookWithProviders(
      () => useOperatorSessionStream(session.id),
      { queryClient },
    );

    await waitFor(() => expect(api.operator.streamSession).toHaveBeenCalledWith(session.id));
    act(() => {
      source.emit('ready', {
        version: 1,
        sessionId: session.id,
        mode: 'polling',
        intervalMs: 1_000,
      });
    });
    expect(result.current.streamState).toBe('live');

    const snapshot = {
      ...session,
      updatedAt: '2026-08-02T10:00:01.000Z',
      messages: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          sessionId: session.id,
          turnId: '44444444-4444-4444-8444-444444444444',
          sequence: 1,
          role: 'assistant' as const,
          content: 'The run has started.',
          createdAt: '2026-08-02T10:00:01.000Z',
        },
      ],
    };
    act(() => {
      source.emit('snapshot', { version: 1, session: snapshot });
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<OperatorSessionDetail>(queryKeys.operator.session(session.id)),
      ).toEqual(snapshot),
    );

    act(() => {
      source.emit('error', {
        version: 1,
        code: 'session_read_failed',
        message: 'Operator session update could not be read',
      });
    });
    expect(result.current.streamState).toBe('polling');
    expect(source.close).toHaveBeenCalledTimes(1);

    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when the session transport reaches EOF', async () => {
    const source = new MockEventSource();
    vi.spyOn(api.operator, 'streamSession').mockResolvedValue(source as unknown as EventSource);
    vi.spyOn(api.operator, 'getSession').mockResolvedValue(session);

    const { result } = renderHookWithProviders(() => useOperatorSessionStream(session.id));
    await waitFor(() => expect(api.operator.streamSession).toHaveBeenCalledWith(session.id));

    act(() => source.end());

    expect(result.current.streamState).toBe('polling');
  });

  it('does not let an older REST session response overwrite a newer stream snapshot', async () => {
    const source = new MockEventSource();
    const pendingSession = deferred<OperatorSessionDetail>();
    vi.spyOn(api.operator, 'streamSession').mockResolvedValue(source as unknown as EventSource);
    vi.spyOn(api.operator, 'getSession').mockReturnValue(pendingSession.promise);
    const queryClient = createTestQueryClient();

    renderHookWithProviders(() => useOperatorSessionStream(session.id), { queryClient });
    await waitFor(() => {
      expect(api.operator.getSession).toHaveBeenCalledWith(session.id);
      expect(api.operator.streamSession).toHaveBeenCalledWith(session.id);
    });

    const streamSnapshot = {
      ...session,
      updatedAt: '2026-08-02T10:00:02.000Z',
      messages: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          sessionId: session.id,
          turnId: '44444444-4444-4444-8444-444444444444',
          sequence: 1,
          role: 'assistant' as const,
          content: 'Newer streamed state',
          createdAt: '2026-08-02T10:00:02.000Z',
        },
      ],
    };
    act(() => source.emit('snapshot', { version: 1, session: streamSnapshot }));

    await act(async () => {
      pendingSession.resolve(session);
      await pendingSession.promise;
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<OperatorSessionDetail>(queryKeys.operator.session(session.id)),
      ).toEqual(streamSnapshot),
    );
  });

  it('merges run status and trace events into the existing execution query caches', async () => {
    const source = new MockEventSource();
    const stream = vi
      .spyOn(api.executions, 'stream')
      .mockResolvedValue(source as unknown as EventSource);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.executions.status('run-1'), { status: 'RUNNING' });
    queryClient.setQueryData<ExecutionTraceStream>(queryKeys.executions.trace('run-1'), {
      runId: 'run-1',
      events: [],
      cursor: '4',
    });

    const { result } = renderHookWithProviders(() => useOperatorRunQueryStream('run-1'), {
      queryClient,
    });

    await waitFor(() => expect(stream).toHaveBeenCalledWith('run-1', { cursor: '4' }));
    act(() => source.emit('ready', { mode: 'realtime', runId: 'run-1' }));
    expect(result.current.streamState).toBe('live');

    const status = {
      runId: 'run-1',
      workflowId: 'workflow-1',
      status: 'RUNNING' as const,
      startedAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:01.000Z',
      taskQueue: 'sentris-default',
      historyLength: 4,
      progress: { completedActions: 1, totalActions: 3 },
    };
    act(() => source.emit('status', status));
    expect(
      queryClient.getQueryData<ExecutionStatusResponse>(queryKeys.executions.status('run-1')),
    ).toEqual(status);

    const firstEvent = {
      id: '5',
      runId: 'run-1',
      nodeId: 'scan',
      type: 'STARTED' as const,
      level: 'info' as const,
      timestamp: '2026-08-02T10:00:01.000Z',
      message: 'Scanning target',
    };
    const secondEvent = {
      ...firstEvent,
      id: '6',
      type: 'PROGRESS' as const,
      timestamp: '2026-08-02T10:00:02.000Z',
      message: 'Checking endpoints',
    };
    act(() => {
      source.emit('trace', { events: [firstEvent], cursor: '5' });
      source.emit('trace', { events: [firstEvent, secondEvent], cursor: '6' });
    });
    expect(
      queryClient.getQueryData<ExecutionTraceStream>(queryKeys.executions.trace('run-1')),
    ).toEqual({
      runId: 'run-1',
      events: [firstEvent, secondEvent],
      cursor: '6',
    });

    act(() => source.emit('complete', { runId: 'run-1', status: 'COMPLETED' }));
    expect(result.current.streamState).toBe('closed');
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when the run stream fails', async () => {
    const source = new MockEventSource();
    vi.spyOn(api.executions, 'stream').mockResolvedValue(source as unknown as EventSource);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.executions.status('run-1'), { status: 'RUNNING' });

    const { result } = renderHookWithProviders(() => useOperatorRunQueryStream('run-1'), {
      queryClient,
    });
    await waitFor(() => expect(api.executions.stream).toHaveBeenCalled());

    act(() => source.emit('error', { message: 'status_fetch_failed' }));

    expect(result.current.streamState).toBe('polling');
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('does not let older REST run data overwrite newer stream status or trace data', async () => {
    const source = new MockEventSource();
    const pendingStatus = deferred<ExecutionStatusResponse>();
    const pendingTrace = deferred<ExecutionTraceStream>();
    vi.spyOn(api.executions, 'stream').mockResolvedValue(source as unknown as EventSource);
    vi.spyOn(api.executions, 'getStatus').mockReturnValue(pendingStatus.promise as never);
    vi.spyOn(api.executions, 'getTrace').mockReturnValue(pendingTrace.promise as never);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.executions.status('run-1'), { status: 'RUNNING' });

    renderHookWithProviders(
      () => {
        const stream = useOperatorRunQueryStream('run-1');
        useOperatorRunTrace('run-1', 'RUNNING', Date.now(), stream.streamState);
        return stream;
      },
      { queryClient },
    );

    await waitFor(() => {
      expect(api.executions.stream).toHaveBeenCalled();
      expect(api.executions.getStatus).toHaveBeenCalledWith('run-1');
      expect(api.executions.getTrace).toHaveBeenCalledWith('run-1');
    });

    const streamedStatus = {
      runId: 'run-1',
      workflowId: 'workflow-1',
      status: 'RUNNING' as const,
      startedAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:03.000Z',
      taskQueue: 'sentris-default',
      historyLength: 6,
      progress: { completedActions: 2, totalActions: 3 },
    };
    const streamedEvent = {
      id: '6',
      runId: 'run-1',
      nodeId: 'scan',
      type: 'PROGRESS' as const,
      level: 'info' as const,
      timestamp: '2026-08-02T10:00:03.000Z',
      message: 'Newer streamed trace',
    };
    act(() => {
      source.emit('status', streamedStatus);
      source.emit('trace', { events: [streamedEvent], cursor: '6' });
    });

    await act(async () => {
      pendingStatus.resolve({
        ...streamedStatus,
        updatedAt: '2026-08-02T10:00:01.000Z',
        historyLength: 2,
        progress: { completedActions: 0, totalActions: 3 },
      });
      pendingTrace.resolve({ runId: 'run-1', events: [], cursor: '2' });
      await Promise.all([pendingStatus.promise, pendingTrace.promise]);
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ExecutionStatusResponse>(queryKeys.executions.status('run-1')),
      ).toEqual(streamedStatus);
      expect(
        queryClient.getQueryData<ExecutionTraceStream>(queryKeys.executions.trace('run-1')),
      ).toEqual({ runId: 'run-1', events: [streamedEvent], cursor: '6' });
    });
  });

  it('does not open a run stream until status is known to be nonterminal', async () => {
    const stream = vi.spyOn(api.executions, 'stream');
    vi.spyOn(api.executions, 'getStatus').mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-1',
      status: 'COMPLETED',
      startedAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:01.000Z',
      completedAt: '2026-08-02T10:00:01.000Z',
      taskQueue: 'sentris-default',
      historyLength: 4,
    } as never);

    const { result } = renderHookWithProviders(() => useOperatorRunQueryStream('run-1'));

    expect(stream).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.statusQuery.isSuccess).toBe(true));
    expect(result.current.streamState).toBe('closed');
    expect(stream).not.toHaveBeenCalled();
  });
});
