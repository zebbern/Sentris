import { describe, it, expect, vi } from 'bun:test';
import type Redis from 'ioredis';
import { RedisTerminalStreamAdapter } from '../terminal-stream.adapter';

type PipelineResult = [Error | null, unknown];

function createRedisMock(
  results: PipelineResult[] = [
    [null, '1-0'],
    [null, 1],
  ],
) {
  const pipelineCmds: { method: string; args: unknown[] }[] = [];
  const mock = {
    xadd: vi.fn().mockResolvedValue('1-0'),
    sadd: vi.fn().mockResolvedValue(1),
    xdel: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn(() => {
      pipelineCmds.length = 0;
      return {
        xadd(...args: unknown[]) {
          pipelineCmds.push({ method: 'xadd', args });
          return this;
        },
        sadd(...args: unknown[]) {
          pipelineCmds.push({ method: 'sadd', args });
          return this;
        },
        exec: vi.fn().mockResolvedValue(results),
      };
    }),
    _pipelineCmds: pipelineCmds,
  };
  return mock as unknown as Redis & { _pipelineCmds: typeof pipelineCmds };
}

describe('RedisTerminalStreamAdapter', () => {
  it('writes chunk payloads to redis stream via pipeline', async () => {
    const redis = createRedisMock();
    const adapter = new RedisTerminalStreamAdapter(redis, { maxEntries: 10 });

    await adapter.append({
      runId: 'run-123',
      nodeRef: 'node.alpha',
      stream: 'stdout',
      chunkIndex: 5,
      payload: Buffer.from('hello').toString('base64'),
      recordedAt: new Date().toISOString(),
      deltaMs: 0,
      origin: 'docker',
      runnerKind: 'docker',
    });

    expect((redis as any).pipeline).toHaveBeenCalledTimes(1);
    const cmds = (redis as any)._pipelineCmds;
    expect(cmds).toHaveLength(2);

    // First pipeline command: xadd
    const xaddCmd = cmds[0];
    expect(xaddCmd.method).toBe('xadd');
    expect(xaddCmd.args[0]).toBe('terminal:run-123:node.alpha:stdout');

    // Second pipeline command: sadd to tracking SET
    const saddCmd = cmds[1];
    expect(saddCmd.method).toBe('sadd');
    expect(saddCmd.args[0]).toBe('terminal:run-123:_keys');
    expect(saddCmd.args[1]).toBe('terminal:run-123:node.alpha:stdout');
  });

  it('sanitizes node references in keys', async () => {
    const redis = createRedisMock();
    const adapter = new RedisTerminalStreamAdapter(redis);
    await adapter.append({
      runId: 'run-1',
      nodeRef: 'node$1',
      stream: 'stderr',
      chunkIndex: 1,
      payload: '',
      recordedAt: new Date().toISOString(),
      deltaMs: 0,
      origin: 'docker',
      runnerKind: 'docker',
    });
    const cmds = (redis as any)._pipelineCmds;
    const xaddCmd = cmds[0];
    expect(xaddCmd.args[0]).toBe('terminal:run-1:node_1:stderr');
  });

  it('rejects a failed XADD and conditionally removes invalid tracking state atomically', async () => {
    const redis = createRedisMock([
      [new Error('WRONGTYPE stream key'), null],
      [null, 1],
    ]);
    const adapter = new RedisTerminalStreamAdapter(redis);

    await expect(
      adapter.append({
        runId: 'run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        chunkIndex: 1,
        payload: '',
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
        origin: 'docker',
        runnerKind: 'docker',
      }),
    ).rejects.toThrow('terminal stream append failed');

    expect((redis as any).eval).toHaveBeenCalledTimes(1);
    const [script, keyCount, streamKey, trackingKey] = (redis as any).eval.mock.calls[0];
    expect(script).toContain("redis.call('TYPE', KEYS[1])");
    expect(script).toContain("redis.call('SREM', KEYS[2], KEYS[1])");
    expect(keyCount).toBe(2);
    expect(streamKey).toBe('terminal:run-1:node-1:stdout');
    expect(trackingKey).toBe('terminal:run-1:_keys');
    expect((redis as any).srem).not.toHaveBeenCalled();
    expect((redis as any).xdel).not.toHaveBeenCalled();
  });

  it('does not directly remove membership when a racing append established a valid stream', async () => {
    const redis = createRedisMock([
      [new Error('WRONGTYPE stream key'), null],
      [null, 1],
    ]);
    (redis as any).eval.mockResolvedValue(0);
    const adapter = new RedisTerminalStreamAdapter(redis);

    await expect(
      adapter.append({
        runId: 'run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        chunkIndex: 1,
        payload: '',
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
        origin: 'docker',
        runnerKind: 'docker',
      }),
    ).rejects.toThrow('terminal stream append failed');

    expect((redis as any).eval).toHaveBeenCalledWith(
      expect.stringContaining("stream_type ~= 'stream'"),
      2,
      'terminal:run-1:node-1:stdout',
      'terminal:run-1:_keys',
    );
    expect((redis as any).srem).not.toHaveBeenCalled();
    expect((redis as any).xdel).not.toHaveBeenCalled();
  });

  it('rejects a failed SADD and removes the stream entry written by XADD', async () => {
    const redis = createRedisMock([
      [null, '42-0'],
      [new Error('WRONGTYPE tracking key'), null],
    ]);
    const adapter = new RedisTerminalStreamAdapter(redis);

    await expect(
      adapter.append({
        runId: 'run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        chunkIndex: 1,
        payload: '',
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
        origin: 'docker',
        runnerKind: 'docker',
      }),
    ).rejects.toThrow('terminal stream append failed');

    expect((redis as any).xdel).toHaveBeenCalledWith('terminal:run-1:node-1:stdout', '42-0');
    expect((redis as any).srem).not.toHaveBeenCalled();
  });

  it('preserves pre-existing tracking membership when XADD fails', async () => {
    const redis = createRedisMock([
      [new Error('WRONGTYPE stream key'), null],
      [null, 0],
    ]);
    const adapter = new RedisTerminalStreamAdapter(redis);

    await expect(
      adapter.append({
        runId: 'run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        chunkIndex: 1,
        payload: '',
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
        origin: 'docker',
        runnerKind: 'docker',
      }),
    ).rejects.toThrow('terminal stream append failed');

    expect((redis as any).srem).not.toHaveBeenCalled();
    expect((redis as any).eval).not.toHaveBeenCalled();
  });
});
