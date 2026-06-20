import { EventEmitter } from 'node:events';
import { describe, expect, it, mock, vi } from 'bun:test';
import { createExecutionContext } from '../context';

const standardSpawn = vi.fn(() => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  proc.kill = vi.fn();

  queueMicrotask(() => {
    proc.stdout.emit('data', Buffer.from('{}'));
    proc.emit('close', 0);
  });

  return proc;
});

mock.module('child_process', () => ({
  spawn: standardSpawn,
}));

mock.module('node-pty', () => ({
  spawn: () => {
    throw new Error('pty spawn failed');
  },
}));

const { runComponentWithRunner } = await import('../runner');

describe('Docker PTY diagnostics', () => {
  it('falls back without writing raw diagnostic objects to console.log', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const context = createExecutionContext({
        runId: 'pty-fallback-run',
        componentRef: 'pty.component',
        terminalCollector: vi.fn(),
      });

      const result = await runComponentWithRunner(
        {
          kind: 'docker',
          image: 'busybox:1.36',
          command: ['echo', '{}'],
          timeoutSeconds: 30,
        },
        async () => ({}),
        {},
        context,
      );

      expect(result).toEqual({});
      expect(standardSpawn).toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalledWith('diag', expect.any(Object));
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
