import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type {
  McpRuntimeAcquireRequest,
  McpRuntimeFence,
  McpRuntimeKey,
  McpRuntimeOwnerAddress,
} from '@sentris/shared';

import { McpRuntimeLeaseRepository } from '../mcp-runtime-lease.repository';
import { hashMcpRuntimeKey } from '../mcp-runtime-identity';
import {
  createRedisIntegrationFixture,
  type RedisIntegrationFixture,
} from './fixtures/redis-integration.fixture';

const REDIS_INTEGRATION_ENABLED = Boolean(process.env.MCP_RUNTIME_TEST_REDIS_URL);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

describe.skipIf(!REDIS_INTEGRATION_ENABLED)('McpRuntimeLeaseRepository (Redis 7.4)', () => {
  let fixture: RedisIntegrationFixture | undefined;

  beforeAll(async () => {
    fixture = await createRedisIntegrationFixture();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  afterAll(async () => {
    await fixture?.close();
  });

  test('atomically creates one reservation and returns that current ref to every racing caller', async () => {
    const repository = createRepository(requiredFixture(fixture));
    const key = runtimeKey();
    const firstOwner = candidateOwner('worker-a', 'http://127.0.0.1:9111');
    const secondOwner = candidateOwner('worker-b', 'http://127.0.0.1:9112');

    const outcomes = await Promise.all([
      repository.reserve(key, firstOwner),
      repository.reserve(key, firstOwner),
      repository.reserve(key, secondOwner),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'created')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'existing')).toHaveLength(2);
    const created = outcomes.find((outcome) => outcome.kind === 'created');
    expect(created).toBeDefined();
    if (!created) return;
    for (const outcome of outcomes) expect(outcome.ref).toEqual(created.ref);
    expect(created.ref).toMatchObject({
      state: 'starting',
      ownerAddress: null,
      protocolEra: null,
      protocolVersion: null,
      capabilityFingerprint: null,
    });
    expect([firstOwner.ownerId, secondOwner.ownerId]).toContain(created.ref.fence.ownerId);
    expect(await repository.read(key)).toEqual(created.ref);
  });

  test('preserves the complete runtime identity when Redis stores a large credential generation', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture);
    const key = runtimeKey({
      credentialReference: 'credential-a',
      credentialGeneration: 4_503_599_627_370_495,
    });
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9113');

    const reserved = await repository.reserve(key, owner);

    expect(reserved.kind).toBe('created');
    expect(await repository.read(key)).toEqual(reserved.ref);
    const ready = await repository.publishReady(
      key,
      reserved.ref.fence,
      publication(owner.ownerAddress),
    );
    expect(ready).not.toBeNull();
    const renewed = await repository.renew(key, reserved.ref.fence);
    expect(renewed).not.toBeNull();
    if (!renewed) throw new Error('Expected the large-generation lease to renew');
    expect(await repository.listOwned(owner.ownerId, owner.ownerEpoch)).toEqual([
      { runtimeKey: key, ref: renewed },
    ]);
    const draining = await repository.beginDrain(key, reserved.ref.fence);
    expect(draining).toMatchObject({ state: 'draining', fence: reserved.ref.fence });
    const leaseKey = await onlyKeyContaining(activeFixture, ':lease:');
    const encoded = await activeFixture.redis.get(leaseKey);
    expect(encoded).not.toBeNull();
    const stored = JSON.parse(encoded!);
    expect(stored.version).toBe(2);
    expect(JSON.parse(stored.runtimeKeyJson)).toEqual(key);
    expect(await repository.compareAndDelete(key, reserved.ref.fence)).toBe(true);
    expect(await repository.read(key)).toBeNull();
  });

  test('replaces a legacy starting lease whose credential generation was rounded by Redis cjson', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture);
    const credentialGeneration = 1_059_316_145_061_650;
    const key = runtimeKey({ credentialReference: 'credential-a', credentialGeneration });
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9114');
    const staleFence: McpRuntimeFence = {
      runtimeId: randomUUID(),
      ownerId: 'worker-before-restart',
      ownerEpoch: randomUUID(),
      leaseGeneration: 1,
    };
    const runtimeKeyHash = hashMcpRuntimeKey(key);
    const leaseKey = `${activeFixture.keyPrefix}:lease:{${runtimeKeyHash}}`;
    const generationKey = `${activeFixture.keyPrefix}:generation:{${runtimeKeyHash}}`;
    await activeFixture.redis.set(generationKey, '1');
    await activeFixture.redis.set(
      leaseKey,
      JSON.stringify({
        version: 1,
        runtimeKey: {
          ...key,
          credentialGeneration: 1_059_316_145_061_600,
        },
        retainedOwnerAddress: 'http://127.0.0.1:9110',
        ref: {
          fence: staleFence,
          state: 'starting',
          leaseExpiresAtMs: Date.now() + 5_000,
          protocolEra: null,
          protocolVersion: null,
          ownerAddress: null,
          capabilityFingerprint: null,
        },
      }),
      'PX',
      5_000,
    );

    const reserved = await repository.reserve(key, owner);

    expect(reserved).toMatchObject({
      kind: 'created',
      ref: { fence: { leaseGeneration: 2, ownerId: owner.ownerId } },
    });
    expect(reserved.ref.fence.runtimeId).not.toBe(staleFence.runtimeId);
    expect(await repository.read(key)).toEqual(reserved.ref);
  });

  test('continues to read valid v1 leases during the bounded storage migration', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture);
    const key = runtimeKey({ credentialReference: 'credential-a', credentialGeneration: 7 });
    const fence: McpRuntimeFence = {
      runtimeId: randomUUID(),
      ownerId: 'worker-v1',
      ownerEpoch: randomUUID(),
      leaseGeneration: 1,
    };
    const runtimeKeyHash = hashMcpRuntimeKey(key);
    await activeFixture.redis.set(
      `${activeFixture.keyPrefix}:lease:{${runtimeKeyHash}}`,
      JSON.stringify({
        version: 1,
        runtimeKey: key,
        retainedOwnerAddress: 'http://127.0.0.1:9115',
        ref: {
          fence,
          state: 'starting',
          leaseExpiresAtMs: Date.now() + 5_000,
          protocolEra: null,
          protocolVersion: null,
          ownerAddress: null,
          capabilityFingerprint: null,
        },
      }),
      'PX',
      5_000,
    );

    expect(await repository.read(key)).toMatchObject({ state: 'starting', fence });
  });

  test('compares every fence field before every post-reservation mutation', async () => {
    const repository = createRepository(requiredFixture(fixture));
    const key = runtimeKey();
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9121');
    const reserved = await repository.reserve(key, owner);

    for (const staleFence of staleFences(reserved.ref.fence)) {
      expect(
        await repository.publishReady(key, staleFence, publication(owner.ownerAddress)),
      ).toBeNull();
    }
    expect(await repository.read(key)).toEqual(reserved.ref);

    const ready = await repository.publishReady(
      key,
      reserved.ref.fence,
      publication(owner.ownerAddress),
    );
    expect(ready).not.toBeNull();
    if (!ready) return;
    for (const staleFence of staleFences(ready.fence)) {
      expect(await repository.renew(key, staleFence)).toBeNull();
      expect(await repository.beginDrain(key, staleFence)).toBeNull();
      expect(await repository.compareAndDelete(key, staleFence)).toBe(false);
    }
    expect(await repository.read(key)).toEqual(ready);
  });

  test('matches a live lease by canonical runtime-key hash only when every fence field is current', async () => {
    const repository = createRepository(requiredFixture(fixture));
    const key = runtimeKey();
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9122');
    const reserved = await repository.reserve(key, owner);
    const runtimeKeyHash = hashMcpRuntimeKey(key);

    expect(await repository.matchesFenceByHash(runtimeKeyHash, reserved.ref.fence)).toBe(true);
    for (const staleFence of staleFences(reserved.ref.fence)) {
      expect(await repository.matchesFenceByHash(runtimeKeyHash, staleFence)).toBe(false);
    }

    expect(await repository.compareAndDelete(key, reserved.ref.fence)).toBe(true);
    expect(await repository.matchesFenceByHash(runtimeKeyHash, reserved.ref.fence)).toBe(false);
  });

  test('fails closed when a hash lookup finds a lease that has lost its required expiry', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture);
    const key = runtimeKey();
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9123');
    const reserved = await repository.reserve(key, owner);
    const leaseKey = await onlyKeyContaining(activeFixture, ':lease:');
    expect(await activeFixture.redis.persist(leaseKey)).toBe(1);

    const [lookup] = await Promise.allSettled([
      repository.matchesFenceByHash(hashMcpRuntimeKey(key), reserved.ref.fence),
    ]);

    expect(lookup?.status).toBe('rejected');
  });

  test('exposes the retained direct owner address only through a matching ready publication', async () => {
    const repository = createRepository(requiredFixture(fixture));
    const key = runtimeKey();
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9131');
    const reserved = await repository.reserve(key, owner);

    expect(reserved.ref.ownerAddress).toBeNull();
    expect((await repository.read(key))?.ownerAddress).toBeNull();
    expect(
      (await repository.listOwned(owner.ownerId, owner.ownerEpoch))[0]?.ref.ownerAddress,
    ).toBeNull();
    const [mismatchedPublication] = await Promise.allSettled([
      repository.publishReady(key, reserved.ref.fence, publication('http://127.0.0.1:9132')),
    ]);
    expect(mismatchedPublication?.status).toBe('rejected');
    expect((await repository.read(key))?.state).toBe('starting');

    const ready = await repository.publishReady(
      key,
      reserved.ref.fence,
      publication(owner.ownerAddress),
    );
    expect(ready).toMatchObject({
      state: 'ready',
      ownerAddress: owner.ownerAddress,
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      capabilityFingerprint: HASH_D,
    });
    if (!ready) return;
    expect(
      await repository.publishReady(key, reserved.ref.fence, publication(owner.ownerAddress)),
    ).toEqual(ready);
    const loser = await repository.reserve(
      key,
      candidateOwner('worker-b', 'http://127.0.0.1:9133'),
    );
    expect(loser).toEqual({ kind: 'existing', ref: ready });
  });

  test('renews only live ready leases and cannot revive starting, draining, or expired leases', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture, { readyTtlMs: 240 });
    const key = runtimeKey();
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9141');
    const reserved = await repository.reserve(key, owner);

    expect(await repository.renew(key, reserved.ref.fence)).toBeNull();
    const ready = await repository.publishReady(
      key,
      reserved.ref.fence,
      publication(owner.ownerAddress),
    );
    expect(ready).not.toBeNull();
    if (!ready) return;
    await Bun.sleep(30);
    const renewed = await repository.renew(key, ready.fence);
    expect(renewed?.state).toBe('ready');
    expect(Date.parse(renewed?.leaseExpiresAt ?? '')).toBeGreaterThan(
      Date.parse(ready.leaseExpiresAt),
    );

    const draining = await repository.beginDrain(key, ready.fence);
    expect(draining?.state).toBe('draining');
    expect(await repository.beginDrain(key, ready.fence)).toEqual(draining);
    expect(await repository.renew(key, ready.fence)).toBeNull();
    expect(await repository.read(key)).toEqual(draining);

    const expiringKey = runtimeKey({ sourceId: 'expiring-source' });
    const expiring = await repository.reserve(expiringKey, owner);
    const expiringReady = await repository.publishReady(
      expiringKey,
      expiring.ref.fence,
      publication(owner.ownerAddress),
    );
    expect(expiringReady).not.toBeNull();
    if (!expiringReady) return;
    await waitUntil(async () => (await repository.read(expiringKey)) === null);
    expect(await repository.renew(expiringKey, expiringReady.fence)).toBeNull();
    expect(await repository.read(expiringKey)).toBeNull();
  });

  test('retains the generation tombstone across fenced deletion and expiry before higher-generation reacquisition', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture, { readyTtlMs: 120 });
    const key = runtimeKey();
    const firstOwner = candidateOwner('worker-a', 'http://127.0.0.1:9151');
    const first = await repository.reserve(key, firstOwner);
    expect(first.ref.fence.leaseGeneration).toBe(1);
    const generationKey = await onlyKeyContaining(activeFixture, ':generation:');

    expect(await repository.compareAndDelete(key, first.ref.fence)).toBe(true);
    expect(await repository.read(key)).toBeNull();
    expect(await activeFixture.redis.get(generationKey)).toBe('1');
    expect(await activeFixture.redis.pttl(generationKey)).toBe(-1);

    const secondOwner = candidateOwner('worker-b', 'http://127.0.0.1:9152');
    const second = await repository.reserve(key, secondOwner);
    expect(second).toMatchObject({ kind: 'created', ref: { fence: { leaseGeneration: 2 } } });
    const secondReady = await repository.publishReady(
      key,
      second.ref.fence,
      publication(secondOwner.ownerAddress),
    );
    expect(secondReady).not.toBeNull();
    await waitUntil(async () => (await repository.read(key)) === null);
    expect(await activeFixture.redis.get(generationKey)).toBe('2');
    expect(await activeFixture.redis.pttl(generationKey)).toBe(-1);

    const third = await repository.reserve(
      key,
      candidateOwner('worker-c', 'http://127.0.0.1:9153'),
    );
    expect(third).toMatchObject({ kind: 'created', ref: { fence: { leaseGeneration: 3 } } });
    expect(await activeFixture.redis.get(generationKey)).toBe('3');
  });

  test('isolates every complete runtime-key field including nullable tenant and credential identities', async () => {
    const repository = createRepository(requiredFixture(fixture));
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9161');
    const keys: McpRuntimeKey[] = [
      runtimeKey(),
      runtimeKey({ sourceId: 'other-source' }),
      runtimeKey({ transport: 'stdio' }),
      runtimeKey({ configFingerprint: HASH_B }),
      runtimeKey({ organizationId: 'null' }),
      runtimeKey({ principalPartitionHash: HASH_C }),
      runtimeKey({ credentialReference: 'null', credentialGeneration: 1 }),
      runtimeKey({ credentialReference: 'credential-a', credentialGeneration: 1 }),
      runtimeKey({ credentialReference: 'credential-a', credentialGeneration: 2 }),
    ];

    const reservations = await Promise.all(keys.map((key) => repository.reserve(key, owner)));
    expect(reservations.every((reservation) => reservation.kind === 'created')).toBe(true);
    expect(new Set(reservations.map((reservation) => reservation.ref.fence.runtimeId)).size).toBe(
      keys.length,
    );
    expect(reservations.every((reservation) => reservation.ref.fence.leaseGeneration === 1)).toBe(
      true,
    );
  });

  test('lists canonical keys for the exact owner epoch and cleans deletion, expiry, and replacement membership', async () => {
    const activeFixture = requiredFixture(fixture);
    const repository = createRepository(activeFixture, { startingTtlMs: 140 });
    const epochOne = randomUUID();
    const epochTwo = randomUUID();
    const firstOwner = candidateOwner('worker-a', 'http://127.0.0.1:9171', epochOne);
    const reincarnatedOwner = candidateOwner('worker-a', 'http://127.0.0.1:9172', epochTwo);
    const firstKey = runtimeKey({ sourceId: 'first-source' });
    const secondKey = runtimeKey({ sourceId: 'second-source' });
    const thirdKey = runtimeKey({ sourceId: 'third-source' });
    const first = await repository.reserve(firstKey, firstOwner);
    await repository.reserve(secondKey, firstOwner);
    await repository.reserve(thirdKey, reincarnatedOwner);

    expect(await repository.listOwned(firstOwner.ownerId, epochOne)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtimeKey: firstKey, ref: first.ref }),
        expect.objectContaining({ runtimeKey: secondKey }),
      ]),
    );
    expect(await repository.listOwned(firstOwner.ownerId, epochOne)).toHaveLength(2);
    expect(await repository.listOwned(firstOwner.ownerId, epochTwo)).toEqual([
      expect.objectContaining({ runtimeKey: thirdKey }),
    ]);

    expect(await repository.compareAndDelete(firstKey, first.ref.fence)).toBe(true);
    expect(
      (await repository.listOwned(firstOwner.ownerId, epochOne)).map((entry) => entry.runtimeKey),
    ).toEqual([secondKey]);
    await waitUntil(async () => (await repository.read(secondKey)) === null);
    expect(await repository.listOwned(firstOwner.ownerId, epochOne)).toEqual([]);

    const replacementOwner = candidateOwner('worker-b', 'http://127.0.0.1:9173');
    const replacement = await repository.reserve(secondKey, replacementOwner);
    expect(replacement.kind).toBe('created');
    expect(await repository.listOwned(firstOwner.ownerId, epochOne)).toEqual([]);
    expect(
      await repository.listOwned(replacementOwner.ownerId, replacementOwner.ownerEpoch),
    ).toEqual([{ runtimeKey: secondKey, ref: replacement.ref }]);
  });

  test('changes only the ephemeral fence on failover while preserving immutable authority and config identity', async () => {
    const repository = createRepository(requiredFixture(fixture));
    const key = Object.freeze(runtimeKey({ configFingerprint: HASH_B }));
    const immutableIdentity = Object.freeze({
      authorityId: randomUUID(),
      snapshotId: randomUUID(),
      configFingerprint: HASH_B,
      capabilityFingerprint: HASH_D,
    });
    const firstOwner = candidateOwner('worker-a', 'http://127.0.0.1:9181');
    const first = await repository.reserve(key, firstOwner);
    const firstReady = await repository.publishReady(
      key,
      first.ref.fence,
      publication(firstOwner.ownerAddress),
    );
    expect(firstReady).not.toBeNull();
    expect(await repository.compareAndDelete(key, first.ref.fence)).toBe(true);

    const secondOwner = candidateOwner('worker-b', 'http://127.0.0.1:9182');
    const second = await repository.reserve(key, secondOwner);
    const secondReady = await repository.publishReady(
      key,
      second.ref.fence,
      publication(secondOwner.ownerAddress),
    );
    expect(secondReady).not.toBeNull();
    if (!firstReady || !secondReady) return;
    expect(secondReady.fence).not.toEqual(firstReady.fence);
    expect(secondReady.fence.leaseGeneration).toBeGreaterThan(firstReady.fence.leaseGeneration);
    expect(secondReady.capabilityFingerprint).toBe(immutableIdentity.capabilityFingerprint);
    expect(
      (await repository.listOwned(secondOwner.ownerId, secondOwner.ownerEpoch))[0]?.runtimeKey,
    ).toEqual(key);
    expect(immutableIdentity).toEqual({
      authorityId: immutableIdentity.authorityId,
      snapshotId: immutableIdentity.snapshotId,
      configFingerprint: HASH_B,
      capabilityFingerprint: HASH_D,
    });
  });

  test('fails closed for unavailable Redis and schema-invalid stored lease data', async () => {
    const activeFixture = requiredFixture(fixture);
    const key = runtimeKey();
    const owner = candidateOwner('worker-a', 'http://127.0.0.1:9191');
    const repository = createRepository(activeFixture);
    const reserved = await repository.reserve(key, owner);
    const leaseKey = await onlyKeyContaining(activeFixture, ':lease:');
    await activeFixture.redis.set(leaseKey, '{}');
    const invalidStoredData = await Promise.allSettled([
      repository.read(key),
      repository.listOwned(owner.ownerId, owner.ownerEpoch),
    ]);
    expect(invalidStoredData.every((result) => result.status === 'rejected')).toBe(true);

    await activeFixture.cleanup();
    const unavailableRedis = await activeFixture.createUnavailableClient();
    const unavailableRepository = new McpRuntimeLeaseRepository(unavailableRedis, {
      keyPrefix: activeFixture.keyPrefix,
      startingTtlMs: 5_000,
      readyTtlMs: 5_000,
    });
    const operations = [
      () => unavailableRepository.reserve(key, owner),
      () => unavailableRepository.read(key),
      () => unavailableRepository.listOwned(owner.ownerId, owner.ownerEpoch),
      () =>
        unavailableRepository.publishReady(
          key,
          reserved.ref.fence,
          publication(owner.ownerAddress),
        ),
      () => unavailableRepository.renew(key, reserved.ref.fence),
      () => unavailableRepository.beginDrain(key, reserved.ref.fence),
      () => unavailableRepository.compareAndDelete(key, reserved.ref.fence),
    ];
    try {
      for (const operation of operations) {
        const [result] = await Promise.allSettled([operation()]);
        expect(result?.status).toBe('rejected');
      }
    } finally {
      unavailableRedis.disconnect();
    }
  });

  test('rejects commands during connection loss without replay and reconnects automatically', async () => {
    const activeFixture = requiredFixture(fixture);
    const connection = await activeFixture.createConnectionLossClient();
    const rejectedCommandKey = `${activeFixture.keyPrefix}:reconnect:rejected`;
    const recoveredCommandKey = `${activeFixture.keyPrefix}:reconnect:recovered`;

    try {
      connection.makeUnavailable();
      await waitUntil(async () => connection.redis.status !== 'ready');

      const [failedCommand] = await Promise.allSettled([
        connection.redis.set(rejectedCommandKey, 'must-not-replay'),
      ]);
      expect(failedCommand?.status).toBe('rejected');

      connection.restore();
      await waitUntil(async () => connection.redis.status === 'ready', 4_000);

      expect(await connection.redis.get(rejectedCommandKey)).toBeNull();
      expect(await connection.redis.set(recoveredCommandKey, 'after-reconnect')).toBe('OK');
      expect(await connection.redis.get(recoveredCommandKey)).toBe('after-reconnect');
    } finally {
      await connection.close();
    }
  });
});

function createRepository(
  fixture: RedisIntegrationFixture,
  overrides: { startingTtlMs?: number; readyTtlMs?: number } = {},
): McpRuntimeLeaseRepository {
  return new McpRuntimeLeaseRepository(fixture.redis, {
    keyPrefix: fixture.keyPrefix,
    startingTtlMs: overrides.startingTtlMs ?? 5_000,
    readyTtlMs: overrides.readyTtlMs ?? 5_000,
  });
}

function runtimeKey(overrides: Partial<McpRuntimeKey> = {}): McpRuntimeKey {
  return {
    sourceId: 'source-a',
    transport: 'http',
    configFingerprint: HASH_A,
    organizationId: null,
    principalPartitionHash: HASH_B,
    credentialReference: null,
    credentialGeneration: null,
    ...overrides,
  };
}

function candidateOwner(
  ownerId: string,
  ownerAddress: McpRuntimeOwnerAddress,
  ownerEpoch = randomUUID(),
): McpRuntimeAcquireRequest['candidateOwner'] {
  return { ownerId, ownerEpoch, ownerAddress };
}

function publication(ownerAddress: McpRuntimeOwnerAddress) {
  return {
    ownerAddress,
    protocolEra: 'modern' as const,
    protocolVersion: '2026-07-28',
    capabilityFingerprint: HASH_D,
  };
}

function staleFences(fence: McpRuntimeFence): McpRuntimeFence[] {
  return [
    { ...fence, runtimeId: randomUUID() },
    { ...fence, ownerId: `${fence.ownerId}-stale` },
    { ...fence, ownerEpoch: randomUUID() },
    { ...fence, leaseGeneration: fence.leaseGeneration + 1 },
  ];
}

function requiredFixture(fixture: RedisIntegrationFixture | undefined): RedisIntegrationFixture {
  if (!fixture) throw new Error('Redis integration fixture was not initialized');
  return fixture;
}

async function onlyKeyContaining(
  fixture: RedisIntegrationFixture,
  marker: string,
): Promise<string> {
  const matches = (await fixture.listKeys()).filter((key) => key.includes(marker));
  expect(matches).toHaveLength(1);
  if (matches.length !== 1) throw new Error(`Expected one Redis key containing ${marker}`);
  return matches[0]!;
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Redis condition');
    await Bun.sleep(20);
  }
}
