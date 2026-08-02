import { z } from 'zod';
import type Redis from 'ioredis';
import {
  McpProtocolEraSchema,
  McpRuntimeAcquireRequestSchema,
  McpRuntimeFenceSchema,
  McpRuntimeKeySchema,
  McpRuntimeOwnerAddressSchema,
  McpRuntimeRefSchema,
  type McpRuntimeAcquireRequest,
  type McpRuntimeFence,
  type McpRuntimeKey,
  type McpRuntimeRef,
} from '@sentris/shared';

import {
  canonicalizeMcpRuntimeKey,
  createMcpRuntimeId,
  hashMcpRuntimeKey,
  hashMcpRuntimeOwner,
  serializeMcpRuntimeKey,
} from './mcp-runtime-identity';
import { defineMcpRuntimeRedisCommands, type McpRuntimeRedisCommands } from './mcp-runtime-redis';

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_RESERVE_ATTEMPTS = 4;
const OwnerLookupSchema = z
  .object({
    ownerId: z.string().min(1),
    ownerEpoch: z.string().uuid(),
  })
  .strict();
const PublicationSchema = z
  .object({
    ownerAddress: McpRuntimeOwnerAddressSchema,
    protocolEra: McpProtocolEraSchema,
    protocolVersion: z.string().min(1),
    capabilityFingerprint: Sha256HexSchema,
  })
  .strict();
const StoredRefSchema = z.discriminatedUnion('state', [
  z
    .object({
      fence: McpRuntimeFenceSchema,
      state: z.literal('starting'),
      leaseExpiresAtMs: z.number().int().positive(),
      protocolEra: z.null(),
      protocolVersion: z.null(),
      ownerAddress: z.null(),
      capabilityFingerprint: z.null(),
    })
    .strict(),
  z
    .object({
      fence: McpRuntimeFenceSchema,
      state: z.literal('ready'),
      leaseExpiresAtMs: z.number().int().positive(),
      protocolEra: McpProtocolEraSchema,
      protocolVersion: z.string().min(1),
      ownerAddress: McpRuntimeOwnerAddressSchema,
      capabilityFingerprint: Sha256HexSchema,
    })
    .strict(),
  z
    .object({
      fence: McpRuntimeFenceSchema,
      state: z.literal('draining'),
      leaseExpiresAtMs: z.number().int().positive(),
      protocolEra: McpProtocolEraSchema,
      protocolVersion: z.string().min(1),
      ownerAddress: McpRuntimeOwnerAddressSchema,
      capabilityFingerprint: Sha256HexSchema,
    })
    .strict(),
]);
const StoredLeaseV1Schema = z
  .object({
    version: z.literal(1),
    runtimeKey: McpRuntimeKeySchema,
    retainedOwnerAddress: McpRuntimeOwnerAddressSchema,
    ref: StoredRefSchema,
  })
  .strict();
const StoredLeaseV2Schema = z
  .object({
    version: z.literal(2),
    runtimeKeyHash: Sha256HexSchema,
    runtimeKeyJson: z.string().min(2),
    retainedOwnerAddress: McpRuntimeOwnerAddressSchema,
    ref: StoredRefSchema,
  })
  .strict();
const StoredLeaseSchema = z.discriminatedUnion('version', [
  StoredLeaseV1Schema,
  StoredLeaseV2Schema,
]);

export type McpRuntimeReadyPublication = z.infer<typeof PublicationSchema>;
export type McpRuntimeReservation =
  | { kind: 'created'; ref: McpRuntimeRef }
  | { kind: 'existing'; ref: McpRuntimeRef };
export interface McpOwnedRuntimeLease {
  runtimeKey: McpRuntimeKey;
  ref: McpRuntimeRef;
}

interface DecodedMcpRuntimeLease extends McpOwnedRuntimeLease {
  storageVersion: 1 | 2;
  runtimeKeyHash: string;
}

export interface McpRuntimeLeaseRepositoryOptions {
  keyPrefix: string;
  startingTtlMs: number;
  readyTtlMs: number;
}

export class McpRuntimeLeaseRepository {
  private readonly commands: McpRuntimeRedisCommands;
  private readonly keyPrefix: string;
  private readonly startingTtlMs: number;
  private readonly readyTtlMs: number;

  constructor(
    private readonly redis: Redis,
    options: McpRuntimeLeaseRepositoryOptions,
  ) {
    const normalizedKeyPrefix = options.keyPrefix.replace(/:+$/, '');
    const hasRedisPatternSyntax = ['*', '?', '[', ']'].some((character) =>
      normalizedKeyPrefix.includes(character),
    );
    if (
      !normalizedKeyPrefix ||
      normalizedKeyPrefix.length > 256 ||
      /\s/.test(normalizedKeyPrefix) ||
      hasRedisPatternSyntax
    ) {
      throw new Error('MCP runtime Redis key prefix is invalid');
    }
    this.keyPrefix = normalizedKeyPrefix;
    this.startingTtlMs = positiveTtl(options.startingTtlMs, 'starting');
    this.readyTtlMs = positiveTtl(options.readyTtlMs, 'ready');
    this.commands = defineMcpRuntimeRedisCommands(redis);
  }

  async reserve(
    runtimeKeyInput: McpRuntimeKey,
    candidateOwnerInput: McpRuntimeAcquireRequest['candidateOwner'],
  ): Promise<McpRuntimeReservation> {
    const { runtimeKey, candidateOwner } = McpRuntimeAcquireRequestSchema.parse({
      runtimeKey: runtimeKeyInput,
      candidateOwner: candidateOwnerInput,
    });
    const hash = hashMcpRuntimeKey(runtimeKey);
    for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt += 1) {
      const raw = await this.commands.reserve(
        this.leaseKey(hash),
        this.generationKey(hash),
        this.ownerIndexKey(candidateOwner.ownerId, candidateOwner.ownerEpoch),
        hash,
        createMcpRuntimeId(),
        candidateOwner.ownerId,
        candidateOwner.ownerEpoch,
        candidateOwner.ownerAddress,
        JSON.stringify(runtimeKey),
        this.startingTtlMs,
      );
      const [status, encoded] = parseScriptTuple(raw);
      if ((status !== 0 && status !== 1) || encoded === undefined) {
        throw new Error('Redis returned an invalid MCP runtime reservation result');
      }
      const stored = decodeStoredLease(encoded);
      if (runtimeIdentityMatches(stored, runtimeKey, hash)) {
        return { kind: status === 1 ? 'created' : 'existing', ref: stored.ref };
      }
      if (!isPotentiallyRoundedV1StartingLease(stored, runtimeKey)) {
        assertRuntimeIdentity(stored, runtimeKey, hash);
      }
      const deleted = await this.commands.deleteExactLegacyStarting(
        this.leaseKey(hash),
        this.ownerIndexKey(stored.ref.fence.ownerId, stored.ref.fence.ownerEpoch),
        hash,
        encoded,
        JSON.stringify(runtimeKey),
      );
      if (deleted !== 0 && deleted !== 1) {
        throw new Error('Redis returned an invalid legacy MCP runtime cleanup result');
      }
    }
    throw new Error('MCP runtime reservation did not settle after legacy lease recovery');
  }

  async read(runtimeKeyInput: McpRuntimeKey): Promise<McpRuntimeRef | null> {
    const runtimeKey = canonicalizeMcpRuntimeKey(runtimeKeyInput);
    const hash = hashMcpRuntimeKey(runtimeKey);
    const encoded = await this.redis.get(this.leaseKey(hash));
    if (encoded === null) return null;
    const stored = decodeStoredLease(encoded);
    assertRuntimeIdentity(stored, runtimeKey, hash);
    return stored.ref;
  }

  async matchesFenceByHash(
    runtimeKeyHashInput: string,
    fenceInput: McpRuntimeFence,
  ): Promise<boolean> {
    const runtimeKeyHash = Sha256HexSchema.parse(runtimeKeyHashInput);
    const fence = McpRuntimeFenceSchema.parse(fenceInput);
    const leaseKey = this.leaseKey(runtimeKeyHash);
    const encoded = await this.redis.get(leaseKey);
    if (encoded === null) return false;
    const remainingTtlMs = await this.redis.pttl(leaseKey);
    if (remainingTtlMs === -2 || remainingTtlMs === 0) return false;
    if (!Number.isSafeInteger(remainingTtlMs) || remainingTtlMs < 0) {
      throw new Error('Stored MCP runtime lease is missing its required expiry');
    }

    const stored = decodeStoredLease(encoded);
    if (stored.runtimeKeyHash !== runtimeKeyHash) {
      throw new Error('Stored MCP runtime key does not match its lease key');
    }
    return completeFenceEquals(stored.ref.fence, fence);
  }

  async publishReady(
    runtimeKeyInput: McpRuntimeKey,
    fenceInput: McpRuntimeFence,
    publicationInput: McpRuntimeReadyPublication,
  ): Promise<McpRuntimeRef | null> {
    const runtimeKey = canonicalizeMcpRuntimeKey(runtimeKeyInput);
    const fence = McpRuntimeFenceSchema.parse(fenceInput);
    const publication = PublicationSchema.parse(publicationInput);
    const hash = hashMcpRuntimeKey(runtimeKey);
    const raw = await this.commands.publishReady(
      this.leaseKey(hash),
      this.ownerIndexKey(fence.ownerId, fence.ownerEpoch),
      hash,
      fence.runtimeId,
      fence.ownerId,
      fence.ownerEpoch,
      fence.leaseGeneration,
      publication.ownerAddress,
      publication.protocolEra,
      publication.protocolVersion,
      publication.capabilityFingerprint,
      this.readyTtlMs,
    );
    const [status, encoded] = parseScriptTuple(raw);
    if (status === 0) return null;
    if (status === -2) throw new Error('Ready publication owner address differs from reservation');
    if (status === -3) throw new Error('Ready publication conflicts with existing metadata');
    if (status !== 1 || encoded === undefined) {
      throw new Error('Redis returned an invalid MCP runtime ready-publication result');
    }
    return expectedState(encoded, runtimeKey, hash, 'ready');
  }

  async renew(
    runtimeKeyInput: McpRuntimeKey,
    fenceInput: McpRuntimeFence,
  ): Promise<McpRuntimeRef | null> {
    return this.mutateRef(runtimeKeyInput, fenceInput, 'ready', (hash, fence) =>
      this.commands.renew(
        this.leaseKey(hash),
        this.ownerIndexKey(fence.ownerId, fence.ownerEpoch),
        hash,
        fence.runtimeId,
        fence.ownerId,
        fence.ownerEpoch,
        fence.leaseGeneration,
        this.readyTtlMs,
      ),
    );
  }

  async beginDrain(
    runtimeKeyInput: McpRuntimeKey,
    fenceInput: McpRuntimeFence,
  ): Promise<McpRuntimeRef | null> {
    return this.mutateRef(runtimeKeyInput, fenceInput, 'draining', (hash, fence) =>
      this.commands.beginDrain(
        this.leaseKey(hash),
        this.ownerIndexKey(fence.ownerId, fence.ownerEpoch),
        hash,
        fence.runtimeId,
        fence.ownerId,
        fence.ownerEpoch,
        fence.leaseGeneration,
      ),
    );
  }

  async compareAndDelete(
    runtimeKeyInput: McpRuntimeKey,
    fenceInput: McpRuntimeFence,
  ): Promise<boolean> {
    const runtimeKey = canonicalizeMcpRuntimeKey(runtimeKeyInput);
    const fence = McpRuntimeFenceSchema.parse(fenceInput);
    const hash = hashMcpRuntimeKey(runtimeKey);
    const raw = await this.commands.compareAndDelete(
      this.leaseKey(hash),
      this.ownerIndexKey(fence.ownerId, fence.ownerEpoch),
      hash,
      fence.runtimeId,
      fence.ownerId,
      fence.ownerEpoch,
      fence.leaseGeneration,
    );
    if (raw === 0) return false;
    if (raw === 1) return true;
    throw new Error('Redis returned an invalid MCP runtime deletion result');
  }

  async listOwned(ownerIdInput: string, ownerEpochInput: string): Promise<McpOwnedRuntimeLease[]> {
    const { ownerId, ownerEpoch } = OwnerLookupSchema.parse({
      ownerId: ownerIdInput,
      ownerEpoch: ownerEpochInput,
    });
    const [seconds, microseconds] = await this.redis.time();
    const nowMs = Number(seconds) * 1_000 + Math.floor(Number(microseconds) / 1_000);
    if (!Number.isSafeInteger(nowMs)) throw new Error('Redis returned an invalid server time');
    const hashes = await this.redis.zrangebyscore(
      this.ownerIndexKey(ownerId, ownerEpoch),
      nowMs,
      '+inf',
    );
    if (hashes.length === 0) return [];
    const values = await this.redis.mget(...hashes.map((hash) => this.leaseKey(hash)));
    const owned: McpOwnedRuntimeLease[] = [];
    for (let index = 0; index < hashes.length; index += 1) {
      const encoded = values[index];
      if (encoded === null || encoded === undefined) continue;
      const stored = decodeStoredLease(encoded);
      const hash = hashes[index]!;
      if (stored.runtimeKeyHash !== hash) {
        throw new Error('Stored MCP runtime key does not match its owner index');
      }
      if (stored.ref.fence.ownerId !== ownerId || stored.ref.fence.ownerEpoch !== ownerEpoch) {
        continue;
      }
      if (Date.parse(stored.ref.leaseExpiresAt) <= nowMs) continue;
      owned.push({ runtimeKey: stored.runtimeKey, ref: stored.ref });
    }
    return owned.sort((left, right) =>
      serializeMcpRuntimeKey(left.runtimeKey).localeCompare(
        serializeMcpRuntimeKey(right.runtimeKey),
      ),
    );
  }

  private async mutateRef(
    runtimeKeyInput: McpRuntimeKey,
    fenceInput: McpRuntimeFence,
    state: 'ready' | 'draining',
    operation: (hash: string, fence: McpRuntimeFence) => Promise<unknown>,
  ): Promise<McpRuntimeRef | null> {
    const runtimeKey = canonicalizeMcpRuntimeKey(runtimeKeyInput);
    const fence = McpRuntimeFenceSchema.parse(fenceInput);
    const hash = hashMcpRuntimeKey(runtimeKey);
    const [status, encoded] = parseScriptTuple(await operation(hash, fence));
    if (status === 0) return null;
    if (status !== 1 || encoded === undefined) {
      throw new Error('Redis returned an invalid MCP runtime mutation result');
    }
    return expectedState(encoded, runtimeKey, hash, state);
  }

  private leaseKey(hash: string): string {
    return `${this.keyPrefix}:lease:{${hash}}`;
  }

  private generationKey(hash: string): string {
    return `${this.keyPrefix}:generation:{${hash}}`;
  }

  private ownerIndexKey(ownerId: string, ownerEpoch: string): string {
    return `${this.keyPrefix}:owner:${hashMcpRuntimeOwner(ownerId, ownerEpoch)}`;
  }
}

function decodeStoredLease(encoded: string): DecodedMcpRuntimeLease {
  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch (error: unknown) {
    throw new Error('Stored MCP runtime lease is not valid JSON', { cause: error });
  }
  const stored = StoredLeaseSchema.parse(raw);
  const { leaseExpiresAtMs, ...storedRef } = stored.ref;
  const ref = McpRuntimeRefSchema.parse({
    ...storedRef,
    leaseExpiresAt: new Date(leaseExpiresAtMs).toISOString(),
  });
  if (stored.version === 1) {
    return {
      storageVersion: 1,
      runtimeKey: stored.runtimeKey,
      runtimeKeyHash: hashMcpRuntimeKey(stored.runtimeKey),
      ref,
    };
  }

  let runtimeKeyRaw: unknown;
  try {
    runtimeKeyRaw = JSON.parse(stored.runtimeKeyJson);
  } catch (error: unknown) {
    throw new Error('Stored MCP runtime key is not valid JSON', { cause: error });
  }
  const runtimeKey = McpRuntimeKeySchema.parse(runtimeKeyRaw);
  const runtimeKeyHash = hashMcpRuntimeKey(runtimeKey);
  if (runtimeKeyHash !== stored.runtimeKeyHash) {
    throw new Error('Stored MCP runtime key does not match its declared hash');
  }
  return { storageVersion: 2, runtimeKey, runtimeKeyHash, ref };
}

function expectedState(
  encoded: string,
  runtimeKey: McpRuntimeKey,
  hash: string,
  state: 'ready' | 'draining',
): McpRuntimeRef {
  const stored = decodeStoredLease(encoded);
  assertRuntimeIdentity(stored, runtimeKey, hash);
  if (stored.ref.state !== state) {
    throw new Error(`Redis returned an MCP runtime lease in unexpected state ${stored.ref.state}`);
  }
  return stored.ref;
}

function assertRuntimeIdentity(
  stored: DecodedMcpRuntimeLease,
  expected: McpRuntimeKey,
  expectedHash: string,
): void {
  if (!runtimeIdentityMatches(stored, expected, expectedHash)) {
    throw new Error('Stored MCP runtime key does not match the requested lease identity');
  }
}

function runtimeIdentityMatches(
  stored: DecodedMcpRuntimeLease,
  expected: McpRuntimeKey,
  expectedHash: string,
): boolean {
  return (
    stored.runtimeKeyHash === expectedHash &&
    serializeMcpRuntimeKey(stored.runtimeKey) === serializeMcpRuntimeKey(expected)
  );
}

function isPotentiallyRoundedV1StartingLease(
  stored: DecodedMcpRuntimeLease,
  expected: McpRuntimeKey,
): boolean {
  // The v1 writer threw before runtime startup after producing this exact rounded shape.
  if (stored.storageVersion !== 1 || stored.ref.state !== 'starting') return false;
  const expectedGeneration = expected.credentialGeneration;
  const storedGeneration = stored.runtimeKey.credentialGeneration;
  if (
    expectedGeneration === null ||
    storedGeneration === null ||
    storedGeneration === expectedGeneration
  ) {
    return false;
  }
  return (
    serializeMcpRuntimeKey(stored.runtimeKey) ===
    serializeMcpRuntimeKey({ ...expected, credentialGeneration: storedGeneration })
  );
}

function completeFenceEquals(left: McpRuntimeFence, right: McpRuntimeFence): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.ownerId === right.ownerId &&
    left.ownerEpoch === right.ownerEpoch &&
    left.leaseGeneration === right.leaseGeneration
  );
}

function parseScriptTuple(raw: unknown): [number, string | undefined] {
  if (!Array.isArray(raw) || typeof raw[0] !== 'number') {
    throw new Error('Redis returned a malformed MCP runtime script result');
  }
  const encoded = raw[1];
  if (encoded !== undefined && typeof encoded !== 'string') {
    throw new Error('Redis returned a malformed MCP runtime lease payload');
  }
  return [raw[0], encoded];
}

function positiveTtl(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 24 * 60 * 60 * 1_000) {
    throw new Error(`MCP runtime ${label} TTL must be between 1ms and 24 hours`);
  }
  return value;
}
