import { createHash } from 'node:crypto';
import {
  McpCatalogSchema,
  McpResolvedRuntimeDefinitionSchema,
  McpRuntimeAcquireRequestSchema,
  McpRuntimeFenceSchema,
  McpRuntimeHealthSchema,
  McpRuntimeHolderIdSchema,
  McpRuntimeRefSchema,
  type McpCatalog,
  type McpRuntimeAcquireRequest,
  type McpRuntimeFence,
  type McpRuntimeHealth,
  type McpRuntimeHolderId,
  type McpRuntimeKey,
  type McpRuntimeRef,
} from '@sentris/shared';

import type { NormalizedMcpResult } from './mcp-client-adapter';
import type { McpOperationContext } from './mcp-client-adapter.types';
import type {
  McpRuntimeDefinition,
  McpRuntimeDefinitionResolver,
  McpRuntimeDriver,
  McpRuntimeDriverRegistry,
} from './mcp-runtime-driver';
import { serializeMcpRuntimeKey } from './mcp-runtime-identity';
import type {
  McpRuntimeReadyPublication,
  McpRuntimeReservation,
} from './mcp-runtime-lease.repository';
import { McpRuntimeMetrics, type McpRuntimeOperationKind } from './mcp-runtime-metrics';
import {
  sameMcpRuntimeFence,
  type McpReadyRuntimeRef,
  type McpRuntimeHolderLease,
  type McpRuntimeRecord,
} from './mcp-runtime-record';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const COMPLETED_RELEASE_TOMBSTONE_TTL_MS = 5 * 60 * 1_000;
const MAX_COMPLETED_RELEASE_TOMBSTONES = 4_096;

export interface McpRuntimeLeaseStore {
  reserve(
    runtimeKey: McpRuntimeKey,
    candidateOwner: McpRuntimeAcquireRequest['candidateOwner'],
  ): Promise<McpRuntimeReservation>;
  read(runtimeKey: McpRuntimeKey): Promise<McpRuntimeRef | null>;
  publishReady(
    runtimeKey: McpRuntimeKey,
    fence: McpRuntimeFence,
    publication: McpRuntimeReadyPublication,
  ): Promise<McpRuntimeRef | null>;
  renew(runtimeKey: McpRuntimeKey, fence: McpRuntimeFence): Promise<McpRuntimeRef | null>;
  beginDrain(runtimeKey: McpRuntimeKey, fence: McpRuntimeFence): Promise<McpRuntimeRef | null>;
  compareAndDelete(runtimeKey: McpRuntimeKey, fence: McpRuntimeFence): Promise<boolean>;
}

export interface McpRuntimeManagerOptions {
  processIdentity: McpRuntimeAcquireRequest['candidateOwner'];
  repository: McpRuntimeLeaseStore;
  definitionResolver: McpRuntimeDefinitionResolver;
  drivers: Pick<McpRuntimeDriverRegistry, 'resolve'>;
  metrics?: McpRuntimeMetrics;
  connectTimeoutMs: number;
  discoveryIdleTimeoutMs: number;
  discoveryTotalTimeoutMs: number;
  startingObserveTimeoutMs: number;
  startingPollIntervalMs: number;
  renewalIntervalMs: number;
  holderIdleTimeoutMs: number;
  drainTimeoutMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface McpRuntimeAcquireFlight {
  controller: AbortController;
  promise: Promise<McpRuntimeRef>;
  waiters: number;
  settled: boolean;
}

export class McpRuntimeFenceError extends Error {
  readonly code = 'MCP_RUNTIME_FENCE_LOST' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpRuntimeFenceError';
  }
}

export class McpRuntimeFenceLostError extends McpRuntimeFenceError {
  constructor(message = 'MCP runtime fence is no longer current', options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpRuntimeFenceLostError';
  }
}

export class McpRuntimeAmbiguousError extends Error {
  readonly code = 'MCP_RUNTIME_AMBIGUOUS' as const;

  constructor(message = 'MCP runtime ownership was lost after dispatch', options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpRuntimeAmbiguousError';
  }
}

export class McpRuntimeUnavailableError extends Error {
  readonly code = 'MCP_RUNTIME_UNAVAILABLE' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpRuntimeUnavailableError';
  }
}

export class McpRuntimeManager {
  readonly processIdentity: McpRuntimeAcquireRequest['candidateOwner'];
  readonly metrics: McpRuntimeMetrics;

  private readonly repository: McpRuntimeLeaseStore;
  private readonly definitionResolver: McpRuntimeDefinitionResolver;
  private readonly drivers: Pick<McpRuntimeDriverRegistry, 'resolve'>;
  private readonly connectTimeoutMs: number;
  private readonly discoveryIdleTimeoutMs: number;
  private readonly discoveryTotalTimeoutMs: number;
  private readonly startingObserveTimeoutMs: number;
  private readonly startingPollIntervalMs: number;
  private readonly renewalIntervalMs: number;
  private readonly holderIdleTimeoutMs: number;
  private readonly drainTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly recordsByRuntimeId = new Map<string, McpRuntimeRecord>();
  private readonly acquireFlights = new Map<string, McpRuntimeAcquireFlight>();
  private readonly startupControllers = new Set<AbortController>();
  private readonly completedReleaseTombstones = new Map<string, number>();

  private renewalTimer?: ReturnType<typeof setInterval>;
  private renewalFlight?: Promise<void>;
  private shuttingDown = false;
  private closeFlight?: Promise<void>;

  constructor(options: McpRuntimeManagerOptions) {
    this.processIdentity = deepFreeze(
      McpRuntimeAcquireRequestSchema.shape.candidateOwner.parse(options.processIdentity),
    );
    this.repository = options.repository;
    this.definitionResolver = options.definitionResolver;
    this.drivers = options.drivers;
    this.metrics = options.metrics ?? new McpRuntimeMetrics();
    this.connectTimeoutMs = positiveDuration(options.connectTimeoutMs, 'connect timeout');
    this.discoveryIdleTimeoutMs = positiveDuration(
      options.discoveryIdleTimeoutMs,
      'discovery idle timeout',
    );
    this.discoveryTotalTimeoutMs = positiveDuration(
      options.discoveryTotalTimeoutMs,
      'discovery total timeout',
    );
    this.startingObserveTimeoutMs = positiveDuration(
      options.startingObserveTimeoutMs,
      'starting observation timeout',
    );
    this.startingPollIntervalMs = positiveDuration(
      options.startingPollIntervalMs,
      'starting poll interval',
    );
    this.renewalIntervalMs = positiveDuration(options.renewalIntervalMs, 'renewal interval');
    this.holderIdleTimeoutMs = positiveDuration(options.holderIdleTimeoutMs, 'holder idle timeout');
    this.drainTimeoutMs = positiveDuration(options.drainTimeoutMs, 'drain timeout');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
  }

  async acquire(
    runtimeKeyInput: McpRuntimeKey,
    candidateOwnerInput: McpRuntimeAcquireRequest['candidateOwner'],
    signal?: AbortSignal,
  ): Promise<McpRuntimeRef> {
    this.assertAccepting('acquire');
    throwIfAborted(signal);
    const parsed = McpRuntimeAcquireRequestSchema.parse({
      runtimeKey: runtimeKeyInput,
      candidateOwner: candidateOwnerInput,
    });
    const runtimeKey = deepFreeze(parsed.runtimeKey);
    const candidateOwner = parsed.candidateOwner;
    this.assertProcessIdentity(candidateOwner);
    const serializedKey = serializeMcpRuntimeKey(runtimeKey);
    let flight = this.acquireFlights.get(serializedKey);
    if (!flight) {
      const controller = new AbortController();
      flight = {
        controller,
        promise: this.acquireOwned(runtimeKey, controller.signal),
        waiters: 0,
        settled: false,
      };
      this.acquireFlights.set(serializedKey, flight);
      const createdFlight = flight;
      void createdFlight.promise.then(
        () => this.finishAcquireFlight(serializedKey, createdFlight),
        () => this.finishAcquireFlight(serializedKey, createdFlight),
      );
    }
    flight.waiters += 1;
    try {
      const ref = await waitForPromiseOrAbort(flight.promise, signal);
      this.metrics.recordOperation('acquire', 'success');
      return ref;
    } catch (error: unknown) {
      this.metrics.recordOperation(
        'acquire',
        error instanceof McpRuntimeFenceError ? 'stale' : 'failure',
      );
      throw error;
    } finally {
      flight.waiters -= 1;
      if (flight.waiters === 0) {
        if (!flight.settled) {
          flight.controller.abort(
            signal?.reason ?? new McpRuntimeUnavailableError('MCP runtime startup was abandoned'),
          );
        } else if (this.acquireFlights.get(serializedKey) === flight) {
          this.acquireFlights.delete(serializedKey);
        }
      }
    }
  }

  private finishAcquireFlight(serializedKey: string, flight: McpRuntimeAcquireFlight): void {
    flight.settled = true;
    if (flight.waiters === 0 && this.acquireFlights.get(serializedKey) === flight) {
      this.acquireFlights.delete(serializedKey);
    }
  }

  retain(fenceInput: McpRuntimeFence, holderIdInput: McpRuntimeHolderId): void {
    this.assertAccepting('retain');
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const record = this.localRecord(fenceInput);
    this.assertRecordAccepting(record);
    if (
      record.releasedHolders.has(holderId) ||
      this.hasCompletedRelease(record.ref.fence, holderId)
    ) {
      throw new McpRuntimeFenceLostError('MCP runtime holder has already been released');
    }
    const existing = record.holders.get(holderId);
    if (existing) {
      if (existing.inFlight === 0 && existing.expiresAtMs <= this.now()) {
        this.retireHolder(record, holderId);
        throw new McpRuntimeFenceLostError('MCP runtime holder has expired');
      }
      existing.expiresAtMs = this.holderDeadline();
      return;
    }
    record.holders.set(holderId, { expiresAtMs: this.holderDeadline(), inFlight: 0 });
    record.unclaimedExpiresAtMs = undefined;
  }

  async discover(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
  ): Promise<McpCatalog> {
    this.assertAccepting('discover');
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const { record, holder } = this.beginHolderOperation(fenceInput, holderId);
    try {
      await this.assertLiveReady(record);
      this.assertRecordAccepting(record);
      this.assertHolder(record, holderId);
      this.metrics.recordOperation('discover', 'success');
      return record.catalog;
    } catch (error: unknown) {
      this.metrics.recordOperation(
        'discover',
        error instanceof McpRuntimeFenceError ? 'stale' : 'failure',
      );
      throw error;
    } finally {
      this.endHolderOperation(holder);
    }
  }

  invoke(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
    name: string,
    args: Record<string, unknown>,
    context: McpOperationContext,
  ): Promise<NormalizedMcpResult> {
    return this.dispatch(
      fenceInput,
      holderIdInput,
      'invoke',
      context,
      (record, operationContext) => {
        const tool = record.catalog.tools.find((candidate) => candidate.canonicalName === name);
        if (!tool)
          throw new McpRuntimeUnavailableError(`MCP tool is not in the runtime catalog: ${name}`);
        return record.handle.adapter.callTool(tool, args, operationContext);
      },
    );
  }

  read(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
    uri: string,
    context: McpOperationContext,
  ): Promise<NormalizedMcpResult> {
    return this.dispatch(fenceInput, holderIdInput, 'read', context, (record, operationContext) =>
      record.handle.adapter.readResource(uri, operationContext),
    );
  }

  getPrompt(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
    name: string,
    args: Record<string, string>,
    context: McpOperationContext,
  ): Promise<NormalizedMcpResult> {
    return this.dispatch(
      fenceInput,
      holderIdInput,
      'get-prompt',
      context,
      (record, operationContext) => record.handle.adapter.getPrompt(name, args, operationContext),
    );
  }

  renew(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
  ): Promise<McpReadyRuntimeRef> {
    this.assertAccepting('renew');
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const { record, holder } = this.beginHolderOperation(fenceInput, holderId);
    return this.renewRecord(record).finally(() => this.endHolderOperation(holder));
  }

  touch(fenceInput: McpRuntimeFence, holderIdInput: McpRuntimeHolderId): McpReadyRuntimeRef {
    this.assertAccepting('touch');
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const { record, holder } = this.beginHolderOperation(fenceInput, holderId);
    try {
      if (record.ref.state !== 'ready') {
        throw new McpRuntimeUnavailableError('MCP runtime is not ready');
      }
      return record.ref;
    } finally {
      this.endHolderOperation(holder);
    }
  }

  private renewRecord(record: McpRuntimeRecord): Promise<McpReadyRuntimeRef> {
    if (record.renewFlight) return record.renewFlight;
    const flight = this.renewOwned(record);
    const token = Symbol('mcp-runtime-renewal');
    const tracked = (async () => {
      try {
        return await flight;
      } finally {
        if (record.renewFlightToken === token) {
          record.renewFlight = undefined;
          record.renewFlightToken = undefined;
        }
      }
    })();
    record.renewFlightToken = token;
    record.renewFlight = tracked;
    return tracked;
  }

  private async renewOwned(record: McpRuntimeRecord): Promise<McpReadyRuntimeRef> {
    try {
      const renewedRaw = await this.repository.renew(record.runtimeKey, record.ref.fence);
      const renewed = renewedRaw ? immutableRuntimeRef(renewedRaw) : null;
      if (renewed?.state !== 'ready' || !sameMcpRuntimeFence(renewed.fence, record.ref.fence)) {
        throw new McpRuntimeFenceLostError('MCP runtime lease renewal lost its fence');
      }
      const ready = renewed as McpReadyRuntimeRef;
      record.ref = ready;
      this.metrics.recordOperation('renew', 'success');
      return ready;
    } catch (error: unknown) {
      if (record.state === 'draining') {
        this.metrics.recordOperation('renew', 'failure');
        throw new McpRuntimeUnavailableError('MCP runtime is draining', { cause: error });
      }
      const fenceError =
        error instanceof McpRuntimeFenceError
          ? error
          : new McpRuntimeFenceLostError('MCP runtime lease renewal could not confirm ownership', {
              cause: error,
            });
      this.selfFence(record, fenceError);
      this.metrics.recordOperation('renew', 'stale');
      throw fenceError;
    }
  }

  release(fenceInput: McpRuntimeFence, holderIdInput: McpRuntimeHolderId): Promise<void> {
    const fence = McpRuntimeFenceSchema.parse(fenceInput);
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const record = this.recordsByRuntimeId.get(fence.runtimeId);
    if (!record) return this.releaseAbsent(fence, holderId);
    if (!sameMcpRuntimeFence(record.ref.fence, fence)) {
      return Promise.reject(new McpRuntimeFenceLostError());
    }
    if (this.hasCompletedRelease(fence, holderId)) {
      return record.releaseFlight ?? Promise.resolve();
    }
    if (record.releasedHolders.has(holderId)) {
      return record.releaseFlight ?? Promise.resolve();
    }
    const held = record.holders.delete(holderId);
    record.releasedHolders.add(holderId);
    this.rememberCompletedRelease(fence, holderId);
    // A release may race ahead of a delayed retain request. Persisting the
    // release intent on this live fence prevents that retain from leaking it.
    if (!held) return record.releaseFlight ?? Promise.resolve();
    if (record.holders.size > 0) {
      this.metrics.recordOperation('release', 'success');
      return Promise.resolve();
    }

    return this.beginRecordDrain(record);
  }

  async health(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
  ): Promise<McpRuntimeHealth> {
    this.assertAccepting('health');
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const { record, holder } = this.beginHolderOperation(fenceInput, holderId);
    try {
      this.assertRecordAccepting(record);
      const live = await this.assertLiveReady(record);
      this.assertRecordAccepting(record);
      this.assertHolder(record, holderId);
      const checkedAtMs = this.now();
      const transport = await record.handle.health();
      if (record.state === 'self-fenced') throw new McpRuntimeFenceLostError();
      const status = Date.parse(live.leaseExpiresAt) <= checkedAtMs ? 'unhealthy' : transport;
      const health = McpRuntimeHealthSchema.parse({
        fence: live.fence,
        state: live.state,
        status,
        checkedAt: new Date(checkedAtMs).toISOString(),
        leaseExpiresAt: live.leaseExpiresAt,
      });
      this.metrics.recordOperation('health', 'success');
      return health;
    } catch (error: unknown) {
      this.metrics.recordOperation(
        'health',
        error instanceof McpRuntimeFenceError ? 'stale' : 'failure',
      );
      throw error;
    } finally {
      this.endHolderOperation(holder);
    }
  }

  checkReadiness(): void {
    if (this.shuttingDown) {
      throw new McpRuntimeUnavailableError('MCP runtime manager is shutting down');
    }
    const selfFenced = [...this.recordsByRuntimeId.values()].find(
      (record) => record.state === 'self-fenced',
    );
    if (selfFenced) {
      throw new McpRuntimeFenceLostError('MCP runtime manager has self-fenced ownership', {
        cause: selfFenced.fenceLoss,
      });
    }
  }

  beginShutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.stopRenewalLoop();
    const reason = new McpRuntimeUnavailableError('MCP runtime manager is shutting down');
    for (const flight of this.acquireFlights.values()) flight.controller.abort(reason);
    for (const controller of this.startupControllers) controller.abort(reason);
    for (const record of this.recordsByRuntimeId.values()) record.accepting = false;
  }

  close(): Promise<void> {
    if (this.closeFlight) return this.closeFlight;
    this.beginShutdown();
    this.closeFlight = this.closeOwnedRuntimes();
    return this.closeFlight;
  }

  private async acquireOwned(
    runtimeKey: McpRuntimeKey,
    signal: AbortSignal,
  ): Promise<McpRuntimeRef> {
    const reservation = await this.repository.reserve(runtimeKey, this.processIdentity);
    const reservedRef = immutableRuntimeRef(reservation.ref);
    if (reservation.kind === 'existing') {
      throwIfAborted(signal);
      this.assertNotShuttingDown();
      if (reservedRef.state === 'ready') return reservedRef;
      if (reservedRef.state === 'draining') {
        throw new McpRuntimeUnavailableError('MCP runtime lease is draining');
      }
      if (reservedRef.state !== 'starting') {
        throw new McpRuntimeUnavailableError('MCP runtime lease has an unknown state');
      }
      return this.observeStarting(runtimeKey, reservedRef, signal);
    }
    if (reservedRef.state !== 'starting') {
      throw new McpRuntimeUnavailableError(
        'A newly reserved MCP runtime was not in starting state',
      );
    }
    return this.startReservedRuntime(runtimeKey, reservedRef, signal);
  }

  private async observeStarting(
    runtimeKey: McpRuntimeKey,
    starting: Extract<McpRuntimeRef, { state: 'starting' }>,
    signal: AbortSignal,
  ): Promise<McpRuntimeRef> {
    const deadline = this.now() + this.startingObserveTimeoutMs;
    let current: McpRuntimeRef | null = starting;
    while (current.state === 'starting') {
      this.assertNotShuttingDown();
      throwIfAborted(signal);
      if (this.now() >= deadline || Date.parse(current.leaseExpiresAt) <= this.now()) {
        throw new McpRuntimeUnavailableError('Timed out observing MCP runtime startup');
      }
      await waitForPromiseOrAbort(this.sleep(this.startingPollIntervalMs), signal);
      const observed = await this.repository.read(runtimeKey);
      throwIfAborted(signal);
      if (!observed) throw new McpRuntimeUnavailableError('MCP runtime startup lease disappeared');
      current = immutableRuntimeRef(observed);
      if (!sameMcpRuntimeFence(current.fence, starting.fence)) {
        throw new McpRuntimeFenceLostError('MCP runtime startup generation changed');
      }
    }
    if (current.state !== 'ready') {
      throw new McpRuntimeUnavailableError('MCP runtime became unavailable while starting');
    }
    return current;
  }

  private async startReservedRuntime(
    runtimeKey: McpRuntimeKey,
    starting: Extract<McpRuntimeRef, { state: 'starting' }>,
    signal: AbortSignal,
  ): Promise<McpRuntimeRef> {
    const startupAbort = new AbortController();
    const timeout = setTimeout(
      () => startupAbort.abort(new McpRuntimeUnavailableError('MCP runtime startup timed out')),
      this.discoveryTotalTimeoutMs + this.connectTimeoutMs,
    );
    const linkedStartup = linkAbortSignals([signal, startupAbort.signal]);
    this.startupControllers.add(startupAbort);
    let record: McpRuntimeRecord | undefined;
    let driver: McpRuntimeDriver | undefined;
    let handle: McpRuntimeRecord['handle'] | undefined;
    try {
      this.assertNotShuttingDown();
      throwIfAborted(linkedStartup.controller.signal);
      const resolved = await this.definitionResolver.resolve(
        runtimeKey,
        linkedStartup.controller.signal,
      );
      throwIfAborted(linkedStartup.controller.signal);
      const definition = validateDefinition(runtimeKey, resolved);
      this.assertNotShuttingDown();
      driver = this.drivers.resolve(definition);
      handle = await driver.start({
        runtimeKey,
        fence: starting.fence,
        ownerAddress: this.processIdentity.ownerAddress,
        definition,
        signal: linkedStartup.controller.signal,
        connectTimeoutMs: this.connectTimeoutMs,
      });
      throwIfAborted(linkedStartup.controller.signal);
      const discovered = await handle.adapter.discover(
        definition.sourceId,
        definition.bindingFingerprint,
        {
          signal: linkedStartup.controller.signal,
          idleTimeoutMs: this.discoveryIdleTimeoutMs,
          maxTotalTimeoutMs: this.discoveryTotalTimeoutMs,
        },
      );
      throwIfAborted(linkedStartup.controller.signal);
      const catalogWithoutFingerprint = {
        protocolEra: discovered.metadata.protocolEra,
        protocolVersion: discovered.metadata.protocolVersion,
        tools: discovered.tools,
        resources: discovered.resources,
        resourceTemplates: discovered.resourceTemplates,
        prompts: discovered.prompts,
      };
      const capabilityFingerprint = computeMcpCapabilityFingerprint(catalogWithoutFingerprint);
      if (
        definition.expectedCapabilityFingerprint !== undefined &&
        capabilityFingerprint !== definition.expectedCapabilityFingerprint
      ) {
        throw new McpRuntimeUnavailableError(
          'Discovered MCP capability fingerprint does not match the expected capability fingerprint',
        );
      }
      const catalog = deepFreeze(
        McpCatalogSchema.parse({
          ...catalogWithoutFingerprint,
          capabilityFingerprint,
        }),
      );
      if (this.recordsByRuntimeId.has(starting.fence.runtimeId)) {
        throw new McpRuntimeUnavailableError('MCP runtime ID is already owned by this process');
      }
      record = {
        runtimeKey,
        definition,
        driver,
        handle,
        catalog,
        ref: starting,
        state: 'starting',
        accepting: false,
        lifecycleAbort: new AbortController(),
        activeOperations: new Set(),
        holders: new Map(),
        releasedHolders: new Set(),
        unclaimedExpiresAtMs: this.holderDeadline(),
      };
      // Install the owner-local record before making the address routable in Redis.
      this.recordsByRuntimeId.set(starting.fence.runtimeId, record);
      this.updateOwnedMetric();
      throwIfAborted(linkedStartup.controller.signal);
      const published = await this.repository.publishReady(runtimeKey, starting.fence, {
        ownerAddress: this.processIdentity.ownerAddress,
        protocolEra: catalog.protocolEra,
        protocolVersion: catalog.protocolVersion,
        capabilityFingerprint,
      });
      if (
        published?.state !== 'ready' ||
        !sameMcpRuntimeFence(published.fence, starting.fence) ||
        published.ownerAddress !== this.processIdentity.ownerAddress ||
        published.protocolEra !== catalog.protocolEra ||
        published.protocolVersion !== catalog.protocolVersion ||
        published.capabilityFingerprint !== capabilityFingerprint
      ) {
        throw new McpRuntimeFenceLostError('MCP runtime lost its fence before ready publication');
      }
      throwIfAborted(linkedStartup.controller.signal);
      this.assertNotShuttingDown();
      const readyRef = immutableRuntimeRef(published) as McpReadyRuntimeRef;
      record.ref = readyRef;
      record.state = 'active';
      record.accepting = true;
      this.ensureRenewalLoop();
      return readyRef;
    } catch (error: unknown) {
      if (record) {
        record.accepting = false;
        record.state = 'closed';
        record.lifecycleAbort.abort(error);
        await ignoreFailure(this.disposeRecord(record));
        this.recordsByRuntimeId.delete(starting.fence.runtimeId);
        this.updateOwnedMetric();
      } else if (handle && driver) {
        await ignoreFailure(cleanupHandle(driver, handle));
      }
      await ignoreFailure(this.repository.compareAndDelete(runtimeKey, starting.fence));
      throw error;
    } finally {
      clearTimeout(timeout);
      linkedStartup.cleanup();
      this.startupControllers.delete(startupAbort);
    }
  }

  private async dispatch<T>(
    fenceInput: McpRuntimeFence,
    holderIdInput: McpRuntimeHolderId,
    kind: Extract<McpRuntimeOperationKind, 'invoke' | 'read' | 'get-prompt'>,
    context: McpOperationContext,
    operation: (record: McpRuntimeRecord, context: McpOperationContext) => Promise<T>,
  ): Promise<T> {
    this.assertAccepting(kind);
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const { record, holder } = this.beginHolderOperation(fenceInput, holderId);
    const linked = linkAbortSignals([context.signal, record.lifecycleAbort.signal]);
    let dispatched = false;
    const operationPromise = (async (): Promise<T> => {
      try {
        await this.assertLiveReady(record);
        this.assertAccepting(kind);
        this.assertRecordAccepting(record);
        this.assertHolder(record, holderId);
        dispatched = true;
        const result = await operation(record, { ...context, signal: linked.controller.signal });
        if (record.state === 'self-fenced') {
          throw new McpRuntimeAmbiguousError(undefined, { cause: record.fenceLoss });
        }
        this.metrics.recordOperation(kind, 'success');
        return result;
      } catch (error: unknown) {
        if (dispatched && record.state === 'self-fenced') {
          this.metrics.recordOperation(kind, 'ambiguous');
          throw error instanceof McpRuntimeAmbiguousError
            ? error
            : new McpRuntimeAmbiguousError(undefined, { cause: error });
        }
        this.metrics.recordOperation(
          kind,
          error instanceof McpRuntimeFenceError ? 'stale' : 'failure',
        );
        throw error;
      } finally {
        linked.cleanup();
        this.endHolderOperation(holder);
      }
    })();
    record.activeOperations.add(operationPromise);
    try {
      return await operationPromise;
    } finally {
      record.activeOperations.delete(operationPromise);
    }
  }

  private async assertLiveReady(record: McpRuntimeRecord): Promise<McpReadyRuntimeRef> {
    let live: McpRuntimeRef | null;
    try {
      const liveRaw = await this.repository.read(record.runtimeKey);
      live = liveRaw ? immutableRuntimeRef(liveRaw) : null;
    } catch (error: unknown) {
      const fenceError = new McpRuntimeFenceLostError(
        'MCP runtime ownership could not be confirmed',
        { cause: error },
      );
      this.selfFence(record, fenceError);
      throw fenceError;
    }
    if (
      live?.state !== 'ready' ||
      !sameMcpRuntimeFence(live.fence, record.ref.fence) ||
      live.ownerAddress !== this.processIdentity.ownerAddress
    ) {
      if (
        live?.state === 'draining' &&
        record.state === 'draining' &&
        sameMcpRuntimeFence(live.fence, record.ref.fence)
      ) {
        throw new McpRuntimeUnavailableError('MCP runtime is draining');
      }
      const fenceError = new McpRuntimeFenceLostError();
      this.selfFence(record, fenceError);
      throw fenceError;
    }
    const ready = live as McpReadyRuntimeRef;
    record.ref = ready;
    return ready;
  }

  private localRecord(fenceInput: McpRuntimeFence): McpRuntimeRecord {
    this.assertAccepting('operation');
    const fence = McpRuntimeFenceSchema.parse(fenceInput);
    const record = this.recordsByRuntimeId.get(fence.runtimeId);
    if (!record || !sameMcpRuntimeFence(record.ref.fence, fence)) {
      throw new McpRuntimeFenceLostError('MCP runtime is not owned by this process and fence');
    }
    if (record.state === 'self-fenced') {
      throw new McpRuntimeFenceLostError('MCP runtime has self-fenced', {
        cause: record.fenceLoss,
      });
    }
    if (record.state === 'closed') throw new McpRuntimeFenceLostError();
    return record;
  }

  private beginHolderOperation(
    fenceInput: McpRuntimeFence,
    holderId: McpRuntimeHolderId,
  ): { record: McpRuntimeRecord; holder: McpRuntimeHolderLease } {
    const record = this.localRecord(fenceInput);
    const holder = record.holders.get(holderId);
    if (!holder) {
      throw new McpRuntimeFenceLostError('MCP runtime holder is not active for this full fence');
    }
    this.assertRecordAccepting(record);
    if (holder.inFlight === 0 && holder.expiresAtMs <= this.now()) {
      this.retireHolder(record, holderId);
      throw new McpRuntimeFenceLostError('MCP runtime holder has expired');
    }
    holder.expiresAtMs = this.holderDeadline();
    holder.inFlight += 1;
    return { record, holder };
  }

  private endHolderOperation(holder: McpRuntimeHolderLease): void {
    holder.inFlight = Math.max(0, holder.inFlight - 1);
  }

  private retireHolder(record: McpRuntimeRecord, holderId: McpRuntimeHolderId): void {
    record.holders.delete(holderId);
    record.releasedHolders.add(holderId);
    this.rememberCompletedRelease(record.ref.fence, holderId);
    if (record.holders.size === 0 && record.state === 'active' && record.accepting) {
      void ignoreFailure(this.beginRecordDrain(record));
    }
  }

  private assertHolder(record: McpRuntimeRecord, holderId: McpRuntimeHolderId): void {
    if (!record.holders.has(holderId)) {
      throw new McpRuntimeFenceLostError('MCP runtime holder is not active for this full fence');
    }
  }

  private assertRecordAccepting(record: McpRuntimeRecord): void {
    if (!record.accepting || record.state !== 'active') {
      throw new McpRuntimeUnavailableError('MCP runtime is not accepting new work');
    }
  }

  private selfFence(record: McpRuntimeRecord, reason: unknown): void {
    if (record.state === 'self-fenced' || record.state === 'closed') return;
    record.accepting = false;
    record.state = 'self-fenced';
    record.fenceLoss = reason;
    record.lifecycleAbort.abort(reason);
    this.metrics.recordSelfFence();
    this.updateOwnedMetric();
    void ignoreFailure(this.disposeRecord(record));
  }

  private async releaseOwned(record: McpRuntimeRecord): Promise<void> {
    let beganDrain = false;
    try {
      const drainingRaw = await this.repository.beginDrain(record.runtimeKey, record.ref.fence);
      const draining = drainingRaw ? immutableRuntimeRef(drainingRaw) : null;
      if (
        draining?.state !== 'draining' ||
        !sameMcpRuntimeFence(draining.fence, record.ref.fence)
      ) {
        throw new McpRuntimeFenceLostError('MCP runtime lost its fence while beginning drain');
      }
      beganDrain = true;
      record.ref = draining;
      const drainDeadline = Math.min(
        this.now() + this.drainTimeoutMs,
        Date.parse(draining.leaseExpiresAt),
      );
      let operationsSettled = await settleBefore(record.activeOperations, drainDeadline, this.now);
      if (!operationsSettled) {
        record.lifecycleAbort.abort(
          new McpRuntimeUnavailableError('MCP runtime drain timeout elapsed'),
        );
        operationsSettled = await settleBefore(record.activeOperations, drainDeadline, this.now);
      }
      const cleanupOutcome = await settledOutcomeBefore(
        this.disposeRecord(record),
        drainDeadline,
        this.now,
      );
      let deleted: boolean;
      try {
        deleted = await this.repository.compareAndDelete(record.runtimeKey, record.ref.fence);
      } catch (error: unknown) {
        throw new McpRuntimeFenceLostError('MCP runtime deletion could not confirm ownership', {
          cause: error,
        });
      }
      if (!deleted) throw new McpRuntimeFenceLostError('MCP runtime fence changed during release');
      record.state = 'closed';
      this.recordsByRuntimeId.delete(record.ref.fence.runtimeId);
      this.updateOwnedMetric();
      this.stopRenewalLoopWhenIdle();
      if (!operationsSettled || cleanupOutcome.status === 'timed-out') {
        throw new McpRuntimeUnavailableError(
          'MCP runtime cleanup exceeded the fenced drain deadline',
        );
      }
      if (cleanupOutcome.status === 'rejected') throw cleanupOutcome.reason;
      this.metrics.recordOperation('release', 'success');
    } catch (error: unknown) {
      const releaseError =
        !beganDrain && !(error instanceof McpRuntimeFenceError)
          ? new McpRuntimeFenceLostError('MCP runtime drain could not confirm ownership', {
              cause: error,
            })
          : error;
      if (releaseError instanceof McpRuntimeFenceError) this.selfFence(record, releaseError);
      this.metrics.recordOperation(
        'release',
        releaseError instanceof McpRuntimeFenceError ? 'stale' : 'failure',
      );
      throw releaseError;
    }
  }

  private async releaseAbsent(fence: McpRuntimeFence, holderId: McpRuntimeHolderId): Promise<void> {
    if (this.hasCompletedRelease(fence, holderId)) return;
    throw new McpRuntimeFenceLostError(
      'MCP runtime holder release was not completed by this process and full fence',
    );
  }

  private forceRelease(record: McpRuntimeRecord): Promise<void> {
    if (record.releaseFlight) return record.releaseFlight;
    record.holders.clear();
    return this.beginRecordDrain(record);
  }

  private beginRecordDrain(record: McpRuntimeRecord): Promise<void> {
    if (record.releaseFlight) return record.releaseFlight;
    record.accepting = false;
    record.state = 'draining';
    const flight = this.releaseOwned(record);
    record.releaseFlight = flight;
    return flight;
  }

  private rememberCompletedRelease(fence: McpRuntimeFence, holderId: McpRuntimeHolderId): void {
    this.pruneCompletedReleases();
    while (this.completedReleaseTombstones.size >= MAX_COMPLETED_RELEASE_TOMBSTONES) {
      const oldest = this.completedReleaseTombstones.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.completedReleaseTombstones.delete(oldest);
    }
    this.completedReleaseTombstones.set(
      serializeHolder(fence, holderId),
      this.now() + COMPLETED_RELEASE_TOMBSTONE_TTL_MS,
    );
  }

  private hasCompletedRelease(fence: McpRuntimeFence, holderId: McpRuntimeHolderId): boolean {
    this.pruneCompletedReleases();
    return this.completedReleaseTombstones.has(serializeHolder(fence, holderId));
  }

  private pruneCompletedReleases(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.completedReleaseTombstones) {
      if (expiresAt <= now) this.completedReleaseTombstones.delete(key);
    }
  }

  private disposeRecord(record: McpRuntimeRecord): Promise<void> {
    if (record.cleanupFlight) return record.cleanupFlight;
    record.cleanupFlight = cleanupHandle(record.driver, record.handle);
    return record.cleanupFlight;
  }

  private ensureRenewalLoop(): void {
    if (this.shuttingDown || this.renewalTimer) return;
    this.renewalTimer = setInterval(() => {
      void this.renewAllOwned();
    }, this.renewalIntervalMs);
    this.renewalTimer.unref?.();
  }

  private renewAllOwned(): Promise<void> {
    if (this.renewalFlight) return this.renewalFlight;
    const flight = (async () => {
      const records = [...this.recordsByRuntimeId.values()]
        .filter((record) => record.state === 'active' && record.accepting)
        .map((record) => record);
      await Promise.allSettled(records.map((record) => this.maintainOwnedRecord(record)));
    })();
    this.renewalFlight = flight;
    void flight.finally(() => {
      if (this.renewalFlight === flight) this.renewalFlight = undefined;
      this.stopRenewalLoopWhenIdle();
    });
    return flight;
  }

  private maintainOwnedRecord(record: McpRuntimeRecord): Promise<unknown> {
    const now = this.now();
    for (const [holderId, holder] of record.holders) {
      if (holder.inFlight > 0 || holder.expiresAtMs > now) continue;
      record.holders.delete(holderId);
      record.releasedHolders.add(holderId);
      this.rememberCompletedRelease(record.ref.fence, holderId as McpRuntimeHolderId);
    }
    if (
      record.holders.size === 0 &&
      (record.unclaimedExpiresAtMs === undefined || record.unclaimedExpiresAtMs <= now)
    ) {
      return this.beginRecordDrain(record);
    }
    return this.renewRecord(record);
  }

  private holderDeadline(): number {
    return this.now() + this.holderIdleTimeoutMs;
  }

  private stopRenewalLoopWhenIdle(): void {
    const hasActive = [...this.recordsByRuntimeId.values()].some(
      (record) => record.state === 'active' && record.accepting,
    );
    if (!hasActive) this.stopRenewalLoop();
  }

  private stopRenewalLoop(): void {
    if (!this.renewalTimer) return;
    clearInterval(this.renewalTimer);
    this.renewalTimer = undefined;
  }

  private async closeOwnedRuntimes(): Promise<void> {
    await Promise.allSettled([...this.acquireFlights.values()].map((flight) => flight.promise));
    const releases = [...this.recordsByRuntimeId.values()].map(async (record) => {
      if (record.state === 'self-fenced' || record.state === 'closed') {
        try {
          await this.disposeRecord(record);
        } finally {
          this.recordsByRuntimeId.delete(record.ref.fence.runtimeId);
        }
        return;
      }
      await this.forceRelease(record);
    });
    const outcomes = await Promise.allSettled(releases);
    const residualCleanup = [...this.recordsByRuntimeId.values()].map(async (record) => {
      try {
        await this.disposeRecord(record);
      } finally {
        this.recordsByRuntimeId.delete(record.ref.fence.runtimeId);
      }
    });
    const cleanupOutcomes = await Promise.allSettled(residualCleanup);
    this.updateOwnedMetric();
    const failures = [...outcomes, ...cleanupOutcomes]
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      .map((outcome) => outcome.reason);
    if (failures.length > 0) throw new AggregateError(failures, 'Failed to close MCP runtimes');
  }

  private assertProcessIdentity(candidate: McpRuntimeAcquireRequest['candidateOwner']): void {
    if (
      candidate.ownerId !== this.processIdentity.ownerId ||
      candidate.ownerEpoch !== this.processIdentity.ownerEpoch ||
      candidate.ownerAddress !== this.processIdentity.ownerAddress
    ) {
      throw new McpRuntimeUnavailableError(
        'MCP runtime candidate owner does not match this process identity',
      );
    }
  }

  private assertAccepting(operation: string): void {
    if (this.shuttingDown) {
      throw new McpRuntimeUnavailableError(
        `MCP runtime manager is shutting down and cannot ${operation}`,
      );
    }
  }

  private assertNotShuttingDown(): void {
    this.assertAccepting('continue startup');
  }

  private updateOwnedMetric(): void {
    const count = [...this.recordsByRuntimeId.values()].filter(
      (record) =>
        record.state === 'starting' || record.state === 'active' || record.state === 'draining',
    ).length;
    this.metrics.setOwnedRuntimes(count);
  }
}

export function computeMcpCapabilityFingerprint(
  catalog: Omit<McpCatalog, 'capabilityFingerprint'> | McpCatalog,
): string {
  const canonical = {
    protocolEra: catalog.protocolEra,
    protocolVersion: catalog.protocolVersion,
    tools: sortCanonical(catalog.tools),
    resources: sortCanonical(catalog.resources),
    resourceTemplates: sortCanonical(catalog.resourceTemplates),
    prompts: sortCanonical(catalog.prompts),
  };
  return createHash('sha256').update(stableJson(canonical)).digest('hex');
}

function validateDefinition(
  runtimeKey: McpRuntimeKey,
  definitionInput: McpRuntimeDefinition,
): McpRuntimeDefinition {
  const definition = McpResolvedRuntimeDefinitionSchema.parse(definitionInput);
  if (definition.sourceId !== runtimeKey.sourceId) {
    throw new McpRuntimeUnavailableError('Resolved MCP runtime source does not match its key');
  }
  if (definition.configFingerprint !== runtimeKey.configFingerprint) {
    throw new McpRuntimeUnavailableError('Resolved MCP runtime config fingerprint does not match');
  }
  if (!SHA256_HEX.test(definition.bindingFingerprint)) {
    throw new McpRuntimeUnavailableError('Resolved MCP runtime binding fingerprint is invalid');
  }
  if (
    definition.expectedCapabilityFingerprint !== undefined &&
    !SHA256_HEX.test(definition.expectedCapabilityFingerprint)
  ) {
    throw new McpRuntimeUnavailableError('Expected MCP capability fingerprint is invalid');
  }
  const expectedTransport =
    definition.kind === 'remote-http' || definition.kind === 'docker-http' ? 'http' : 'stdio';
  if (runtimeKey.transport !== expectedTransport) {
    throw new McpRuntimeUnavailableError('Resolved MCP runtime transport does not match its key');
  }
  return deepFreeze(definition);
}

function immutableRuntimeRef(ref: McpRuntimeRef): McpRuntimeRef {
  return deepFreeze(McpRuntimeRefSchema.parse(ref));
}

function serializeHolder(fence: McpRuntimeFence, holderId: McpRuntimeHolderId): string {
  return JSON.stringify([
    fence.runtimeId,
    fence.ownerId,
    fence.ownerEpoch,
    fence.leaseGeneration,
    holderId,
  ]);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sortCanonical<T>(values: readonly T[]): T[] {
  return values
    .map((value) => ({ key: stableJson(value), value }))
    .sort((left, right) => {
      if (left.key < right.key) return -1;
      if (left.key > right.key) return 1;
      return 0;
    })
    .map(({ value }) => value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('MCP catalog contains a non-finite number');
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== 'object') throw new Error('MCP catalog contains a non-JSON value');
  if (ancestors.has(value)) throw new Error('MCP catalog contains a cycle');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, ancestors));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalize((value as Record<string, unknown>)[key], ancestors);
      if (canonical !== undefined) output[key] = canonical;
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

async function cleanupHandle(
  driver: McpRuntimeDriver,
  handle: McpRuntimeRecord['handle'],
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await handle.close();
  } catch (error: unknown) {
    failures.push(error);
  }
  if (handle.resource) {
    try {
      await driver.reap(handle.resource);
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Failed to clean up MCP runtime');
}

function linkAbortSignals(signals: readonly AbortSignal[]): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const listeners: { signal: AbortSignal; listener: () => void }[] = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = () => controller.abort(signal.reason);
    listeners.push({ signal, listener });
    signal.addEventListener('abort', listener, { once: true });
  }
  return {
    controller,
    cleanup: () => {
      for (const { signal, listener } of listeners) signal.removeEventListener('abort', listener);
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new McpRuntimeUnavailableError('MCP runtime operation was cancelled');
}

function waitForPromiseOrAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  try {
    throwIfAborted(signal);
  } catch (error: unknown) {
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(
        signal.reason ?? new McpRuntimeUnavailableError('MCP runtime operation was cancelled'),
      );
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function settleBefore(
  operations: ReadonlySet<Promise<unknown>>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  const snapshot = [...operations];
  if (snapshot.length === 0) return true;
  const timeoutMs = Math.max(0, deadline - now());
  if (timeoutMs === 0) return false;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    void Promise.allSettled(snapshot).then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

type DeadlineOutcome<T> = PromiseSettledResult<T> | { status: 'timed-out' };

function settledOutcomeBefore<T>(
  promise: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<DeadlineOutcome<T>> {
  const timeoutMs = Math.max(0, deadline - now());
  if (timeoutMs === 0) {
    void promise.catch(() => undefined);
    return Promise.resolve({ status: 'timed-out' });
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve({ status: 'fulfilled', value });
      },
      (reason: unknown) => {
        clearTimeout(timeout);
        resolve({ status: 'rejected', reason });
      },
    );
  });
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 24 * 60 * 60 * 1_000) {
    throw new Error(`MCP runtime ${label} must be between 1ms and 24 hours`);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ignoreFailure(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // The original startup error remains primary; reconciliation owns orphan cleanup.
  }
}
