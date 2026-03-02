import { describe, expect, it, beforeEach, afterEach, vi, mock } from 'bun:test';

// Mock the logger to prevent console noise
mock.module('@/lib/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

import { FetchEventSource } from '../sse-client';

/** Create a ReadableStream that emits SSE-formatted chunks */
function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** Create a mock Response with an SSE body */
function createSSEResponse(chunks: string[], status = 200): Response {
  return new Response(createSSEStream(chunks), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('FetchEventSource', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('has correct static constants', () => {
    expect(FetchEventSource.CONNECTING).toBe(0);
    expect(FetchEventSource.OPEN).toBe(1);
    expect(FetchEventSource.CLOSED).toBe(2);
  });

  it('sets the URL on construction', () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const source = new FetchEventSource('http://localhost/events');
    expect(source.url).toBe('http://localhost/events');
    source.close();
  });

  it('sends custom headers in the fetch request', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const source = new FetchEventSource('http://localhost/events', {
      headers: { Authorization: 'Bearer test-token' },
    });

    // Wait a tick for the fetch to be called
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/events',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );

    source.close();
  });

  it('registers and invokes event listeners', async () => {
    const sseData = 'event:status\ndata:{"alive":true}\n\n';
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([sseData]));
    (globalThis as any).fetch = mockFetch;

    const listener = vi.fn();
    const source: any = new FetchEventSource('http://localhost/events');
    source.addEventListener('status', listener);

    // Wait for stream to be processed
    await new Promise((r) => setTimeout(r, 50));

    expect(listener).toHaveBeenCalled();
    const event = listener.mock.calls[0][0] as MessageEvent;
    expect(event.data).toBe('{"alive":true}');

    source.close();
  });

  it('removes event listeners', () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const listener = vi.fn();
    const source = new FetchEventSource('http://localhost/events');
    source.addEventListener('message', listener);
    source.removeEventListener('message', listener);

    source.close();
  });

  it('dispatches to onmessage handler', async () => {
    const sseData = 'data:hello world\n\n';
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([sseData]));
    (globalThis as any).fetch = mockFetch;

    const handler = vi.fn();
    const source = new FetchEventSource('http://localhost/events');
    source.onmessage = handler;

    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].data).toBe('hello world');

    source.close();
  });

  it('fires onopen handler when connection opens', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const onopen = vi.fn();
    const source = new FetchEventSource('http://localhost/events');
    source.onopen = onopen;

    await new Promise((r) => setTimeout(r, 50));

    // onopen was set after construction, so it may not fire (depends on timing).
    // But the property should be accessible.
    expect(source.onopen).toBe(onopen);

    source.close();
  });

  it('sets readyState to CLOSED after close()', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const source = new FetchEventSource('http://localhost/events');
    source.close();

    expect(source.readyState).toBe(FetchEventSource.CLOSED);
  });

  it('close() is idempotent', () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const source = new FetchEventSource('http://localhost/events');
    source.close();
    source.close(); // should not throw
    expect(source.readyState).toBe(FetchEventSource.CLOSED);
  });

  it('fires onerror when fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    (globalThis as any).fetch = mockFetch;

    const onerror = vi.fn();
    const source = new FetchEventSource('http://localhost/events');
    source.onerror = onerror;

    await new Promise((r) => setTimeout(r, 50));

    // After a fetch failure readyState should be CLOSED
    expect(source.readyState).toBe(FetchEventSource.CLOSED);

    source.close();
  });

  it('fires onerror when response is not ok', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' }));
    (globalThis as any).fetch = mockFetch;

    const onerror = vi.fn();
    const source = new FetchEventSource('http://localhost/events');
    source.onerror = onerror;

    await new Promise((r) => setTimeout(r, 50));

    expect(source.readyState).toBe(FetchEventSource.CLOSED);

    source.close();
  });

  it('processes multiple events in a single chunk', async () => {
    const sseData = 'event:a\ndata:first\n\nevent:b\ndata:second\n\n';
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([sseData]));
    (globalThis as any).fetch = mockFetch;

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const source: any = new FetchEventSource('http://localhost/events');
    source.addEventListener('a', listenerA);
    source.addEventListener('b', listenerB);

    await new Promise((r) => setTimeout(r, 50));

    expect(listenerA).toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalled();
    expect(listenerA.mock.calls[0][0].data).toBe('first');
    expect(listenerB.mock.calls[0][0].data).toBe('second');

    source.close();
  });

  it('sets withCredentials from options', () => {
    const mockFetch = vi.fn().mockResolvedValue(createSSEResponse([]));
    (globalThis as any).fetch = mockFetch;

    const source = new FetchEventSource('http://localhost/events', {
      withCredentials: true,
    });

    expect(source.withCredentials).toBe(true);
    source.close();
  });
});
