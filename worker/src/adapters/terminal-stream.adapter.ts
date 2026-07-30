import Redis from 'ioredis';
import type { TerminalChunkInput } from '@sentris/component-sdk';

export interface TerminalStreamAdapterOptions {
  maxEntries?: number;
}

const REMOVE_INVALID_TRACKING_MEMBERSHIP_LUA = `
local stream_type = redis.call('TYPE', KEYS[1]).ok
if stream_type ~= 'stream' then
  return redis.call('SREM', KEYS[2], KEYS[1])
end
return 0
`;

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
    const results = await pipeline.exec();

    if (!results || results.length !== 2) {
      throw new Error('Redis terminal stream append failed: incomplete pipeline response');
    }

    const [xaddError, xaddResult] = results[0];
    const [saddError, saddResult] = results[1];
    if (!xaddError && !saddError) {
      return;
    }

    const errors: unknown[] = [xaddError, saddError].filter(Boolean);

    // Redis pipelines are not atomic. Undo only state this append can prove it
    // created, and keep the healthy path to one round trip.
    if (!xaddError && saddError && typeof xaddResult === 'string') {
      try {
        await this.redis.xdel(key, xaddResult);
      } catch (error: unknown) {
        errors.push(error);
      }
    } else if (xaddError && !saddError && Number(saddResult) === 1) {
      try {
        // The type check and removal must be one Redis operation. A successful
        // append racing this cleanup establishes a stream and retains the
        // shared membership.
        await this.redis.eval(REMOVE_INVALID_TRACKING_MEMBERSHIP_LUA, 2, key, trackingKey);
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    throw new AggregateError(errors, 'Redis terminal stream append failed');
  }

  private buildTrackingKey(runId: string): string {
    return `terminal:${runId}:_keys`;
  }

  private buildKey(chunk: TerminalChunkInput): string {
    const safeNode = chunk.nodeRef.replace(/[^a-zA-Z0-9:_.-]/g, '_');
    return `terminal:${chunk.runId}:${safeNode}:${chunk.stream}`;
  }
}
