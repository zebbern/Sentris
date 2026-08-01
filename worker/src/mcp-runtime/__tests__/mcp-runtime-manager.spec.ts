import { describe, expect, test } from 'bun:test';
import type {
  McpCatalog,
  McpRuntimeAcquireRequest,
  McpRuntimeFence,
  McpRuntimeKey,
  McpRuntimeRef,
} from '@sentris/shared';

import type { NormalizedMcpResult } from '../mcp-client-adapter';
import type { McpOperationContext } from '../mcp-client-adapter.types';
import type {
  McpRuntimeDefinition,
  McpRuntimeDriver,
  McpRuntimeDriverHandle,
} from '../mcp-runtime-driver';
import {
  McpRuntimeAmbiguousError,
  McpRuntimeFenceLostError,
  McpRuntimeManager,
  computeMcpCapabilityFingerprint,
  type McpRuntimeLeaseStore,
} from '../mcp-runtime-manager';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RUNTIME_ID = '10000000-0000-4000-8000-000000000001';
const OWNER_EPOCH = '20000000-0000-4000-8000-000000000002';
const HOLDER_A = '40000000-0000-4000-8000-000000000004';
const HOLDER_B = '50000000-0000-4000-8000-000000000005';
const OPERATION_CONTEXT: McpOperationContext = {
  signal: new AbortController().signal,
  idleTimeoutMs: 1_000,
  maxTotalTimeoutMs: 5_000,
};

const processIdentity: McpRuntimeAcquireRequest['candidateOwner'] = {
  ownerId: 'worker-0',
  ownerEpoch: OWNER_EPOCH,
  ownerAddress: 'http://worker-0.internal:9100',
};
const runtimeKey: McpRuntimeKey = {
  sourceId: 'source-1',
  transport: 'http',
  configFingerprint: HASH_A,
  organizationId: 'org-1',
  principalPartitionHash: HASH_B,
  credentialReference: 'credential-1',
  credentialGeneration: 3,
};
const fence: McpRuntimeFence = {
  runtimeId: RUNTIME_ID,
  ownerId: processIdentity.ownerId,
  ownerEpoch: processIdentity.ownerEpoch,
  leaseGeneration: 1,
};
const startingRef: McpRuntimeRef = {
  fence,
  state: 'starting',
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  protocolEra: null,
  protocolVersion: null,
  ownerAddress: null,
  capabilityFingerprint: null,
};

const definition: McpRuntimeDefinition = {
  kind: 'remote-http',
  sourceId: runtimeKey.sourceId,
  configFingerprint: runtimeKey.configFingerprint,
  bindingFingerprint: HASH_B,
  endpoint: 'https://mcp.example.test',
  headers: { Authorization: 'Bearer super-secret' },
};

describe('McpRuntimeManager', () => {
  test('single-flights acquire and reserves before resolving secrets or starting', async () => {
    const fixture = createFixture();

    const [first, second] = await Promise.all([
      fixture.manager.acquire(runtimeKey, processIdentity),
      fixture.manager.acquire(runtimeKey, processIdentity),
    ]);

    expect(first).toEqual(second);
    expect(first.state).toBe('ready');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fence)).toBe(true);
    expect(fixture.events).toEqual(['reserve', 'resolve', 'start', 'discover', 'publish']);
    expect(fixture.calls.reserve).toBe(1);
    expect(fixture.calls.resolve).toBe(1);
    expect(fixture.calls.start).toBe(1);
    expect(JSON.stringify(first)).not.toContain('super-secret');
    await fixture.manager.close();
  });

  test('cancels an abandoned single-flight startup and removes its reservation', async () => {
    const resolveStarted = deferred<undefined>();
    const resolvedDefinition = deferred<McpRuntimeDefinition>();
    const fixture = createFixture({
      resolveDefinition: async () => {
        resolveStarted.resolve(undefined);
        return resolvedDefinition.promise;
      },
    });
    const cancellation = new Error('Temporal activity cancelled');
    const controller = new AbortController();

    const acquisition = fixture.manager.acquire(runtimeKey, processIdentity, controller.signal);
    await resolveStarted.promise;
    controller.abort(cancellation);
    resolvedDefinition.resolve(definition);

    const outcome = await settled(acquisition);
    await fixture.manager.close();
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toBe(cancellation);
    expect(fixture.calls.delete).toBe(1);
    expect(fixture.calls.start).toBe(0);
  });

  test('keeps a shared startup alive while another acquire waiter remains', async () => {
    const resolveStarted = deferred<undefined>();
    const resolvedDefinition = deferred<McpRuntimeDefinition>();
    const fixture = createFixture({
      resolveDefinition: async () => {
        resolveStarted.resolve(undefined);
        return resolvedDefinition.promise;
      },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = fixture.manager.acquire(runtimeKey, processIdentity, firstController.signal);
    const second = fixture.manager.acquire(runtimeKey, processIdentity, secondController.signal);
    await resolveStarted.promise;

    const cancellation = new Error('first caller cancelled');
    firstController.abort(cancellation);
    resolvedDefinition.resolve(definition);

    const [firstOutcome, secondOutcome] = await Promise.all([settled(first), settled(second)]);
    expect(firstOutcome.status).toBe('rejected');
    expect(firstOutcome.reason).toBe(cancellation);
    expect(secondOutcome).toMatchObject({ status: 'fulfilled', value: { state: 'ready', fence } });
    expect(fixture.calls.reserve).toBe(1);
    expect(fixture.calls.start).toBe(1);
    await fixture.manager.close();
  });

  test('rejects a candidate that is not this process identity before reservation', async () => {
    const fixture = createFixture();

    await expect(
      fixture.manager.acquire(runtimeKey, {
        ...processIdentity,
        ownerId: 'worker-other',
      }),
    ).rejects.toThrow('candidate owner does not match');
    expect(fixture.calls.reserve).toBe(0);
    await fixture.manager.close();
  });

  test('observes an existing starting generation without resolving or starting another', async () => {
    const fixture = createFixture({ reservationKind: 'existing' });
    const ready = fixture.readyRef();
    fixture.readResults.push(startingRef, ready);

    await expect(fixture.manager.acquire(runtimeKey, processIdentity)).resolves.toEqual(ready);

    expect(fixture.calls.resolve).toBe(0);
    expect(fixture.calls.start).toBe(0);
    await fixture.manager.close();
  });

  test('cleans up the handle and resource before deleting a failed startup lease', async () => {
    const fixture = createFixture({ discoverError: new Error('discovery failed') });

    await expect(fixture.manager.acquire(runtimeKey, processIdentity)).rejects.toThrow(
      'discovery failed',
    );

    expect(fixture.events.slice(-3)).toEqual(['close', 'reap', 'delete']);
    expect(fixture.calls.publish).toBe(0);
    await fixture.manager.close();
  });

  test('rejects resolved definitions with mismatched source, config, or transport identity', async () => {
    const cases: { definition: McpRuntimeDefinition; key: McpRuntimeKey; message: string }[] = [
      {
        definition: { ...definition, sourceId: 'source-other' },
        key: runtimeKey,
        message: 'source',
      },
      {
        definition: { ...definition, configFingerprint: HASH_B },
        key: runtimeKey,
        message: 'config fingerprint',
      },
      {
        definition,
        key: { ...runtimeKey, transport: 'stdio' },
        message: 'transport',
      },
    ];

    for (const testCase of cases) {
      const fixture = createFixture({ definition: testCase.definition });
      const outcome = await settled(fixture.manager.acquire(testCase.key, processIdentity));
      expect(outcome.status).toBe('rejected');
      expect(String(outcome.reason)).toContain(testCase.message);
      expect(fixture.calls.start).toBe(0);
      expect(fixture.calls.delete).toBe(1);
      await fixture.manager.close();
    }
  });

  test('uses a stable complete catalog fingerprint and rejects an expected mismatch', async () => {
    const catalogA = catalogWithOrdering(false);
    const catalogB = catalogWithOrdering(true);
    expect(computeMcpCapabilityFingerprint(catalogA)).toBe(
      computeMcpCapabilityFingerprint(catalogB),
    );

    const fixture = createFixture({
      definition: { ...definition, expectedCapabilityFingerprint: HASH_A },
      discovery: catalogA,
    });
    await expect(fixture.manager.acquire(runtimeKey, processIdentity)).rejects.toThrow(
      'capability fingerprint',
    );
    expect(fixture.calls.publish).toBe(0);
    expect(fixture.events.slice(-3)).toEqual(['close', 'reap', 'delete']);
    await fixture.manager.close();
  });

  test('checks the live full fence before every cached catalog or transport dispatch', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    const readsBefore = fixture.calls.read;

    await fixture.manager.discover(ref.fence, HOLDER_A);
    await fixture.manager.invoke(ref.fence, HOLDER_A, 'alpha', { value: 1 }, OPERATION_CONTEXT);
    await fixture.manager.read(ref.fence, HOLDER_A, 'file:///one', OPERATION_CONTEXT);
    await fixture.manager.getPrompt(ref.fence, HOLDER_A, 'prompt-one', {}, OPERATION_CONTEXT);
    const health = await fixture.manager.health(ref.fence, HOLDER_A);

    expect(fixture.calls.read - readsBefore).toBe(5);
    expect(health).toMatchObject({ fence: ref.fence, state: 'ready', status: 'healthy' });
    expect(fixture.calls.invoke).toBe(1);
    expect(fixture.calls.readResource).toBe(1);
    expect(fixture.calls.getPrompt).toBe(1);
    expect(fixture.manager.metrics.snapshot().operations['invoke:success']).toBe(1);

    fixture.leaseRef = {
      ...ref,
      fence: { ...ref.fence, leaseGeneration: ref.fence.leaseGeneration + 1 },
    };
    await expect(
      fixture.manager.invoke(ref.fence, HOLDER_A, 'alpha', {}, OPERATION_CONTEXT),
    ).rejects.toBeInstanceOf(McpRuntimeFenceLostError);
    expect(fixture.calls.invoke).toBe(1);
    await fixture.manager.close();
  });

  test('self-fences on renewal loss and classifies a crossed dispatch as ambiguous', async () => {
    const dispatched = deferred<undefined>();
    const fixture = createFixture({
      callTool: async (_name, _args, context) => {
        dispatched.resolve(undefined);
        await abortPromise(context.signal);
        return {};
      },
    });
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    const invocation = fixture.manager.invoke(ref.fence, HOLDER_A, 'alpha', {}, OPERATION_CONTEXT);
    await dispatched.promise;
    fixture.renewResult = null;

    const [renewal, invocationResult] = await Promise.all([
      settled(fixture.manager.renew(ref.fence, HOLDER_A)),
      settled(invocation),
    ]);
    expect(renewal.status).toBe('rejected');
    expect(renewal.reason).toBeInstanceOf(McpRuntimeFenceLostError);
    expect(invocationResult.status).toBe('rejected');
    expect(invocationResult.reason).toBeInstanceOf(McpRuntimeAmbiguousError);
    await expect(fixture.manager.discover(ref.fence, HOLDER_A)).rejects.toBeInstanceOf(
      McpRuntimeFenceLostError,
    );
    await fixture.manager.close();
  });

  test('reports self-fenced ownership as not ready after renewal loss', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    fixture.renewResult = null;

    await expect(fixture.manager.renew(ref.fence, HOLDER_A)).rejects.toBeInstanceOf(
      McpRuntimeFenceLostError,
    );
    expect(() => fixture.manager.checkReadiness()).toThrow('self-fenced');
    await fixture.manager.close();
  });

  test('releases idempotently, refuses released holders, and closes before deletion', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    const releases = [
      fixture.manager.release(ref.fence, HOLDER_A),
      fixture.manager.release(ref.fence, HOLDER_A),
    ];
    await expect(
      fixture.manager.invoke(ref.fence, HOLDER_A, 'alpha', {}, OPERATION_CONTEXT),
    ).rejects.toThrow('not active');
    await Promise.all(releases);
    await fixture.manager.release(ref.fence, HOLDER_A);

    expect(fixture.calls.beginDrain).toBe(1);
    expect(fixture.calls.close).toBe(1);
    expect(fixture.calls.reap).toBe(1);
    expect(fixture.calls.delete).toBe(1);
    expect(fixture.events.slice(-4)).toEqual(['drain', 'close', 'reap', 'delete']);
    await fixture.manager.close();
  });

  test('keeps a shared runtime active until every fenced holder releases', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    fixture.manager.retain(ref.fence, HOLDER_B);

    await fixture.manager.release(ref.fence, HOLDER_A);
    await fixture.manager.release(ref.fence, HOLDER_A);

    expect(fixture.calls.beginDrain).toBe(0);
    await expect(fixture.manager.discover(ref.fence, HOLDER_B)).resolves.toMatchObject({
      protocolEra: 'modern',
    });

    await fixture.manager.release(ref.fence, HOLDER_B);

    expect(fixture.calls.beginDrain).toBe(1);
    expect(fixture.calls.close).toBe(1);
    expect(fixture.calls.delete).toBe(1);
    await fixture.manager.close();
  });

  test('expires an abandoned holder and drains its runtime', async () => {
    let nowMs = 1_000;
    const fixture = createFixture({
      holderIdleTimeoutMs: 30,
      renewalIntervalMs: 5,
      now: () => nowMs,
    });
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);

    nowMs += 31;
    await waitForCondition(() => fixture.calls.delete === 1);

    expect(fixture.calls.beginDrain).toBe(1);
    expect(fixture.calls.close).toBe(1);
    expect(fixture.calls.reap).toBe(1);
    await fixture.manager.close();
  });

  test('gives a newly ready runtime one holder timeout to complete retain', async () => {
    let nowMs = 1_500;
    const fixture = createFixture({
      holderIdleTimeoutMs: 30,
      renewalIntervalMs: 5,
      now: () => nowMs,
    });
    await fixture.manager.acquire(runtimeKey, processIdentity);

    nowMs += 29;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(fixture.calls.beginDrain).toBe(0);

    nowMs += 2;
    await waitForCondition(() => fixture.calls.delete === 1);
    expect(fixture.calls.beginDrain).toBe(1);
    await fixture.manager.close();
  });

  test('expires one holder without draining a runtime touched by another holder', async () => {
    let nowMs = 1_750;
    const fixture = createFixture({
      holderIdleTimeoutMs: 30,
      renewalIntervalMs: 5,
      now: () => nowMs,
    });
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    fixture.manager.retain(ref.fence, HOLDER_B);

    nowMs += 20;
    fixture.manager.touch(ref.fence, HOLDER_B);
    nowMs += 11;
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(fixture.calls.beginDrain).toBe(0);
    expect(() => fixture.manager.retain(ref.fence, HOLDER_A)).toThrow('already been released');
    await expect(fixture.manager.discover(ref.fence, HOLDER_B)).resolves.toMatchObject({
      protocolEra: 'modern',
    });
    await fixture.manager.release(ref.fence, HOLDER_B);
    expect(fixture.calls.beginDrain).toBe(1);
    await fixture.manager.close();
  });

  test('keeps an in-flight holder alive until its operation settles', async () => {
    let nowMs = 2_000;
    const operationStarted = deferred<undefined>();
    const finishOperation = deferred<NormalizedMcpResult>();
    const fixture = createFixture({
      holderIdleTimeoutMs: 30,
      renewalIntervalMs: 5,
      now: () => nowMs,
      callTool: async () => {
        operationStarted.resolve(undefined);
        return finishOperation.promise;
      },
    });
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    const invocation = fixture.manager.invoke(ref.fence, HOLDER_A, 'alpha', {}, OPERATION_CONTEXT);
    await operationStarted.promise;

    nowMs += 31;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.calls.beginDrain).toBe(0);

    finishOperation.resolve({});
    await invocation;
    await waitForCondition(() => fixture.calls.delete === 1);
    expect(fixture.calls.beginDrain).toBe(1);
    await fixture.manager.close();
  });

  test('records release intent before retain so a delayed retain cannot leak a holder', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);

    await fixture.manager.release(ref.fence, HOLDER_A);

    expect(() => fixture.manager.retain(ref.fence, HOLDER_A)).toThrow('already been released');
    expect(fixture.calls.beginDrain).toBe(0);
    await fixture.manager.close();
  });

  test('touches holder liveness without writing the shared Redis lease', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);

    const touched = (
      fixture.manager as McpRuntimeManager & {
        touch(fence: McpRuntimeFence, holderId: string): McpRuntimeRef;
      }
    ).touch(ref.fence, HOLDER_A);

    expect(touched).toMatchObject({ state: 'ready', fence: ref.fence });
    expect(fixture.calls.renew).toBe(0);
    await fixture.manager.release(ref.fence, HOLDER_A);
    await fixture.manager.close();
  });

  test('does not revive an expired holder before the maintenance sweep', async () => {
    let nowMs = 2_500;
    const fixture = createFixture({
      holderIdleTimeoutMs: 30,
      renewalIntervalMs: 60_000,
      now: () => nowMs,
    });
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);

    nowMs += 31;

    expect(() => fixture.manager.touch(ref.fence, HOLDER_A)).toThrow('holder has expired');
    await waitForCondition(() => fixture.calls.delete === 1);
    expect(fixture.calls.beginDrain).toBe(1);
    await fixture.manager.close();
  });

  test('uses one drain deadline capped by the remaining fenced lease', async () => {
    const dispatched = deferred<undefined>();
    const fixture = createFixture({
      leaseDurationMs: 25,
      drainTimeoutMs: 100,
      callTool: async () => {
        dispatched.resolve(undefined);
        await new Promise<void>(() => undefined);
        return {};
      },
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    });
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);
    void fixture.manager.invoke(ref.fence, HOLDER_A, 'alpha', {}, OPERATION_CONTEXT);
    await dispatched.promise;

    const startedAt = performance.now();
    const outcome = await settled(fixture.manager.release(ref.fence, HOLDER_A));
    const elapsedMs = performance.now() - startedAt;

    expect(outcome.status).toBe('rejected');
    expect(String(outcome.reason)).toContain('drain deadline');
    expect(elapsedMs).toBeLessThan(150);
    expect(fixture.calls.beginDrain).toBe(1);
    expect(fixture.calls.delete).toBe(1);
    await fixture.manager.close();
  });

  test('rejects release on a process that never completed that full fence', async () => {
    const fixture = createFixture();
    const unknownFence = {
      ...fence,
      runtimeId: '30000000-0000-4000-8000-000000000003',
    };

    await expect(fixture.manager.release(unknownFence, HOLDER_A)).rejects.toBeInstanceOf(
      McpRuntimeFenceLostError,
    );
    expect(fixture.calls.delete).toBe(0);
    await fixture.manager.close();
  });

  test('beginShutdown synchronously refuses acquire and new work while close drains owned runtimes', async () => {
    const fixture = createFixture();
    const ref = await fixture.manager.acquire(runtimeKey, processIdentity);
    fixture.manager.retain(ref.fence, HOLDER_A);

    fixture.manager.beginShutdown();
    await expect(fixture.manager.acquire(runtimeKey, processIdentity)).rejects.toThrow(
      'shutting down',
    );
    await expect(fixture.manager.discover(ref.fence, HOLDER_A)).rejects.toThrow('shutting down');
    await fixture.manager.close();

    expect(fixture.calls.close).toBe(1);
    expect(fixture.calls.delete).toBe(1);
  });
});

interface FixtureOptions {
  reservationKind?: 'created' | 'existing';
  definition?: McpRuntimeDefinition;
  discovery?: Omit<McpCatalog, 'capabilityFingerprint'>;
  discoverError?: Error;
  callTool?: (
    name: string,
    args: Record<string, unknown>,
    context: McpOperationContext,
  ) => Promise<NormalizedMcpResult>;
  resolveDefinition?: (signal: AbortSignal) => Promise<McpRuntimeDefinition>;
  close?: () => Promise<void>;
  drainTimeoutMs?: number;
  leaseDurationMs?: number;
  holderIdleTimeoutMs?: number;
  renewalIntervalMs?: number;
  now?: () => number;
}

function createFixture(options: FixtureOptions = {}) {
  const events: string[] = [];
  const calls = {
    reserve: 0,
    read: 0,
    publish: 0,
    renew: 0,
    beginDrain: 0,
    delete: 0,
    resolve: 0,
    start: 0,
    discover: 0,
    invoke: 0,
    readResource: 0,
    getPrompt: 0,
    close: 0,
    reap: 0,
  };
  const readResults: (McpRuntimeRef | null)[] = [];
  let leaseRef: McpRuntimeRef | null = startingRef;
  let renewResult: McpRuntimeRef | null | undefined;

  const readyRef = (): McpRuntimeRef => ({
    fence,
    state: 'ready',
    leaseExpiresAt: new Date(Date.now() + (options.leaseDurationMs ?? 60_000)).toISOString(),
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    ownerAddress: processIdentity.ownerAddress,
    capabilityFingerprint:
      leaseRef?.state === 'ready' ? leaseRef.capabilityFingerprint : 'c'.repeat(64),
  });

  const repository: McpRuntimeLeaseStore = {
    reserve: async () => {
      calls.reserve += 1;
      events.push('reserve');
      return { kind: options.reservationKind ?? 'created', ref: startingRef };
    },
    read: async () => {
      calls.read += 1;
      if (readResults.length > 0) return readResults.shift() ?? null;
      return leaseRef;
    },
    publishReady: async (_key, _fence, publication) => {
      calls.publish += 1;
      events.push('publish');
      leaseRef = {
        fence,
        state: 'ready',
        leaseExpiresAt: new Date(Date.now() + (options.leaseDurationMs ?? 60_000)).toISOString(),
        ownerAddress: processIdentity.ownerAddress,
        protocolEra: publication.protocolEra,
        protocolVersion: publication.protocolVersion,
        capabilityFingerprint: publication.capabilityFingerprint,
      };
      return leaseRef;
    },
    renew: async () => {
      calls.renew += 1;
      return renewResult === undefined ? leaseRef : renewResult;
    },
    beginDrain: async () => {
      calls.beginDrain += 1;
      events.push('drain');
      if (!leaseRef || leaseRef.state === 'starting') return null;
      leaseRef = { ...leaseRef, state: 'draining' };
      return leaseRef;
    },
    compareAndDelete: async () => {
      calls.delete += 1;
      events.push('delete');
      leaseRef = null;
      return true;
    },
  };

  const discovery = options.discovery ?? catalogWithOrdering(false);
  const adapter = {
    discover: async () => {
      calls.discover += 1;
      events.push('discover');
      if (options.discoverError) throw options.discoverError;
      const { protocolEra: _era, protocolVersion: _version, ...result } = discovery;
      return {
        metadata: {
          protocolEra: discovery.protocolEra,
          protocolVersion: discovery.protocolVersion,
        },
        ...result,
      };
    },
    callTool: async (
      tool: { canonicalName: string },
      args: Record<string, unknown>,
      context: McpOperationContext,
    ) => {
      calls.invoke += 1;
      return options.callTool?.(tool.canonicalName, args, context) ?? {};
    },
    readResource: async () => {
      calls.readResource += 1;
      return {};
    },
    getPrompt: async () => {
      calls.getPrompt += 1;
      return {};
    },
  };
  const handle: McpRuntimeDriverHandle = {
    adapter: adapter as unknown as McpRuntimeDriverHandle['adapter'],
    resource: {
      kind: 'docker-container',
      resourceId: 'container-one',
      runtimeKeyHash: HASH_A,
      fence,
    },
    health: async () => 'healthy',
    close: async () => {
      calls.close += 1;
      events.push('close');
      await options.close?.();
    },
  };
  const driver: McpRuntimeDriver = {
    kinds: ['remote-http'],
    start: async () => {
      calls.start += 1;
      events.push('start');
      return handle;
    },
    inventory: async () => [],
    reap: async () => {
      calls.reap += 1;
      events.push('reap');
    },
  };

  const manager = new McpRuntimeManager({
    processIdentity,
    repository,
    definitionResolver: {
      resolve: async (_runtimeKey, signal) => {
        calls.resolve += 1;
        events.push('resolve');
        if (options.resolveDefinition) return options.resolveDefinition(signal);
        return options.definition ?? definition;
      },
    },
    drivers: { resolve: () => driver },
    connectTimeoutMs: 1_000,
    discoveryIdleTimeoutMs: 1_000,
    discoveryTotalTimeoutMs: 5_000,
    startingObserveTimeoutMs: 200,
    startingPollIntervalMs: 1,
    renewalIntervalMs: options.renewalIntervalMs ?? 60_000,
    drainTimeoutMs: options.drainTimeoutMs ?? 100,
    now: options.now,
    holderIdleTimeoutMs: options.holderIdleTimeoutMs ?? 60_000,
  });

  return {
    manager,
    events,
    calls,
    readResults,
    readyRef,
    get leaseRef() {
      return leaseRef;
    },
    set leaseRef(value: McpRuntimeRef | null) {
      leaseRef = value;
    },
    set renewResult(value: McpRuntimeRef | null | undefined) {
      renewResult = value;
    },
  };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for MCP runtime test condition');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function catalogWithOrdering(reverse: boolean): Omit<McpCatalog, 'capabilityFingerprint'> {
  const tools = [
    {
      canonicalName: 'alpha',
      displayName: 'Alpha',
      inputSchema: { type: 'object' },
      source: {
        kind: 'mcp' as const,
        sourceId: runtimeKey.sourceId,
        upstreamName: 'alpha',
        bindingFingerprint: HASH_B,
      },
      effects: 'unknown' as const,
      effectsSource: 'unknown' as const,
      retryPolicy: 'pre-dispatch-only' as const,
    },
    {
      canonicalName: 'beta',
      displayName: 'Beta',
      inputSchema: { type: 'object' },
      source: {
        kind: 'mcp' as const,
        sourceId: runtimeKey.sourceId,
        upstreamName: 'beta',
        bindingFingerprint: HASH_B,
      },
      effects: 'read-only' as const,
      effectsSource: 'mcp-annotation' as const,
      retryPolicy: 'pre-dispatch-only' as const,
    },
  ];
  return {
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    tools: reverse ? [...tools].reverse() : tools,
    resources: reverse
      ? [{ sourceId: runtimeKey.sourceId, uri: 'file:///b', name: 'b' }]
      : [{ name: 'b', uri: 'file:///b', sourceId: runtimeKey.sourceId }],
    resourceTemplates: [],
    prompts: [{ sourceId: runtimeKey.sourceId, name: 'prompt-one', arguments: [] }],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function settled<T>(promise: Promise<T>) {
  try {
    return { status: 'fulfilled' as const, value: await promise, reason: undefined };
  } catch (reason: unknown) {
    return { status: 'rejected' as const, value: undefined, reason };
  }
}
