import Redis from 'ioredis';
import type { TerminalChunkInput } from '@sentris/component-sdk';

export interface TerminalStreamAdapterOptions {
  maxEntries?: number;
}

export class RedisTerminalStreamAdapter {
  private readonly maxEntries: number;

  constructor(
    private readonly redis: Redis,
    options: TerminalStreamAdapterOptions = {},
  ) {
    this.maxEntries = options.maxEntries ?? 5000;
  }

  async append(chunk: TerminalChunkInput): Promise<void> {
    const key = this.buildKey(chunk);
    const trackingKey = this.buildTrackingKey(chunk.runId);

    const payload = JSON.stringify({
      chunkIndex: chunk.chunkIndex,
      payload: chunk.payload,
      recordedAt: chunk.recordedAt,
      deltaMs: chunk.deltaMs,
      origin: chunk.origin,
      runnerKind: chunk.runnerKind,
    });

    const pipeline = this.redis.pipeline();
    pipeline.xadd(key, 'MAXLEN', '~', this.maxEntries, '*', 'data', payload);
    pipeline.sadd(trackingKey, key);
    await pipeline.exec();
  }

  private buildTrackingKey(runId: string): string {
    return `terminal:${runId}:_keys`;
  }

  private buildKey(chunk: TerminalChunkInput): string {
    const safeNode = chunk.nodeRef.replace(/[^a-zA-Z0-9:_.-]/g, '_');
    return `terminal:${chunk.runId}:${safeNode}:${chunk.stream}`;
  }
}
