import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Response } from 'express';

import type { OperatorSessionDetail } from '@sentris/shared';

import type { AuthContext } from '../../auth/types';
import {
  OPERATOR_SESSION_STREAM_KEEPALIVE_INTERVAL_MS,
  OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
  OperatorSessionStreamService,
} from '../operator-session-stream.service';
import type { OperatorService } from '../operator.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const auth: AuthContext = {
  userId: 'operator-user',
  organizationId: 'operator-org',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'local',
};

const initialSession: OperatorSessionDetail = {
  id: SESSION_ID,
  title: 'Investigation',
  approvalMode: 'ask',
  status: 'active',
  model: {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash',
    apiKeySecretId: '22222222-2222-4222-8222-222222222222',
    baseUrl: null,
  },
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  turns: [],
  messages: [],
  actions: [],
};

interface CapturedInterval {
  callback: () => void;
  delay: number;
  handle: NodeJS.Timeout;
}

function createResponse(writeResults: boolean[] = []) {
  const writes: string[] = [];
  const state = { writableEnded: false, destroyed: false };
  const events = new EventEmitter();
  const response = Object.assign(events, {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return writeResults.shift() ?? true;
    }),
    end: vi.fn(() => {
      state.writableEnded = true;
    }),
  });
  Object.defineProperties(response, {
    writableEnded: { get: () => state.writableEnded },
    destroyed: { get: () => state.destroyed },
  });
  return { response: response as unknown as Response, responseMock: response, writes };
}

function eventPayloads(writes: string[], event: string): unknown[] {
  return writes
    .filter((chunk) => chunk.startsWith(`event: ${event}\n`))
    .map((chunk) => JSON.parse(chunk.split('\ndata: ')[1]!.trim()));
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('OperatorSessionStreamService', () => {
  let intervals: CapturedInterval[];
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    intervals = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay: number,
    ) => {
      const handle = { unref: vi.fn() } as unknown as NodeJS.Timeout;
      intervals.push({ callback, delay, handle });
      return handle;
    }) as typeof setInterval);
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves session ownership before committing SSE headers', async () => {
    const getSession = vi.fn().mockRejectedValue(new Error('forbidden'));
    const service = new OperatorSessionStreamService({ getSession } as unknown as OperatorService);
    const { response, responseMock } = createResponse();

    await expect(service.streamSession(auth, SESSION_ID, response)).rejects.toThrow('forbidden');

    expect(responseMock.setHeader).not.toHaveBeenCalled();
    expect(responseMock.flushHeaders).not.toHaveBeenCalled();
    expect(intervals).toHaveLength(0);
    expect(responseMock.listenerCount('close')).toBe(0);
  });

  it('does not commit a response or install timers when the client disconnects during ownership lookup', async () => {
    let resolveSession: ((session: OperatorSessionDetail) => void) | undefined;
    const getSession = vi.fn(
      () =>
        new Promise<OperatorSessionDetail>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const service = new OperatorSessionStreamService({ getSession } as unknown as OperatorService);
    const { response, responseMock, writes } = createResponse();

    const stream = service.streamSession(auth, SESSION_ID, response);
    await flushAsyncWork();
    responseMock.emit('close');
    resolveSession!(initialSession);
    await stream;

    expect(responseMock.setHeader).not.toHaveBeenCalled();
    expect(responseMock.flushHeaders).not.toHaveBeenCalled();
    expect(responseMock.end).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(intervals).toHaveLength(0);
    expect(responseMock.listenerCount('close')).toBe(0);
  });

  it('sends an immediate full snapshot and only emits changed snapshots while polling', async () => {
    const changedSession: OperatorSessionDetail = {
      ...initialSession,
      title: 'Investigation in progress',
      updatedAt: '2026-08-02T10:00:01.000Z',
    };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(initialSession)
      .mockResolvedValueOnce(initialSession)
      .mockResolvedValueOnce(changedSession);
    const service = new OperatorSessionStreamService({ getSession } as unknown as OperatorService);
    const { response, responseMock, writes } = createResponse();

    await service.streamSession(auth, SESSION_ID, response);

    expect(responseMock.setHeader.mock.calls).toEqual([
      ['Content-Type', 'text/event-stream'],
      ['Cache-Control', 'no-cache, no-transform'],
      ['Connection', 'keep-alive'],
      ['X-Accel-Buffering', 'no'],
    ]);
    expect(responseMock.flushHeaders).toHaveBeenCalledTimes(1);
    expect(eventPayloads(writes, 'ready')).toEqual([
      {
        version: 1,
        sessionId: SESSION_ID,
        mode: 'polling',
        intervalMs: OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
      },
    ]);
    expect(eventPayloads(writes, 'snapshot')).toEqual([{ version: 1, session: initialSession }]);

    const poll = intervals.find(
      (interval) => interval.delay === OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
    );
    expect(poll).toBeDefined();
    poll!.callback();
    await flushAsyncWork();
    expect(eventPayloads(writes, 'snapshot')).toHaveLength(1);

    poll!.callback();
    await flushAsyncWork();
    expect(eventPayloads(writes, 'snapshot')).toEqual([
      { version: 1, session: initialSession },
      { version: 1, session: changedSession },
    ]);
  });

  it('coalesces changed snapshots to the newest projection while the response is backpressured', async () => {
    const firstChange: OperatorSessionDetail = {
      ...initialSession,
      title: 'First change',
      updatedAt: '2026-08-02T10:00:01.000Z',
    };
    const newestChange: OperatorSessionDetail = {
      ...initialSession,
      title: 'Newest change',
      updatedAt: '2026-08-02T10:00:02.000Z',
    };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(initialSession)
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce(firstChange)
      .mockResolvedValueOnce(newestChange);
    const service = new OperatorSessionStreamService({ getSession } as unknown as OperatorService);
    // The initial snapshot is buffered by Node, while later snapshots must wait for drain.
    const { response, responseMock, writes } = createResponse([true, false, true, true]);

    await service.streamSession(auth, SESSION_ID, response);
    const poll = intervals.find(
      (interval) => interval.delay === OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
    )!;

    poll.callback();
    await flushAsyncWork();
    poll.callback();
    await flushAsyncWork();
    poll.callback();
    await flushAsyncWork();

    expect(eventPayloads(writes, 'snapshot')).toEqual([{ version: 1, session: initialSession }]);
    expect(responseMock.listenerCount('drain')).toBe(1);

    responseMock.emit('drain');

    expect(eventPayloads(writes, 'error')).toEqual([
      {
        version: 1,
        code: 'session_read_failed',
        message: 'Operator session update could not be read',
      },
    ]);
    expect(eventPayloads(writes, 'snapshot')).toEqual([
      { version: 1, session: initialSession },
      { version: 1, session: newestChange },
    ]);
    expect(writes.join('')).not.toContain('First change');
    expect(responseMock.listenerCount('drain')).toBe(0);
  });

  it('reports a transient read failure once and continues with later snapshots', async () => {
    const recoveredSession: OperatorSessionDetail = {
      ...initialSession,
      updatedAt: '2026-08-02T10:00:02.000Z',
    };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(initialSession)
      .mockRejectedValueOnce(new Error('database credentials must not reach the browser'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockResolvedValueOnce(recoveredSession);
    const service = new OperatorSessionStreamService({ getSession } as unknown as OperatorService);
    const { response, writes } = createResponse();

    await service.streamSession(auth, SESSION_ID, response);
    const poll = intervals.find(
      (interval) => interval.delay === OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS,
    )!;

    poll.callback();
    await flushAsyncWork();
    poll.callback();
    await flushAsyncWork();

    expect(eventPayloads(writes, 'error')).toEqual([
      {
        version: 1,
        code: 'session_read_failed',
        message: 'Operator session update could not be read',
      },
    ]);
    expect(writes.join('')).not.toContain('database credentials');

    poll.callback();
    await flushAsyncWork();
    expect(eventPayloads(writes, 'snapshot')).toContainEqual({
      version: 1,
      session: recoveredSession,
    });
  });

  it('writes keepalives and clears both timers when the client disconnects', async () => {
    const getSession = vi.fn().mockResolvedValue(initialSession);
    const service = new OperatorSessionStreamService({ getSession } as unknown as OperatorService);
    const { response, responseMock, writes } = createResponse();

    await service.streamSession(auth, SESSION_ID, response);
    const keepalive = intervals.find(
      (interval) => interval.delay === OPERATOR_SESSION_STREAM_KEEPALIVE_INTERVAL_MS,
    )!;
    keepalive.callback();
    expect(writes.at(-1)).toBe(': keepalive\n\n');

    responseMock.emit('close');

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    expect(responseMock.end).toHaveBeenCalledTimes(1);
    expect(responseMock.listenerCount('close')).toBe(0);

    const readsAfterClose = getSession.mock.calls.length;
    intervals
      .find((interval) => interval.delay === OPERATOR_SESSION_STREAM_POLL_INTERVAL_MS)!
      .callback();
    await flushAsyncWork();
    expect(getSession).toHaveBeenCalledTimes(readsAfterClose);
  });
});
