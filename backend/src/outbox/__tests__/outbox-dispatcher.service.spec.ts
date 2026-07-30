import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it, mock } from 'bun:test';

import {
  OutboxDispatcherService,
  type ClaimedOutboxEvent,
  type OutboxDispatcherScheduler,
  type OutboxIntervalHandle,
  type OutboxRepositoryPort,
} from '../outbox-dispatcher.service';

function event(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: 'event-1',
    eventType: 'test.changed',
    organizationId: 'org-1',
    aggregateType: 'test',
    aggregateId: 'aggregate-1',
    dedupeKey: 'test:aggregate-1:v1',
    payload: { value: 1 },
    attempts: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function repository(initialEvents: ClaimedOutboxEvent[]) {
  let claimed = false;
  return {
    claimBatch: mock(async () => {
      if (claimed) return [];
      claimed = true;
      return initialEvents;
    }),
    renewLease: mock(async () => true),
    markCompleted: mock(async () => {}),
    reschedule: mock(async () => {}),
  } satisfies OutboxRepositoryPort;
}

class ControlledIntervalScheduler implements OutboxDispatcherScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  setInterval(callback: () => void): { id: number; unref(): void } {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return { id, unref() {} };
  }

  clearInterval(handle: OutboxIntervalHandle): void {
    this.callbacks.delete((handle as { id: number }).id);
  }

  advance(): void {
    for (const callback of this.callbacks.values()) {
      callback();
    }
  }
}

describe('OutboxDispatcherService', () => {
  it('awaits listeners before marking an event complete', async () => {
    const repo = repository([event()]);
    const emitter = new EventEmitter2();
    const listener = mock(async () => {});
    emitter.on('test.changed', listener);
    const dispatcher = new OutboxDispatcherService(repo, emitter);

    await dispatcher.drainOnce();

    expect(listener).toHaveBeenCalledWith({
      value: 1,
      outbox: {
        eventId: 'event-1',
        dedupeKey: 'test:aggregate-1:v1',
        attempt: 1,
      },
    });
    expect(repo.markCompleted).toHaveBeenCalledWith('event-1', expect.any(String));
    expect(repo.reschedule).not.toHaveBeenCalled();
  });

  it('reschedules a known failure with deterministic bounded backoff', async () => {
    const repo = repository([event({ attempts: 3 })]);
    const emitter = new EventEmitter2();
    emitter.on('test.changed', async () => {
      throw new Error('dependency unavailable');
    });
    const dispatcher = new OutboxDispatcherService(repo, emitter);

    await dispatcher.drainOnce();

    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.reschedule).toHaveBeenCalledWith('event-1', expect.any(String), {
      dead: false,
      delayMs: 4_000,
      error: 'dependency unavailable',
    });
  });

  it('reschedules an event when no listener is registered instead of dropping it', async () => {
    const repo = repository([event()]);
    const dispatcher = new OutboxDispatcherService(repo, new EventEmitter2());

    await dispatcher.drainOnce();

    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.reschedule).toHaveBeenCalledWith('event-1', expect.any(String), {
      dead: false,
      delayMs: 1_000,
      error: 'No listener registered for outbox event type test.changed',
    });
  });

  it('dead-letters an event after its configured maximum attempts', async () => {
    const repo = repository([event({ attempts: 5, maxAttempts: 5 })]);
    const emitter = new EventEmitter2();
    emitter.on('test.changed', async () => {
      throw new Error('permanent failure');
    });
    const dispatcher = new OutboxDispatcherService(repo, emitter);

    await dispatcher.drainOnce();

    expect(repo.reschedule).toHaveBeenCalledWith('event-1', expect.any(String), {
      dead: true,
      delayMs: 0,
      error: 'permanent failure',
    });
  });

  it('renews the worker-owned lease while a listener remains in flight', async () => {
    let releaseListener: (() => void) | undefined;
    const listenerGate = new Promise<void>((resolve) => {
      releaseListener = resolve;
    });
    const repo = repository([event()]);
    const emitter = new EventEmitter2();
    emitter.on('test.changed', async () => listenerGate);
    const scheduler = new ControlledIntervalScheduler();
    const dispatcher = new OutboxDispatcherService(repo, emitter, scheduler);

    const drain = dispatcher.drainOnce();
    await Promise.resolve();
    await Promise.resolve();
    scheduler.advance();
    await Promise.resolve();
    releaseListener?.();
    await drain;

    expect(repo.renewLease).toHaveBeenCalledWith('event-1', expect.any(String));
    expect(repo.markCompleted).toHaveBeenCalledWith('event-1', expect.any(String));
  });

  it('does not mark an event complete after lease renewal loses ownership', async () => {
    let releaseListener: (() => void) | undefined;
    const listenerGate = new Promise<void>((resolve) => {
      releaseListener = resolve;
    });
    const repo = repository([event()]);
    repo.renewLease.mockResolvedValue(false);
    const emitter = new EventEmitter2();
    emitter.on('test.changed', async () => listenerGate);
    const scheduler = new ControlledIntervalScheduler();
    const dispatcher = new OutboxDispatcherService(repo, emitter, scheduler);

    const drain = dispatcher.drainOnce();
    await Promise.resolve();
    await Promise.resolve();
    scheduler.advance();
    await Promise.resolve();
    releaseListener?.();
    await drain;

    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.reschedule).toHaveBeenCalledWith('event-1', expect.any(String), {
      dead: false,
      delayMs: 1_000,
      error: 'Outbox lease ownership lost for event event-1',
    });
  });

  it('reschedules instead of completing when the lease heartbeat cannot be persisted', async () => {
    let releaseListener: (() => void) | undefined;
    const listenerGate = new Promise<void>((resolve) => {
      releaseListener = resolve;
    });
    const repo = repository([event()]);
    repo.renewLease.mockRejectedValue(new Error('database unavailable'));
    const emitter = new EventEmitter2();
    emitter.on('test.changed', async () => listenerGate);
    const scheduler = new ControlledIntervalScheduler();
    const dispatcher = new OutboxDispatcherService(repo, emitter, scheduler);

    const drain = dispatcher.drainOnce();
    await Promise.resolve();
    await Promise.resolve();
    scheduler.advance();
    await Promise.resolve();
    releaseListener?.();
    await drain;

    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.reschedule).toHaveBeenCalledWith('event-1', expect.any(String), {
      dead: false,
      delayMs: 1_000,
      error: 'Outbox lease renewal failed for event event-1: database unavailable',
    });
  });

  it('does not overlap drains in the same backend process', async () => {
    let releaseClaim: (() => void) | undefined;
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const repo: OutboxRepositoryPort = {
      claimBatch: mock(async () => {
        await claimGate;
        return [];
      }),
      renewLease: mock(async () => true),
      markCompleted: mock(async () => {}),
      reschedule: mock(async () => {}),
    };
    const dispatcher = new OutboxDispatcherService(repo, new EventEmitter2());

    const first = dispatcher.drainOnce();
    const second = dispatcher.drainOnce();
    releaseClaim?.();
    await Promise.all([first, second]);

    expect(repo.claimBatch).toHaveBeenCalledTimes(1);
  });

  it('performs one bounded drain when the application starts', async () => {
    const repo = repository([]);
    const dispatcher = new OutboxDispatcherService(repo, new EventEmitter2());

    dispatcher.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();
    dispatcher.onModuleDestroy();

    expect(repo.claimBatch).toHaveBeenCalledWith(expect.any(String), 50);
  });
});
