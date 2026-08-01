import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { McpRuntimeFence } from '@sentris/shared';

import {
  McpRuntimeDriverRegistry,
  type McpRuntimeDefinition,
  type McpRuntimeDriver,
  type McpRuntimeResource,
} from '../mcp-runtime-driver';
import * as reconciler from '../mcp-runtime-reconciler';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('MCP runtime resource reconciliation', () => {
  test('preserves a resource whose runtime-key hash and complete fence match a live lease', async () => {
    const currentFence = fence();
    const candidate = resource('live-container', HASH_A, currentFence);
    const { driver, reaped } = fakeDriver('docker-http', [candidate]);
    const authority = inMemoryAuthority([[HASH_A, currentFence]]);

    const report = await reconciler.reconcileMcpRuntimeResources({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: authority,
      maxResources: 20,
    });

    expect(reaped).toEqual([]);
    expect(report).toEqual({
      driversExamined: 1,
      inventoried: 1,
      examined: 1,
      preserved: 1,
      reaped: 0,
      remaining: 0,
      truncated: false,
      failures: [],
    });
  });

  test('reaps resources with a missing lease or a stale lease generation', async () => {
    const missing = resource('missing-container', HASH_A, fence(1));
    const stale = resource('stale-container', HASH_B, fence(1));
    const { driver, reaped } = fakeDriver('docker-http', [missing, stale]);
    const authority = inMemoryAuthority([[HASH_B, fence(2)]]);

    const report = await reconciler.reconcileMcpRuntimeResources({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: authority,
      maxResources: 20,
    });

    expect(reaped.map(({ resourceId }) => resourceId)).toEqual([
      'missing-container',
      'stale-container',
    ]);
    expect(report).toMatchObject({ examined: 2, preserved: 0, reaped: 2, failures: [] });
  });

  test('re-reads authority immediately before reap and preserves a lease won during that race', async () => {
    const currentFence = fence();
    const candidate = resource('racing-container', HASH_A, currentFence);
    const { driver, reaped } = fakeDriver('docker-http', [candidate]);
    let checks = 0;
    const leaseRepository = {
      async matchesFenceByHash(runtimeKeyHash: string, candidateFence: McpRuntimeFence) {
        checks += 1;
        return (
          checks === 2 &&
          runtimeKeyHash === HASH_A &&
          completeFenceEquals(candidateFence, currentFence)
        );
      },
    };

    const report = await reconciler.reconcileMcpRuntimeResources({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository,
      maxResources: 20,
    });

    expect(reaped).toEqual([]);
    expect(report).toMatchObject({ examined: 1, preserved: 1, reaped: 0, failures: [] });
  });

  test('fails closed without reaping when Redis cannot establish lease authority', async () => {
    const candidate = resource('uncertain-container', HASH_A, fence());
    const { driver, reaped } = fakeDriver('docker-http', [candidate]);
    const [outcome] = await Promise.allSettled([
      reconciler.reconcileMcpRuntimeResources({
        drivers: new McpRuntimeDriverRegistry([driver]),
        leaseRepository: {
          async matchesFenceByHash() {
            throw new Error('Redis unavailable');
          },
        },
        maxResources: 20,
      }),
    ]);

    expect(reaped).toEqual([]);
    expect(outcome?.status).toBe('rejected');
    if (outcome?.status !== 'rejected') return;
    expect(outcome.reason).toBeInstanceOf(reconciler.McpRuntimeReconciliationError);
    expect(outcome.reason.report).toMatchObject({
      reaped: 0,
      failures: [
        expect.objectContaining({
          phase: 'authority',
          resourceId: 'uncertain-container',
          message: 'Redis unavailable',
        }),
      ],
    });
  });

  test('isolates inventory and reap failures while reporting both after healthy drivers finish', async () => {
    const inventoryFailure = fakeDriver('remote-http', [], {
      inventoryError: new Error('inventory failed'),
    });
    const reapFailure = fakeDriver(
      'docker-stdio',
      [resource('unreapable-container', HASH_A, fence())],
      { reapError: new Error('daemon refused removal') },
    );
    const healthy = fakeDriver('docker-http', [resource('orphan-container', HASH_B, fence())]);
    const [outcome] = await Promise.allSettled([
      reconciler.reconcileMcpRuntimeResources({
        drivers: new McpRuntimeDriverRegistry([
          inventoryFailure.driver,
          reapFailure.driver,
          healthy.driver,
        ]),
        leaseRepository: inMemoryAuthority([]),
        maxResources: 20,
      }),
    ]);

    expect(healthy.reaped.map(({ resourceId }) => resourceId)).toEqual(['orphan-container']);
    expect(reapFailure.reaped).toEqual([]);
    expect(outcome?.status).toBe('rejected');
    if (outcome?.status !== 'rejected') return;
    expect(outcome.reason.report).toMatchObject({
      driversExamined: 3,
      inventoried: 2,
      examined: 2,
      reaped: 1,
      failures: expect.arrayContaining([
        expect.objectContaining({ phase: 'inventory', message: 'inventory failed' }),
        expect.objectContaining({
          phase: 'reap',
          resourceId: 'unreapable-container',
          message: 'daemon refused removal',
        }),
      ]),
    });
  });

  test('bounds each pass and reports inventory left for a later pass', async () => {
    const { driver, reaped } = fakeDriver('docker-http', [
      resource('container-1', HASH_A, fence()),
      resource('container-2', HASH_B, fence()),
      resource('container-3', HASH_C, fence()),
    ]);

    const report = await reconciler.reconcileMcpRuntimeResources({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: inMemoryAuthority([]),
      maxResources: 2,
    });

    expect(reaped.map(({ resourceId }) => resourceId)).toEqual(['container-1', 'container-2']);
    expect(report).toMatchObject({
      inventoried: 3,
      examined: 2,
      reaped: 2,
      remaining: 1,
      truncated: true,
    });
  });

  test('reaps a container left when its owner crashed before ready publication', async () => {
    const crashWindowResource = resource('starting-orphan', HASH_A, fence());
    const { driver, reaped } = fakeDriver('docker-http', [crashWindowResource]);

    const report = await reconciler.reconcileMcpRuntimeResources({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: inMemoryAuthority([]),
      maxResources: 20,
    });

    expect(reaped).toEqual([crashWindowResource]);
    expect(report).toMatchObject({ reaped: 1, preserved: 0, failures: [] });
  });
});

describe('periodic MCP runtime reconciliation', () => {
  test('coalesces overlapping passes and closes its single loop idempotently', async () => {
    let inventoryCalls = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver } = fakeDriver('docker-http', [], {
      inventory: async () => {
        inventoryCalls += 1;
        if (inventoryCalls === 2) await blocked;
        return [];
      },
    });
    const health: (string | undefined)[] = [];
    const handle = await reconciler.startMcpRuntimeReconciler({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: inMemoryAuthority([]),
      maxResources: 20,
      intervalMs: 60_000,
      onHealthChange: (message: string | undefined) => health.push(message),
    });

    const first = handle.runNow();
    const overlapping = handle.runNow();
    await Promise.resolve();

    expect(first).toBe(overlapping);
    expect(inventoryCalls).toBe(2);
    release?.();
    await first;
    await handle.close();
    await handle.close();
    await expect(handle.runNow()).rejects.toThrow('closed');
    expect(health).toEqual([undefined, undefined]);
  });

  test('reports reconciliation errors through health and clears the signal after recovery', async () => {
    let inventoryError: Error | undefined;
    const { driver } = fakeDriver('docker-http', [], {
      inventory: async () => {
        if (inventoryError) throw inventoryError;
        return [];
      },
    });
    const health: (string | undefined)[] = [];
    const handle = await reconciler.startMcpRuntimeReconciler({
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: inMemoryAuthority([]),
      maxResources: 20,
      intervalMs: 60_000,
      onHealthChange: (message: string | undefined) => health.push(message),
    });

    inventoryError = new Error('Docker inventory unavailable');
    await expect(handle.runNow()).rejects.toThrow('Docker inventory unavailable');
    inventoryError = undefined;
    await handle.runNow();
    await handle.close();

    expect(health).toEqual([
      undefined,
      expect.stringContaining('Docker inventory unavailable'),
      undefined,
    ]);
  });

  test('rejects reconciliation intervals outside the bounded operational range', async () => {
    const { driver } = fakeDriver('docker-http', []);
    const base = {
      drivers: new McpRuntimeDriverRegistry([driver]),
      leaseRepository: inMemoryAuthority([]),
      maxResources: 20,
    };

    await expect(reconciler.startMcpRuntimeReconciler({ ...base, intervalMs: 0 })).rejects.toThrow(
      'intervalMs',
    );
    await expect(
      reconciler.startMcpRuntimeReconciler({ ...base, intervalMs: 24 * 60 * 60 * 1_000 + 1 }),
    ).rejects.toThrow('intervalMs');
  });
});

function fence(leaseGeneration = 1): McpRuntimeFence {
  return {
    runtimeId: randomUUID(),
    ownerId: 'worker-a',
    ownerEpoch: randomUUID(),
    leaseGeneration,
  };
}

function resource(
  resourceId: string,
  runtimeKeyHash: string,
  candidateFence: McpRuntimeFence,
): McpRuntimeResource {
  return {
    kind: 'docker-container',
    resourceId,
    runtimeKeyHash,
    fence: candidateFence,
  };
}

function inMemoryAuthority(entries: readonly (readonly [string, McpRuntimeFence])[]) {
  const fences = new Map(entries);
  return {
    async matchesFenceByHash(runtimeKeyHash: string, candidateFence: McpRuntimeFence) {
      const current = fences.get(runtimeKeyHash);
      return current !== undefined && completeFenceEquals(current, candidateFence);
    },
  };
}

function completeFenceEquals(left: McpRuntimeFence, right: McpRuntimeFence): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.ownerId === right.ownerId &&
    left.ownerEpoch === right.ownerEpoch &&
    left.leaseGeneration === right.leaseGeneration
  );
}

function fakeDriver(
  kind: McpRuntimeDefinition['kind'],
  resources: McpRuntimeResource[],
  options: {
    inventory?: () => Promise<McpRuntimeResource[]>;
    inventoryError?: Error;
    reapError?: Error;
  } = {},
): { driver: McpRuntimeDriver; reaped: McpRuntimeResource[] } {
  const reaped: McpRuntimeResource[] = [];
  return {
    driver: {
      kinds: [kind],
      async start() {
        throw new Error('Runtime start is not used by reconciliation tests');
      },
      async inventory() {
        if (options.inventoryError) throw options.inventoryError;
        return options.inventory ? options.inventory() : resources;
      },
      async reap(candidate) {
        if (options.reapError) throw options.reapError;
        reaped.push(candidate);
      },
    },
    reaped,
  };
}
