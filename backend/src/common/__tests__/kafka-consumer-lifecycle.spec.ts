import { describe, expect, it, vi } from 'bun:test';
import type { Consumer } from 'kafkajs';

import { KafkaConsumerLifecycleSupervisor } from '../kafka-consumer-lifecycle';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeConsumer {
  readonly events = {
    CRASH: 'consumer.crash',
    DISCONNECT: 'consumer.disconnect',
    STOP: 'consumer.stop',
    HEARTBEAT: 'consumer.heartbeat',
  } as const;
  readonly disconnect = vi.fn(async () => undefined);
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  on(eventName: string, listener: (event: any) => void): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return () => listeners.delete(listener);
  }

  emit(eventName: string, event: any = { payload: null }): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
  }
}

describe('KafkaConsumerLifecycleSupervisor', () => {
  it('retries startup indefinitely with bounded exponential backoff and controlled jitter', async () => {
    const running = deferred<undefined>();
    const consumers: FakeConsumer[] = [];
    const delays: number[] = [];
    let attempts = 0;
    const health = {
      connecting: vi.fn(),
      running: vi.fn(() => running.resolve(undefined)),
      failed: vi.fn(),
      stopped: vi.fn(),
    };
    const supervisor = new KafkaConsumerLifecycleSupervisor({
      name: 'events',
      createConsumer: () => {
        const consumer = new FakeConsumer();
        consumers.push(consumer);
        return consumer as unknown as Consumer;
      },
      startConsumer: async () => {
        attempts += 1;
        if (attempts <= 3) {
          throw new Error(`startup-${attempts}`);
        }
      },
      health,
      sleep: async (delay) => {
        delays.push(delay);
      },
      random: () => 0.5,
      backoff: { initialMs: 100, maxMs: 250, jitterRatio: 0.2 },
    });

    supervisor.start();
    await running.promise;

    expect(attempts).toBe(4);
    expect(delays).toEqual([100, 200, 250]);
    expect(
      consumers.slice(0, 3).every((consumer) => consumer.disconnect.mock.calls.length === 1),
    ).toBe(true);

    await supervisor.stop();
    expect(consumers[3].disconnect).toHaveBeenCalledTimes(1);
  });

  it('recreates a crashed consumer only after the failed consumer is disconnected', async () => {
    const runningTwice = deferred<undefined>();
    const consumers: FakeConsumer[] = [];
    const lifecycle: string[] = [];
    let runningCount = 0;
    const supervisor = new KafkaConsumerLifecycleSupervisor({
      name: 'logs',
      createConsumer: () => {
        const consumer = new FakeConsumer();
        consumer.disconnect.mockImplementation(async () => {
          lifecycle.push(`disconnect-${consumers.indexOf(consumer)}`);
        });
        consumers.push(consumer);
        lifecycle.push(`create-${consumers.length - 1}`);
        return consumer as unknown as Consumer;
      },
      startConsumer: async () => undefined,
      health: {
        connecting: vi.fn(),
        running: vi.fn(() => {
          runningCount += 1;
          if (runningCount === 2) runningTwice.resolve(undefined);
        }),
        failed: vi.fn(),
        stopped: vi.fn(),
      },
      sleep: async () => undefined,
      random: () => 0.5,
    });

    supervisor.start();
    while (runningCount < 1) {
      await Promise.resolve();
    }
    consumers[0].emit(consumers[0].events.CRASH, {
      payload: { error: new Error('runtime crash'), restart: false },
    });
    await runningTwice.promise;

    expect(lifecycle.slice(0, 3)).toEqual(['create-0', 'disconnect-0', 'create-1']);

    await supervisor.stop();
  });

  it('reports a crash as unhealthy before waiting for disconnect cleanup', async () => {
    const disconnectGate = deferred<undefined>();
    const failed = deferred<undefined>();
    const consumers: FakeConsumer[] = [];
    const healthStates: string[] = [];
    const supervisor = new KafkaConsumerLifecycleSupervisor({
      name: 'logs',
      createConsumer: () => {
        const consumer = new FakeConsumer();
        consumer.disconnect.mockImplementation(async () => disconnectGate.promise);
        consumers.push(consumer);
        return consumer as unknown as Consumer;
      },
      startConsumer: async () => undefined,
      health: {
        connecting: vi.fn(() => healthStates.push('connecting')),
        running: vi.fn(() => healthStates.push('running')),
        failed: vi.fn(() => {
          healthStates.push('failed');
          failed.resolve(undefined);
        }),
        stopped: vi.fn(() => healthStates.push('stopped')),
      },
      sleep: async (_delay, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      disconnectTimeoutMs: 30_000,
    });

    supervisor.start();
    while (!healthStates.includes('running')) {
      await Promise.resolve();
    }
    consumers[0].emit(consumers[0].events.CRASH, {
      payload: { error: new Error('runtime crash'), restart: false },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(healthStates).toEqual(['connecting', 'running', 'failed']);
    expect(consumers).toHaveLength(1);

    disconnectGate.resolve(undefined);
    await failed.promise;
    await supervisor.stop();
  });

  it('uses missing heartbeats to recover when KafkaJS hangs before emitting CRASH', async () => {
    const neverDisconnects = deferred<undefined>();
    const runningTwice = deferred<undefined>();
    const consumers: FakeConsumer[] = [];
    let runningCount = 0;
    const supervisor = new KafkaConsumerLifecycleSupervisor({
      name: 'logs',
      createConsumer: () => {
        const consumer = new FakeConsumer();
        if (consumers.length === 0) {
          consumer.disconnect.mockImplementation(async () => neverDisconnects.promise);
        }
        consumers.push(consumer);
        return consumer as unknown as Consumer;
      },
      startConsumer: async () => undefined,
      health: {
        connecting: vi.fn(),
        running: vi.fn(() => {
          runningCount += 1;
          if (runningCount === 2) runningTwice.resolve(undefined);
        }),
        failed: vi.fn(),
        stopped: vi.fn(),
      },
      sleep: async () => undefined,
      disconnectTimeoutMs: 5,
      heartbeatTimeoutMs: 10,
    });

    supervisor.start();
    while (runningCount < 1) {
      await Promise.resolve();
    }

    const recreated = await Promise.race([
      runningTwice.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    if (!recreated) {
      neverDisconnects.resolve(undefined);
    }

    expect(recreated).toBe(true);
    expect(consumers).toHaveLength(2);

    await supervisor.stop();
  });

  it('backs off exponentially across repeated immediate runtime crashes', async () => {
    const stable = deferred<undefined>();
    const consumers: FakeConsumer[] = [];
    const delays: number[] = [];
    let runningCount = 0;
    const supervisor = new KafkaConsumerLifecycleSupervisor({
      name: 'events',
      createConsumer: () => {
        const consumer = new FakeConsumer();
        consumers.push(consumer);
        return consumer as unknown as Consumer;
      },
      startConsumer: async () => undefined,
      health: {
        connecting: vi.fn(),
        running: vi.fn(() => {
          runningCount += 1;
          const consumer = consumers[runningCount - 1];
          if (runningCount <= 3) {
            queueMicrotask(() =>
              consumer.emit(consumer.events.CRASH, {
                payload: { error: new Error(`runtime-${runningCount}`), restart: false },
              }),
            );
          } else {
            stable.resolve(undefined);
          }
        }),
        failed: vi.fn(),
        stopped: vi.fn(),
      },
      sleep: async (delay) => {
        delays.push(delay);
      },
      random: () => 0.5,
      backoff: { initialMs: 100, maxMs: 1_000, jitterRatio: 0.2 },
    });

    supervisor.start();
    await stable.promise;

    expect(delays).toEqual([100, 200, 400]);

    await supervisor.stop();
  });

  it('stops cleanly during backoff without creating another consumer', async () => {
    const sleeping = deferred<undefined>();
    const consumers: FakeConsumer[] = [];
    const supervisor = new KafkaConsumerLifecycleSupervisor({
      name: 'node-io',
      createConsumer: () => {
        const consumer = new FakeConsumer();
        consumers.push(consumer);
        return consumer as unknown as Consumer;
      },
      startConsumer: async () => {
        throw new Error('Kafka unavailable');
      },
      health: {
        connecting: vi.fn(),
        running: vi.fn(),
        failed: vi.fn(),
        stopped: vi.fn(),
      },
      sleep: async (_delay, signal) => {
        sleeping.resolve(undefined);
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      random: () => 0.5,
    });

    supervisor.start();
    await sleeping.promise;
    await supervisor.stop();

    expect(consumers).toHaveLength(1);
    expect(consumers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
