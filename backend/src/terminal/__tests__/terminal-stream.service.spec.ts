import { describe, it, expect } from 'bun:test';
import type Redis from 'ioredis';
import { TerminalStreamService } from '../terminal-stream.service';

class MockRedis {
  private trackingSets: Record<string, Set<string>> = {};

  constructor(private readonly entries: Record<string, [string, string][]>) {}
  private scanCalled = false;

  async scan(cursor: string, _matchLabel: string, pattern: string) {
    if (cursor !== '0' || this.scanCalled) {
      return ['0', []];
    }
    this.scanCalled = true;
    const keys = Object.keys(this.entries).filter((key) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(key);
    });
    return ['0', keys];
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.trackingSets[key];
    return set ? Array.from(set) : [];
  }

  async xrange(key: string, start: string) {
    const all = this.entries[key] ?? [];
    return all
      .filter(([id]) => start === '-' || this.compare(id, start) >= 0)
      .map(([id, payload]) => [id, ['data', payload]]);
  }

  private compare(a: string, b: string) {
    const [ams, aseq] = a.split('-').map(Number);
    const [bms, bseq] = b.split('-').map(Number);
    if (ams !== bms) return ams - bms;
    return aseq - bseq;
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) {
      if (this.entries[key]) {
        Reflect.deleteProperty(this.entries, key);
        removed += 1;
      }
      if (this.trackingSets[key]) {
        Reflect.deleteProperty(this.trackingSets, key);
        removed += 1;
      }
    }
    return removed;
  }

  pipeline() {
    const commands: { method: string; args: unknown[] }[] = [];
    const pipe = {
      del: (...keys: string[]) => {
        commands.push({ method: 'del', args: keys });
        return pipe;
      },
      exec: async () => {
        const results: [Error | null, unknown][] = [];
        for (const cmd of commands) {
          const result = await (this as any)[cmd.method](...cmd.args);
          results.push([null, result]);
        }
        return results;
      },
    };
    return pipe;
  }

  /** Pre-populate the tracking SET to simulate data written with SET tracking */
  _setTracking(key: string, members: string[]) {
    this.trackingSets[key] = new Set(members);
  }

  async quit() {}
}

describe('TerminalStreamService', () => {
  it('returns chunks and encodes cursor (SCAN fallback)', async () => {
    const payload = JSON.stringify({
      chunkIndex: 1,
      payload: 'a',
      recordedAt: '2025-01-01T00:00:00Z',
      deltaMs: 0,
    });
    const redis = new MockRedis({
      'terminal:run-1:node.a:stdout': [['1-0', payload]],
    }) as unknown as Redis;
    const service = new TerminalStreamService(redis);

    const result = await service.fetchChunks('run-1');

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].nodeRef).toBe('node.a');
    expect(result.cursor.includes('terminal:run-1:node.a:stdout')).toBe(true);
  });

  it('handles missing redis gracefully', async () => {
    const service = new TerminalStreamService(null);
    const result = await service.fetchChunks('run-2', { cursor: '{"foo":"1-0"}' });
    expect(result.chunks).toHaveLength(0);
    expect(result.cursor).toBe('{"foo":"1-0"}');
  });

  it('lists available streams (SCAN fallback)', async () => {
    const redis = new MockRedis({
      'terminal:run-3:node.one:pty': [],
      'terminal:run-3:node.two:stderr': [],
    }) as unknown as Redis;
    const service = new TerminalStreamService(redis);

    const streams = await service.listStreams('run-3');

    expect(streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeRef: 'node.one', stream: 'pty' }),
        expect.objectContaining({ nodeRef: 'node.two', stream: 'stderr' }),
      ]),
    );
  });

  it('deletes streams by run', async () => {
    const redis = new MockRedis({
      'terminal:run-4:node.one:pty': [],
      'terminal:run-4:node.two:stderr': [],
    }) as unknown as Redis;
    const service = new TerminalStreamService(redis);

    const removed = await service.deleteStreams('run-4');

    expect(removed).toBe(2);
  });

  it('uses tracking SET when available for listStreams', async () => {
    const redis = new MockRedis({
      'terminal:run-5:node.x:stdout': [],
      'terminal:run-5:node.y:stderr': [],
    });
    redis._setTracking('terminal:run-5:_keys', [
      'terminal:run-5:node.x:stdout',
      'terminal:run-5:node.y:stderr',
    ]);
    const service = new TerminalStreamService(redis as unknown as Redis);

    const streams = await service.listStreams('run-5');

    expect(streams).toHaveLength(2);
    expect(streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeRef: 'node.x', stream: 'stdout' }),
        expect.objectContaining({ nodeRef: 'node.y', stream: 'stderr' }),
      ]),
    );
  });

  it('uses tracking SET for fetchChunks', async () => {
    const payload = JSON.stringify({
      chunkIndex: 0,
      payload: 'tracked',
      recordedAt: '2025-06-01T00:00:00Z',
      deltaMs: 0,
    });
    const redis = new MockRedis({
      'terminal:run-6:node.z:stdout': [['1-0', payload]],
    });
    redis._setTracking('terminal:run-6:_keys', ['terminal:run-6:node.z:stdout']);
    const service = new TerminalStreamService(redis as unknown as Redis);

    const result = await service.fetchChunks('run-6');

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].payload).toBe('tracked');
  });

  it('deleteStreams cleans up the tracking SET', async () => {
    const redis = new MockRedis({
      'terminal:run-7:node.a:stdout': [],
    });
    redis._setTracking('terminal:run-7:_keys', ['terminal:run-7:node.a:stdout']);
    const service = new TerminalStreamService(redis as unknown as Redis);

    const removed = await service.deleteStreams('run-7');

    expect(removed).toBe(1);
    // Tracking SET should be cleaned up (second del in pipeline)
    const remainingKeys = await (redis as any).smembers('terminal:run-7:_keys');
    expect(remainingKeys).toHaveLength(0);
  });
});
