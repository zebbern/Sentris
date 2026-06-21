import { describe, expect, it } from 'bun:test';

import { buildHarResponse } from '../http/har-builder';
import type { HttpResponseLike } from '../http/types';

describe('buildHarResponse', () => {
  it('does not wait for clone stream cancellation after truncating response capture', async () => {
    const encoder = new TextEncoder();
    let readCount = 0;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        readCount += 1;
        controller.enqueue(encoder.encode(`${readCount}`.repeat(20)));
      },
      cancel: () => new Promise<void>(() => {}),
    });

    const response = {
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => '',
      clone: () => response,
      body,
    } as unknown as HttpResponseLike;

    const result = await Promise.race([
      buildHarResponse(response, { maxResponseBodySize: 10 }),
      new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 50)),
    ]);

    expect(result).not.toBe('timed out');
    if (result !== 'timed out') {
      expect(result.content.text).toBe('1111111111');
      expect(result.content.size).toBeGreaterThan(10);
    }
  });
});
