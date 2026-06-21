import { EventEmitter } from 'node:events';
import { describe, expect, it, mock, vi } from 'bun:test';
import { createExecutionContext } from '../context';

const spawnCalls: string[][] = [];

const dockerSpawn = vi.fn((_: string, args: string[]) => {
  spawnCalls.push(args);

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
    if (args[0] === 'image' && args[1] === 'inspect') {
      proc.emit('close', 1);
      return;
    }

    if (args[0] === 'pull') {
      proc.stderr.emit('data', Buffer.from('Pulling fs layer\n'));
      proc.emit('close', 0);
      return;
    }

    if (args[0] === 'run') {
      proc.stdout.emit('data', Buffer.from('{"ok":true}'));
      proc.emit('close', 0);
      return;
    }

    proc.emit('close', 0);
  });

  return proc;
});

mock.module('child_process', () => ({
  spawn: dockerSpawn,
}));

const { runComponentWithRunner, stripAnsiCodes } = await import('../runner');

describe('Docker image preparation', () => {
  it('strips private-mode terminal control sequences from fallback output', () => {
    expect(stripAnsiCodes('\x1B[?9001h\x1B[?1004h\x1B[?25lapi.example.com')).toBe(
      'api.example.com',
    );
  });

  it('pulls a missing image before running the container without polluting output', async () => {
    spawnCalls.length = 0;

    const context = createExecutionContext({
      runId: 'docker-pull-run',
      componentRef: 'docker.pull',
    });

    const result = await runComponentWithRunner(
      {
        kind: 'docker',
        image: 'example/scanner:latest',
        command: ['scan'],
        timeoutSeconds: 30,
      },
      async () => ({}),
      {},
      context,
    );

    expect(result).toEqual({ ok: true });
    expect(spawnCalls.map((args) => args.slice(0, 3))).toEqual([
      ['image', 'inspect', 'example/scanner:latest'],
      ['pull', 'example/scanner:latest'],
      ['run', '--rm', '-i'],
    ]);
  });
});
