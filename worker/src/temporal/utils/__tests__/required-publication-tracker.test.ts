import { describe, expect, it } from 'bun:test';

import {
  RequiredPublicationTracker,
  drainAllRequiredPublications,
} from '../required-publication-tracker';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('RequiredPublicationTracker', () => {
  it('keeps publication off the hot path and waits for it during the execution drain', async () => {
    const publication = deferred<undefined>();
    const tracker = new RequiredPublicationTracker();

    tracker.track(() => publication.promise);
    let drained = false;
    const drainPromise = tracker.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    publication.resolve(undefined);
    await drainPromise;

    expect(drained).toBe(true);
  });

  it('settles rejected publications without replacing the execution result', async () => {
    const publication = deferred<undefined>();
    const tracker = new RequiredPublicationTracker();

    tracker.track(() => publication.promise);
    const drainPromise = tracker.drain();
    publication.reject(new Error('Kafka unavailable'));

    await expect(drainPromise).resolves.toBeUndefined();
  });

  it('lets graceful shutdown wait for publications owned by active executions', async () => {
    const publication = deferred<undefined>();
    const tracker = new RequiredPublicationTracker();

    tracker.track(() => publication.promise);
    let shutdownDrained = false;
    const shutdownDrain = drainAllRequiredPublications().then(() => {
      shutdownDrained = true;
    });

    await Promise.resolve();
    expect(shutdownDrained).toBe(false);

    publication.resolve(undefined);
    await shutdownDrain;

    expect(shutdownDrained).toBe(true);
  });
});
