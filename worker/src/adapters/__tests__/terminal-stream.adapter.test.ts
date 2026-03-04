import { describe, it, expect, vi } from 'bun:test';
import type Redis from 'ioredis';
import { RedisTerminalStreamAdapter } from '../terminal-stream.adapter';

function createRedisMock() {
  const pipelineCmds: { method: string; args: unknown[] }[] = [];
  const mock = {
    xadd: vi.fn().mockResolvedValue('1-0'),
    sadd: vi.fn().mockResolvedValue(1),
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
        exec: vi.fn().mockResolvedValue(pipelineCmds.map(() => [null, 'OK'])),
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
});
