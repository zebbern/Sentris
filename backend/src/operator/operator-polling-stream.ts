import type { Response } from 'express';

interface OperatorPollingStreamOptions<T> {
  response: Response;
  pollIntervalMs: number;
  keepaliveIntervalMs: number;
  load: () => Promise<T>;
  ready: { event: string; payload: unknown };
  snapshot: (value: T) => { event: string; payload: unknown };
  readError: { event: string; payload: unknown };
  onReadError: (error: unknown) => void;
  onWriteError: (error: unknown) => void;
}

/** Shared backpressure-aware transport for the backend's small polling SSE projections. */
export async function streamOperatorPollingProjection<T>(
  options: OperatorPollingStreamOptions<T>,
): Promise<void> {
  const {
    response,
    pollIntervalMs,
    keepaliveIntervalMs,
    load,
    ready,
    snapshot,
    readError,
    onReadError,
    onWriteError,
  } = options;
  let active = true;
  let responseCommitted = false;
  let polling = false;
  let readFailureOpen = false;
  let writeBlocked = false;
  let pendingEvent: string | null = null;
  let pendingSnapshot: string | null = null;
  const timers: { poll?: NodeJS.Timeout; keepalive?: NodeJS.Timeout } = {};

  const cleanup = () => {
    if (!active) return;
    active = false;
    pendingEvent = null;
    pendingSnapshot = null;
    if (timers.poll) clearInterval(timers.poll);
    if (timers.keepalive) clearInterval(timers.keepalive);
    response.removeListener('close', cleanup);
    response.removeListener('drain', flushPendingWrites);
    if (responseCommitted && !response.writableEnded && !response.destroyed) response.end();
  };

  const writeNow = (chunk: string): boolean => {
    if (!active) return false;
    try {
      if (!response.write(chunk)) {
        writeBlocked = true;
        response.once('drain', flushPendingWrites);
      }
      return true;
    } catch (error: unknown) {
      onWriteError(error);
      cleanup();
      return false;
    }
  };

  const write = (chunk: string, coalesceSnapshot = false, preserveEvent = false): boolean => {
    if (!active) return false;
    if (writeBlocked) {
      if (coalesceSnapshot) pendingSnapshot = chunk;
      else if (preserveEvent) pendingEvent = chunk;
      return true;
    }
    return writeNow(chunk);
  };

  function flushPendingWrites() {
    if (!active) return;
    writeBlocked = false;
    const event = pendingEvent;
    pendingEvent = null;
    if (event) {
      writeNow(event);
      if (!active || writeBlocked) return;
    }
    const queuedSnapshot = pendingSnapshot;
    pendingSnapshot = null;
    if (queuedSnapshot) writeNow(queuedSnapshot);
  }

  const send = (event: string, payload: unknown, coalesceSnapshot = false): boolean =>
    write(
      `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
      coalesceSnapshot,
      !coalesceSnapshot,
    );

  response.once('close', cleanup);

  let initialValue: T;
  try {
    initialValue = await load();
  } catch (error: unknown) {
    cleanup();
    throw error;
  }
  if (!active) return;

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  responseCommitted = true;

  send(ready.event, ready.payload);
  let lastSnapshotSignature = JSON.stringify(initialValue);
  const initialSnapshot = snapshot(initialValue);
  send(initialSnapshot.event, initialSnapshot.payload, true);
  if (!active) return;

  const pump = async () => {
    if (!active || polling) return;
    polling = true;
    try {
      const value = await load();
      const signature = JSON.stringify(value);
      if (signature !== lastSnapshotSignature) {
        lastSnapshotSignature = signature;
        const nextSnapshot = snapshot(value);
        send(nextSnapshot.event, nextSnapshot.payload, true);
      }
      readFailureOpen = false;
    } catch (error: unknown) {
      onReadError(error);
      if (!readFailureOpen) {
        readFailureOpen = true;
        send(readError.event, readError.payload);
      }
    } finally {
      polling = false;
    }
  };

  timers.poll = setInterval(() => void pump(), pollIntervalMs);
  timers.poll.unref();
  timers.keepalive = setInterval(() => write(': keepalive\n\n'), keepaliveIntervalMs);
  timers.keepalive.unref();
}
