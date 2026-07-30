import { describe, expect, it, vi } from 'bun:test';

import { LokiLogClient } from '../loki.client';

describe('LokiLogClient', () => {
  it('aborts a push that accepts the connection but never responds', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        requestSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(requestSignal?.reason ?? new Error('aborted')),
            { once: true },
          );
        });
      },
    );
    const client = new LokiLogClient(
      {
        baseUrl: 'http://loki:3100',
        timeoutMs: 5,
      },
      fetchImpl,
    );

    await expect(
      client.push({ runId: 'run-1' }, [
        { message: 'scanner output', timestamp: new Date('2026-07-29T12:00:00.000Z') },
      ]),
    ).rejects.toThrow('Loki push timed out after 5ms');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });
});
