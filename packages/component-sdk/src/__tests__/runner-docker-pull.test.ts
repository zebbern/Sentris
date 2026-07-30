import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, mock, vi } from 'bun:test';
import { createExecutionContext } from '../context';

const spawnCalls: string[][] = [];
let slowDockerRun = false;
let slowDockerPull = false;
let cleanupFailuresRemaining = 0;
let lastRunProcess:
  | (EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    })
  | undefined;
let lastPullProcess: typeof lastRunProcess;

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
      lastPullProcess = proc;
      if (slowDockerPull) {
        setTimeout(() => proc.emit('close', 0), 25);
        return;
      }
      proc.stderr.emit('data', Buffer.from('Pulling fs layer\n'));
      proc.emit('close', 0);
      return;
    }

    if (args[0] === 'run') {
      lastRunProcess = proc;
      if (slowDockerRun) {
        setTimeout(() => proc.emit('close', 0), 25);
        return;
      }
      proc.stdout.emit('data', Buffer.from('{"ok":true}'));
      proc.emit('close', 0);
      return;
    }

    if (args[0] === 'rm' && cleanupFailuresRemaining > 0) {
      cleanupFailuresRemaining -= 1;
      proc.stderr.emit('data', Buffer.from('No such container\n'));
      proc.emit('close', 1);
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

  it('mounts and labels an independent DIND-visible exchange directory', async () => {
    const sharedRoot = await mkdtemp(join(tmpdir(), 'sentris-shared-runner-test-'));
    const previousRoot = process.env.SENTRIS_DOCKER_SHARED_IO_ROOT;
    const previousDeployment = process.env.SENTRIS_DEPLOYMENT_ID;
    const previousInstance = process.env.SENTRIS_INSTANCE;
    const previousNamespace = process.env.TEMPORAL_NAMESPACE;
    const previousTaskQueue = process.env.TEMPORAL_TASK_QUEUE;
    process.env.SENTRIS_DOCKER_SHARED_IO_ROOT = sharedRoot;
    process.env.SENTRIS_DEPLOYMENT_ID = 'deployment-a';
    process.env.SENTRIS_INSTANCE = '7';
    process.env.TEMPORAL_NAMESPACE = 'namespace-a';
    process.env.TEMPORAL_TASK_QUEUE = 'queue-a';
    spawnCalls.length = 0;

    try {
      const context = createExecutionContext({
        runId: 'sentris-run-11111111-1111-4111-8111-111111111111',
        componentRef: 'docker.shared-io',
      });

      await runComponentWithRunner(
        {
          kind: 'docker',
          image: 'example/scanner:latest',
          command: ['scan'],
          network: 'bridge',
          timeoutSeconds: 30,
        },
        async () => ({}),
        {},
        context,
      );

      const runArgs = spawnCalls.find(([command]) => command === 'run');
      expect(runArgs).toBeDefined();
      expect(runArgs).toContain('sentris.managed=true');
      expect(runArgs).toContain('sentris.runId=sentris-run-11111111-1111-4111-8111-111111111111');
      expect(runArgs).toContain('sentris.deploymentId=deployment-a');
      expect(runArgs).toContain('sentris.instance=7');
      expect(runArgs).toContain('sentris.temporalNamespace=namespace-a');
      expect(runArgs).toContain('sentris.temporalTaskQueue=queue-a');
      expect(runArgs).toContain('bridge');

      const mountIndex = runArgs?.indexOf('-v') ?? -1;
      const mount = runArgs?.[mountIndex + 1] ?? '';
      expect(mount.startsWith(join(sharedRoot, 'runs'))).toBe(true);
      expect(mount.endsWith(':/sentris-output')).toBe(true);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.SENTRIS_DOCKER_SHARED_IO_ROOT;
      } else {
        process.env.SENTRIS_DOCKER_SHARED_IO_ROOT = previousRoot;
      }
      if (previousDeployment === undefined) delete process.env.SENTRIS_DEPLOYMENT_ID;
      else process.env.SENTRIS_DEPLOYMENT_ID = previousDeployment;
      if (previousInstance === undefined) delete process.env.SENTRIS_INSTANCE;
      else process.env.SENTRIS_INSTANCE = previousInstance;
      if (previousNamespace === undefined) delete process.env.TEMPORAL_NAMESPACE;
      else process.env.TEMPORAL_NAMESPACE = previousNamespace;
      if (previousTaskQueue === undefined) delete process.env.TEMPORAL_TASK_QUEUE;
      else process.env.TEMPORAL_TASK_QUEUE = previousTaskQueue;
      await rm(sharedRoot, { recursive: true, force: true });
    }
  });

  it('does not create a Docker container when execution was already cancelled', async () => {
    spawnCalls.length = 0;
    const cancellation = new AbortController();
    cancellation.abort(new Error('activity cancelled'));
    const context = createExecutionContext({
      runId: 'cancel-before-container',
      componentRef: 'docker.cancelled',
      signal: cancellation.signal,
    });

    await expect(
      runComponentWithRunner(
        {
          kind: 'docker',
          image: 'example/scanner:latest',
          command: ['scan'],
        },
        async () => ({}),
        {},
        context,
      ),
    ).rejects.toThrow('activity cancelled');
    expect(spawnCalls.some(([command]) => command === 'run')).toBe(false);
  });

  it('asks Docker to assign the host port for DIND-hosted services', async () => {
    spawnCalls.length = 0;
    const context = createExecutionContext({
      runId: 'docker-auto-port',
      componentRef: 'docker.mcp',
    });

    await runComponentWithRunner(
      {
        kind: 'docker',
        image: 'example/mcp:latest',
        command: [],
        ports: { auto: 8080 },
      },
      async () => ({}),
      {},
      context,
    );

    const runArgs = spawnCalls.find(([command]) => command === 'run');
    const publishIndex = runArgs?.indexOf('-p') ?? -1;
    expect(runArgs?.[publishIndex + 1]).toBe('8080');
    expect(runArgs).not.toContain('auto:8080');
  });

  it('stops an already-running generic container when execution is cancelled', async () => {
    spawnCalls.length = 0;
    lastRunProcess = undefined;
    slowDockerRun = true;
    cleanupFailuresRemaining = 1;
    const cancellation = new AbortController();
    const context = createExecutionContext({
      runId: 'cancel-running-container',
      componentRef: 'docker.cancelled',
      signal: cancellation.signal,
    });

    try {
      const execution = runComponentWithRunner(
        {
          kind: 'docker',
          image: 'example/scanner:latest',
          command: ['scan'],
          containerName: 'sentris-cancel-running',
        },
        async () => ({}),
        {},
        context,
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (spawnCalls.some(([command]) => command === 'run')) break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(lastRunProcess).toBeDefined();
      cancellation.abort(new Error('activity cancelled'));

      await expect(execution).rejects.toThrow('activity cancelled');
      expect(lastRunProcess!.kill).toHaveBeenCalled();
      expect(
        spawnCalls.filter((args) => args[0] === 'rm' && args[2] === 'sentris-cancel-running'),
      ).toHaveLength(2);
    } finally {
      slowDockerRun = false;
      cleanupFailuresRemaining = 0;
    }
  });

  it('cancels an in-flight image pull before creating a container', async () => {
    spawnCalls.length = 0;
    lastPullProcess = undefined;
    slowDockerPull = true;
    const cancellation = new AbortController();
    const context = createExecutionContext({
      runId: 'cancel-image-pull',
      componentRef: 'docker.cancelled',
      signal: cancellation.signal,
    });

    try {
      const execution = runComponentWithRunner(
        {
          kind: 'docker',
          image: 'example/scanner:latest',
          command: ['scan'],
        },
        async () => ({}),
        {},
        context,
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (lastPullProcess) break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(lastPullProcess).toBeDefined();
      cancellation.abort(new Error('activity cancelled'));

      await expect(execution).rejects.toThrow('activity cancelled');
      expect(lastPullProcess!.kill).toHaveBeenCalled();
      expect(spawnCalls.some(([command]) => command === 'run')).toBe(false);
    } finally {
      slowDockerPull = false;
    }
  });
});
