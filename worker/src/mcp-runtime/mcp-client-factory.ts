import {
  Client,
  type DiscoverResult,
  InMemoryResponseCacheStore,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  type FetchLike,
  type PriorDiscovery,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { McpRuntimeKey } from '@sentris/shared';

import { McpClientAdapter } from './mcp-client-adapter';
import { serializeMcpRuntimeKey } from './mcp-runtime-identity';
import {
  McpSseCompatibilityAdapter,
  isEligibleSseFallback,
  type CapturedHttpResponse,
} from './mcp-sse-compatibility.adapter';
import type {
  McpClientFactoryOptions,
  McpConnectionInput,
  McpOwnedClient,
  McpSseCompatibilityConnector,
} from './mcp-client-adapter.types';

const CLIENT_INFO = { name: 'sentris-worker-mcp-runtime', version: '1.0.0' };

const DEFAULT_PRIOR_TTL_MS = 5 * 60_000;
const MAX_PRIOR_TTL_MS = 15 * 60_000;
const MAX_STDIO_PROBE_TIMEOUT_MS = 60_000;

interface PriorEntry {
  runtimeKey: McpRuntimeKey;
  prior: PriorDiscovery;
  expiresAt: number;
}

interface ConnectFlight {
  runtimeKey: McpRuntimeKey;
  owned: McpOwnedClient;
  controller: AbortController;
  promise: Promise<McpOwnedClient>;
}

function partitionFor(key: McpRuntimeKey): string {
  return serializeMcpRuntimeKey(key);
}

function keyFor(key: McpRuntimeKey): string {
  return partitionFor(key);
}

export class McpClientFactory {
  private readonly ownedClients = new Map<string, McpOwnedClient>();
  private readonly connectedClients = new Map<string, McpOwnedClient>();
  private readonly connectFlights = new Map<string, ConnectFlight>();
  private readonly closeCleanups = new WeakMap<McpOwnedClient, Set<() => void>>();
  private readonly priors = new Map<string, PriorEntry>();
  private readonly priorTtlMs: number;
  private readonly stdioProbeTimeoutMs: number | undefined;
  private readonly now: () => number;
  private readonly sseCompatibility: McpSseCompatibilityConnector;

  constructor(options: McpClientFactoryOptions = {}) {
    const priorTtlMs = options.priorTtlMs ?? DEFAULT_PRIOR_TTL_MS;
    if (!Number.isFinite(priorTtlMs) || priorTtlMs <= 0 || priorTtlMs > MAX_PRIOR_TTL_MS) {
      throw new Error(`MCP prior TTL must be between 1 and ${MAX_PRIOR_TTL_MS}ms`);
    }
    this.priorTtlMs = priorTtlMs;
    const { stdioProbeTimeoutMs } = options;
    if (
      stdioProbeTimeoutMs !== undefined &&
      (!Number.isFinite(stdioProbeTimeoutMs) ||
        stdioProbeTimeoutMs <= 0 ||
        stdioProbeTimeoutMs > MAX_STDIO_PROBE_TIMEOUT_MS)
    ) {
      throw new Error(
        `MCP stdio probe timeout must be between 1 and ${MAX_STDIO_PROBE_TIMEOUT_MS}ms`,
      );
    }
    this.stdioProbeTimeoutMs = stdioProbeTimeoutMs;
    this.now = options.now ?? Date.now;
    this.sseCompatibility = options.sseAdapter ?? new McpSseCompatibilityAdapter();
  }

  createOwnedClient(runtimeKey: McpRuntimeKey): McpOwnedClient {
    const existing = this.ownedClients.get(keyFor(runtimeKey));
    if (existing) return existing;

    const cacheStore = new InMemoryResponseCacheStore();
    const closeCleanups = new Set<() => void>();
    const owned: McpOwnedClient = {
      runtimeKey,
      cachePartition: partitionFor(runtimeKey),
      cacheStore,
      adapter: new McpClientAdapter(
        new Client(CLIENT_INFO, {
          capabilities: {},
          versionNegotiation: {
            mode: 'auto',
            ...(runtimeKey.transport === 'stdio' && this.stdioProbeTimeoutMs !== undefined
              ? { probe: { timeoutMs: this.stdioProbeTimeoutMs, maxRetries: 0 } }
              : {}),
          },
          listMaxPages: 64,
          cachePartition: partitionFor(runtimeKey),
          responseCacheStore: cacheStore,
          inputRequired: { autoFulfill: false },
        }),
        {
          closeCleanup: () => {
            for (const cleanup of closeCleanups) cleanup();
            closeCleanups.clear();
          },
        },
      ),
    };
    this.closeCleanups.set(owned, closeCleanups);
    this.ownedClients.set(keyFor(runtimeKey), owned);
    return owned;
  }

  async connect(input: McpConnectionInput): Promise<McpOwnedClient> {
    if (!Number.isFinite(input.timeout) || input.timeout <= 0) {
      throw new Error('MCP connect requires a finite positive timeout');
    }
    const key = keyFor(input.runtimeKey);
    const connected = this.connectedClients.get(key);
    if (connected && this.ownedClients.get(key) === connected) return connected;
    const activeFlight = this.connectFlights.get(key);
    if (activeFlight) return activeFlight.promise;

    const owned = this.createOwnedClient(input.runtimeKey);
    const controller = new AbortController();
    const flight: ConnectFlight = {
      runtimeKey: input.runtimeKey,
      owned,
      controller,
      promise: Promise.resolve().then(() =>
        this.connectOwnedClient(input, owned, controller.signal),
      ),
    };
    flight.promise = flight.promise
      .then(async (result) => {
        if (this.connectFlights.get(key) !== flight || controller.signal.aborted) {
          await result.adapter.close().catch(() => {});
          throw (
            controller.signal.reason ?? new DOMException('MCP connect superseded', 'AbortError')
          );
        }
        this.ownedClients.set(key, result);
        this.connectedClients.set(key, result);
        return result;
      })
      .finally(() => {
        if (this.connectFlights.get(key) === flight) this.connectFlights.delete(key);
      });
    this.connectFlights.set(key, flight);
    return flight.promise;
  }

  private async connectOwnedClient(
    input: McpConnectionInput,
    owned: McpOwnedClient,
    lifecycleSignal: AbortSignal,
  ): Promise<McpOwnedClient> {
    const deadlineController = new AbortController();
    const deadline = setTimeout(() => {
      deadlineController.abort(
        new SdkError(SdkErrorCode.RequestTimeout, 'MCP connection timed out', {
          timeout: input.timeout,
        }),
      );
    }, input.timeout);
    deadline.unref?.();
    try {
      return await this.connectOwnedClientWithSignal(
        input,
        owned,
        AbortSignal.any([input.signal, lifecycleSignal, deadlineController.signal]),
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  private async connectOwnedClientWithSignal(
    input: McpConnectionInput,
    owned: McpOwnedClient,
    signal: AbortSignal,
  ): Promise<McpOwnedClient> {
    if (signal.aborted) {
      await this.discardOwnedClient(input.runtimeKey, owned);
      throw signal.reason ?? new DOMException('MCP connect aborted', 'AbortError');
    }
    const prior = this.getPrior(input.runtimeKey);
    if (input.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: input.command,
        args: input.args ?? [],
        env: input.env,
        cwd: input.cwd,
        stderr: 'pipe',
      });
      const stderr = transport.stderr;
      const drainStderr = () => {};
      if (stderr) {
        stderr.on('data', drainStderr);
        this.addCloseCleanup(owned, () => stderr.removeListener('data', drainStderr));
      }
      try {
        const metadata = await owned.adapter.connect(
          transport,
          { signal, idleTimeoutMs: input.timeout, maxTotalTimeoutMs: input.timeout },
          prior,
        );
        this.cachePrior(input.runtimeKey, metadata.protocolEra, metadata.discover);
        return owned;
      } catch (error: unknown) {
        await this.discardOwnedClient(input.runtimeKey, owned);
        throw error;
      }
    }

    let finalNonOk: CapturedHttpResponse | undefined;
    let captureConnectResponse = true;
    const upstreamFetch = input.fetch ?? globalThis.fetch;
    const fetch: FetchLike = async (request, init) => {
      const response = await upstreamFetch(request, init);
      if (captureConnectResponse && !response.ok) {
        finalNonOk = { status: response.status, body: await response.clone().text() };
      }
      return response;
    };
    let connectFailed = false;
    let connectError: unknown;
    try {
      const metadata = await owned.adapter.connect(
        new StreamableHTTPClientTransport(input.endpoint, {
          requestInit: input.requestInit,
          authProvider: input.authProvider,
          fetch,
        }),
        { signal, idleTimeoutMs: input.timeout, maxTotalTimeoutMs: input.timeout },
        prior,
      );
      this.cachePrior(input.runtimeKey, metadata.protocolEra, metadata.discover);
    } catch (error: unknown) {
      connectFailed = true;
      connectError = error;
    } finally {
      captureConnectResponse = false;
    }
    if (!connectFailed) return owned;

    const eligibleForSse =
      SdkHttpError.isInstance(connectError) &&
      finalNonOk !== undefined &&
      connectError.status === finalNonOk.status &&
      isEligibleSseFallback(finalNonOk);
    await this.discardOwnedClient(input.runtimeKey, owned);
    if (!eligibleForSse) {
      throw connectError;
    }

    const fallbackClient = await this.sseCompatibility.connect(
      input.endpoint,
      {
        signal,
        timeout: input.timeout,
      },
      owned.cachePartition,
      owned.cacheStore,
      input.authProvider,
      input.requestInit,
    );
    const replacement = { ...owned, adapter: new McpClientAdapter(fallbackClient) };
    this.cachePrior(
      input.runtimeKey,
      fallbackClient.getProtocolEra(),
      fallbackClient.getDiscoverResult(),
    );
    return replacement;
  }

  async invalidateCredentialGenerations(runtimeKey: McpRuntimeKey): Promise<void> {
    const staleOwned = [...this.ownedClients.entries()].filter(([, owned]) =>
      isDifferentCredentialGenerationOf(owned.runtimeKey, runtimeKey),
    );
    const stalePriors = [...this.priors.entries()].filter(([, entry]) =>
      isDifferentCredentialGenerationOf(entry.runtimeKey, runtimeKey),
    );
    const staleFlights = [...this.connectFlights.entries()].filter(([, flight]) =>
      isDifferentCredentialGenerationOf(flight.runtimeKey, runtimeKey),
    );
    for (const [key] of stalePriors) this.priors.delete(key);
    for (const [key, flight] of staleFlights) {
      if (this.connectFlights.get(key) === flight) this.connectFlights.delete(key);
      flight.controller.abort(
        new DOMException('MCP credential generation invalidated', 'AbortError'),
      );
    }
    await Promise.all(
      staleOwned.map(async ([key, owned]) => {
        if (this.ownedClients.get(key) === owned) this.ownedClients.delete(key);
        if (this.connectedClients.get(key) === owned) this.connectedClients.delete(key);
        await owned.adapter.close().catch(() => {});
      }),
    );
    await Promise.allSettled(staleFlights.map(([, flight]) => flight.promise));
  }

  async close(runtimeKey: McpRuntimeKey): Promise<void> {
    const key = keyFor(runtimeKey);
    const flight = this.connectFlights.get(key);
    if (flight) {
      this.connectFlights.delete(key);
      flight.controller.abort(new DOMException('MCP client closed', 'AbortError'));
    }
    const owned = this.ownedClients.get(key);
    this.ownedClients.delete(key);
    this.connectedClients.delete(key);
    await owned?.adapter.close().catch(() => {});
    if (flight) await Promise.allSettled([flight.promise]);
  }

  private async discardOwnedClient(
    runtimeKey: McpRuntimeKey,
    owned: McpOwnedClient,
  ): Promise<void> {
    const key = keyFor(runtimeKey);
    if (this.ownedClients.get(key) === owned) {
      this.ownedClients.delete(key);
    }
    if (this.connectedClients.get(key) === owned) {
      this.connectedClients.delete(key);
    }
    this.priors.delete(key);
    await owned.adapter.close().catch(() => {});
  }

  private addCloseCleanup(owned: McpOwnedClient, cleanup: () => void): void {
    this.closeCleanups.get(owned)?.add(cleanup);
  }

  private getPrior(runtimeKey: McpRuntimeKey): PriorDiscovery | undefined {
    const key = keyFor(runtimeKey);
    const entry = this.priors.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.priors.delete(key);
      return undefined;
    }
    return entry.prior;
  }

  private cachePrior(
    runtimeKey: McpRuntimeKey,
    protocolEra: 'modern' | 'legacy' | undefined,
    discover: DiscoverResult | undefined,
  ): void {
    const prior =
      protocolEra === 'modern' && discover
        ? { kind: 'modern' as const, discover }
        : protocolEra === 'legacy'
          ? { kind: 'legacy' as const }
          : undefined;
    if (!prior) return;
    this.pruneExpiredPriors();
    this.priors.set(keyFor(runtimeKey), {
      runtimeKey,
      prior,
      expiresAt: this.now() + this.priorTtlMs,
    });
  }

  private pruneExpiredPriors(): void {
    const now = this.now();
    for (const [key, entry] of this.priors) {
      if (entry.expiresAt <= now) this.priors.delete(key);
    }
  }
}

function isDifferentCredentialGenerationOf(
  candidate: McpRuntimeKey,
  current: McpRuntimeKey,
): boolean {
  return (
    candidate.credentialGeneration !== current.credentialGeneration &&
    candidate.sourceId === current.sourceId &&
    candidate.transport === current.transport &&
    candidate.configFingerprint === current.configFingerprint &&
    candidate.organizationId === current.organizationId &&
    candidate.principalPartitionHash === current.principalPartitionHash &&
    candidate.credentialReference === current.credentialReference
  );
}
