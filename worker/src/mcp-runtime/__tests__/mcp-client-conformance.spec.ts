import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  Client,
  SdkErrorCode,
  SSEClientTransport,
  type AuthProvider,
  type InMemoryResponseCacheStore,
} from '@modelcontextprotocol/client';

import { McpClientFactory } from '../mcp-client-factory';
import {
  McpSseCompatibilityAdapter,
  isEligibleSseFallback,
} from '../mcp-sse-compatibility.adapter';
import {
  startHttpFixture,
  startHangingLegacySseFixture,
  startLegacySseFixture,
  startPaginationFixture,
  STDIO_FIXTURE_SCRIPT,
} from './fixtures/mcp-conformance-servers';

const runtimeKey = (credentialGeneration = 1) => ({
  sourceId: 'source',
  transport: 'http' as const,
  configFingerprint: 'a'.repeat(64),
  organizationId: 'org-a',
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: 'credential',
  credentialGeneration,
});
const operationContext = () => ({
  signal: AbortSignal.timeout(5_000),
  idleTimeoutMs: 2_000,
  maxTotalTimeoutMs: 5_000,
});

describe('McpClientFactory', () => {
  test('keeps client and response-cache ownership isolated by complete runtime key', () => {
    const factory = new McpClientFactory();
    const first = factory.createOwnedClient(runtimeKey());
    const second = factory.createOwnedClient(runtimeKey(2));

    expect(first.adapter).not.toBe(second.adapter);
    expect(first.cacheStore).not.toBe(second.cacheStore);
    expect(first.cachePartition).not.toBe(second.cachePartition);
  });

  test('single-flights concurrent connects and reuses the connected client sequentially', async () => {
    const fixture = await startHttpFixture({ sessionful: true, legacyProtocolOnly: true });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    const input = {
      transport: 'http' as const,
      endpoint: fixture.endpoint,
      runtimeKey: key,
      signal: AbortSignal.timeout(5_000),
      timeout: 2_000,
    };
    try {
      const [first, second] = await Promise.all([factory.connect(input), factory.connect(input)]);
      expect(second).toBe(first);
      const requestCount = fixture.requests.length;

      const sequential = await factory.connect(input);
      expect(sequential).toBe(first);
      expect(fixture.requests).toHaveLength(requestCount);
      expect(
        fixture.requests.filter((request) => request.rpcMethod === 'server/discover'),
      ).toHaveLength(1);
      expect(fixture.requests.filter((request) => request.rpcMethod === 'initialize')).toHaveLength(
        1,
      );
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('reuses a full-key modern prior only before its TTL expires', async () => {
    let now = 1_000;
    const fixture = await startHttpFixture();
    const factory = new McpClientFactory({ priorTtlMs: 100, now: () => now });
    const input = {
      transport: 'http' as const,
      endpoint: fixture.endpoint,
      runtimeKey: runtimeKey(),
      signal: AbortSignal.timeout(5_000),
      timeout: 2_000,
    };
    try {
      const first = await factory.connect(input);
      const afterFirstConnect = fixture.requests.length;
      await factory.close(input.runtimeKey);

      const second = await factory.connect(input);
      expect(fixture.requests.length).toBe(afterFirstConnect);
      await factory.close(input.runtimeKey);

      now += 101;
      const third = await factory.connect(input);
      expect(fixture.requests.length).toBeGreaterThan(afterFirstConnect);
      await factory.close(input.runtimeKey);
      expect(first.adapter).not.toBe(second.adapter);
      expect(second.adapter).not.toBe(third.adapter);
    } finally {
      await fixture.close();
    }
  });

  test('invalidates and closes only prior credential generations in the same identity partition', async () => {
    const factory = new McpClientFactory();
    const oldKey = runtimeKey(1);
    const otherOrganization = { ...runtimeKey(1), organizationId: 'org-b' };
    const old = factory.createOwnedClient(oldKey);
    const untouched = factory.createOwnedClient(otherOrganization);

    await factory.invalidateCredentialGenerations({ ...oldKey, credentialGeneration: 2 });

    expect(factory.createOwnedClient(oldKey).adapter).not.toBe(old.adapter);
    expect(factory.createOwnedClient(otherOrganization).adapter).toBe(untouched.adapter);
  });

  test('forwards AuthProvider to the official transport for one 401 refresh retry', async () => {
    const fixture = await startHttpFixture({ expectedAuthorization: 'Bearer refreshed' });
    let refreshed = false;
    let tokenCalls = 0;
    let refreshCalls = 0;
    try {
      const factory = new McpClientFactory();
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: runtimeKey(),
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
        authProvider: {
          token: async () => {
            tokenCalls += 1;
            return refreshed ? 'refreshed' : 'stale';
          },
          onUnauthorized: async () => {
            refreshCalls += 1;
            refreshed = true;
          },
        },
      });
      expect(refreshCalls).toBe(1);
      expect(tokenCalls).toBeGreaterThanOrEqual(2);
      await owned.adapter.close();
    } finally {
      await fixture.close();
    }
  });

  test('does not cache a persistent 401 or create an SSE fallback', async () => {
    const fixture = await startHttpFixture({ expectedAuthorization: 'Bearer accepted' });
    let accepted = false;
    let refreshCalls = 0;
    let fallbackCalls = 0;
    const factory = new McpClientFactory({
      sseAdapter: {
        connect: async () => {
          fallbackCalls += 1;
          throw new Error('SSE fallback must not run for 401');
        },
      },
    });
    const key = runtimeKey();
    const input = {
      transport: 'http' as const,
      endpoint: fixture.endpoint,
      runtimeKey: key,
      signal: AbortSignal.timeout(5_000),
      timeout: 2_000,
      authProvider: {
        token: async () => (accepted ? 'accepted' : 'rejected'),
        onUnauthorized: async () => {
          refreshCalls += 1;
        },
      },
    };
    try {
      await expect(factory.connect(input)).rejects.toThrow();
      expect(refreshCalls).toBe(1);
      expect(fallbackCalls).toBe(0);

      accepted = true;
      await factory.connect(input);
      expect(fixture.requests.some((request) => request.rpcMethod === 'server/discover')).toBe(
        true,
      );
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('evicts a cancelled initial connection instead of returning its closed client', async () => {
    const fixture = startResponseFixture(200, '');
    const factory = new McpClientFactory();
    const key = runtimeKey();
    try {
      const initial = factory.createOwnedClient(key);
      await expect(
        factory.connect({
          transport: 'http',
          endpoint: fixture.endpoint,
          runtimeKey: key,
          signal: AbortSignal.abort(),
          timeout: 2_000,
        }),
      ).rejects.toThrow();
      const replacement = factory.createOwnedClient(key);
      expect(replacement.adapter).not.toBe(initial.adapter);
    } finally {
      await factory.close(key);
      fixture.close();
    }
  });
});

describe('official v2 Streamable HTTP fixtures', () => {
  test('negotiates modern HTTP and preserves every catalog and operation family', async () => {
    const fixture = await startHttpFixture();
    try {
      const factory = new McpClientFactory();
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: runtimeKey(),
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const adapter = owned.adapter;
      const discovered = await adapter.discover('source', 'c'.repeat(64), operationContext());
      expect(discovered.metadata.protocolEra).toBe('modern');
      expect(discovered.metadata.protocolVersion).toBe('2026-07-28');
      expect(discovered.tools.map((tool) => tool.canonicalName)).toEqual(['echo']);
      expect(discovered.resources.map((resource) => resource.uri)).toEqual(['fixture://report']);
      expect(discovered.resourceTemplates).toHaveLength(1);
      expect(discovered.resourceTemplates[0]).toMatchObject({
        uriTemplate: 'fixture://reports/{id}',
        name: 'report-by-id',
        title: 'Report by ID',
        mimeType: 'text/plain',
        meta: { fixture: true },
      });
      expect(discovered.prompts.map((prompt) => prompt.name)).toEqual(['greeting']);
      const tool = await adapter.callTool(
        discovered.tools[0]!,
        { value: 'hello' },
        operationContext(),
      );
      expect(tool).toMatchObject({
        structuredContent: { value: 'hello' },
        meta: { fixture: true },
      });
      const resource = await adapter.readResource('fixture://report', operationContext());
      expect(resource.contents).toEqual([
        { uri: 'fixture://report', mimeType: 'text/plain', text: 'fixture report' },
      ]);
      const prompt = await adapter.getPrompt('greeting', { name: 'Sentris' }, operationContext());
      expect(prompt.messages).toEqual([
        { role: 'user', content: { type: 'text', text: 'Hello Sentris' } },
      ]);
      expect(fixture.requests.length).toBeGreaterThan(4);
      expect(fixture.requests.every((request) => request.method === 'POST')).toBe(true);
      expect(fixture.requests.every((request) => request.sessionId === null)).toBe(true);
      expect(fixture.requests.every((request) => request.lastEventId === null)).toBe(true);
      expect(fixture.requests.every((request) => request.resumptionToken === null)).toBe(true);
      expect(fixture.requests.map((request) => request.rpcMethod)).toEqual(
        expect.arrayContaining([
          'server/discover',
          'tools/list',
          'resources/list',
          'resources/templates/list',
          'prompts/list',
          'tools/call',
          'resources/read',
          'prompts/get',
        ]),
      );
      await adapter.close();
    } finally {
      await fixture.close();
    }
  });

  test('connects to the same canonical client through initialize-era sessionful HTTP', async () => {
    const fixture = await startHttpFixture({ sessionful: true, legacyProtocolOnly: true });
    try {
      const owned = await new McpClientFactory().connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: runtimeKey(),
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      expect(discovered.metadata.protocolEra).toBe('legacy');
      expect(discovered.metadata.protocolVersion).toBe('2025-11-25');
      await owned.adapter.close();
    } finally {
      await fixture.close();
    }
  });

  test('fails a non-converging catalog at the public 64-page cap without returning partial discovery', async () => {
    const fixture = await startPaginationFixture();
    const factory = new McpClientFactory();
    const key = runtimeKey();
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      await expect(
        owned.adapter.discover('source', 'c'.repeat(64), operationContext()),
      ).rejects.toMatchObject({ code: SdkErrorCode.ListPaginationExceeded });
      expect(fixture.requests.filter((request) => request.rpcMethod === 'tools/list')).toHaveLength(
        64,
      );
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('cancels a real in-flight operation through its operation signal', async () => {
    const fixture = await startHttpFixture({ toolDelayMs: 500 });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    const controller = new AbortController();
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      const reason = new Error('operation cancelled');
      const invocation = owned.adapter.callTool(
        discovered.tools[0]!,
        { value: 'cancel' },
        {
          signal: controller.signal,
          idleTimeoutMs: 1_000,
          maxTotalTimeoutMs: 1_000,
        },
      );
      setTimeout(() => controller.abort(reason), 40);

      await expect(invocation).rejects.toMatchObject({
        code: SdkErrorCode.RequestTimeout,
        message: expect.stringContaining('operation cancelled'),
      });
      await waitForCondition(() => (fixture.operationState?.cancellations ?? 0) === 1);
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('enforces the real operation idle timeout without progress', async () => {
    const fixture = await startHttpFixture({ toolDelayMs: 500 });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      await expect(
        owned.adapter.callTool(
          discovered.tools[0]!,
          { value: 'idle' },
          {
            signal: AbortSignal.timeout(1_000),
            idleTimeoutMs: 50,
            maxTotalTimeoutMs: 1_000,
          },
        ),
      ).rejects.toMatchObject({ code: SdkErrorCode.RequestTimeout });
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('enforces maxTotalTimeout while real progress resets the idle timeout', async () => {
    const fixture = await startHttpFixture({
      toolProgress: { count: 20, intervalMs: 20 },
    });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    const progress: number[] = [];
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      await expect(
        owned.adapter.callTool(
          discovered.tools[0]!,
          { value: 'total' },
          {
            signal: AbortSignal.timeout(1_000),
            idleTimeoutMs: 500,
            maxTotalTimeoutMs: 130,
            progressReporter: (event) => progress.push(event.progress),
          },
        ),
      ).rejects.toMatchObject({ code: SdkErrorCode.RequestTimeout });
      expect(progress.length).toBeGreaterThan(0);
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });
});

describe('official v2 stdio fixture', () => {
  test('auto negotiation disposes one probe sibling and owns one live session child', async () => {
    const runtime = { ...runtimeKey(), transport: 'stdio' as const };
    const factory = new McpClientFactory();
    const tempDirectory = mkdtempSync(join(tmpdir(), 'sentris-mcp-stdio-'));
    const spawnLog = join(tempDirectory, 'spawns.log');
    let pids: number[] = [];
    try {
      const owned = await factory.connect({
        transport: 'stdio',
        command: process.execPath,
        args: ['-e', STDIO_FIXTURE_SCRIPT],
        cwd: `${process.cwd()}/worker`,
        env: { ...definedProcessEnvironment(), MCP_SPAWN_LOG: spawnLog },
        runtimeKey: runtime,
        signal: AbortSignal.timeout(10_000),
        timeout: 5_000,
      });
      pids = await waitForSpawnPids(spawnLog, 2);
      await waitForCondition(() => pids.filter(isProcessAlive).length === 1);
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      expect(discovered.metadata.protocolEra).toBe('modern');
      expect(discovered.tools.map((tool) => tool.canonicalName)).toEqual(['echo']);
    } finally {
      await factory.close(runtime);
      if (pids.length > 0) {
        await waitForCondition(() => pids.every((pid) => !isProcessAlive(pid)));
      }
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  test('drains high-volume stdio stderr without blocking startup or operations', async () => {
    const runtime = { ...runtimeKey(), transport: 'stdio' as const };
    const factory = new McpClientFactory();
    try {
      const owned = await factory.connect({
        transport: 'stdio',
        command: process.execPath,
        args: ['-e', STDIO_FIXTURE_SCRIPT],
        cwd: `${process.cwd()}/worker`,
        env: {
          ...definedProcessEnvironment(),
          MCP_STDERR_BYTES: String(1024 * 1024),
        },
        runtimeKey: runtime,
        signal: AbortSignal.timeout(10_000),
        timeout: 5_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      const result = await owned.adapter.callTool(discovered.tools[0]!, {}, operationContext());
      expect(result.content).toEqual([{ type: 'text', text: 'stdio' }]);
    } finally {
      await factory.close(runtime);
    }
  });
});

describe('initial HTTP SSE fallback classifier', () => {
  test('allows only legacy endpoint responses with blank or unrecognized bodies', () => {
    expect(isEligibleSseFallback({ status: 404, body: '' })).toBe(true);
    expect(isEligibleSseFallback({ status: 405, body: '<html>legacy</html>' })).toBe(true);
    expect(isEligibleSseFallback({ status: 401, body: '' })).toBe(false);
    expect(isEligibleSseFallback({ status: 500, body: '' })).toBe(false);
    expect(
      isEligibleSseFallback({
        status: 400,
        body: '{"jsonrpc":"2.0","error":{"code":-32600,"message":"modern"},"id":1}',
      }),
    ).toBe(false);
  });

  test('uses a fresh official v2 client and deprecated v2 SSE transport for frozen legacy SSE', async () => {
    const authProvider: AuthProvider = { token: async () => 'fixture-token' };
    const fixture = await startLegacySseFixture({
      expectedAuthorization: 'Bearer fixture-token',
    });
    const compatibility = new ObservedSseCompatibilityAdapter();
    const factory = new McpClientFactory({ sseAdapter: compatibility });
    const key = runtimeKey();
    const initial = factory.createOwnedClient(key);
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        authProvider,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());

      expect(owned.adapter).not.toBe(initial.adapter);
      expect(compatibility.clients).toHaveLength(1);
      expect(compatibility.transports).toHaveLength(1);
      expect(discovered.tools.map((tool) => tool.canonicalName)).toEqual(['legacy_echo']);
      expect(fixture.requests.map((request) => request.method)).toContain('GET');
      expect(fixture.requests.map((request) => request.method)).toContain('POST');
      expect(
        fixture.requests.every((request) => request.authorization === 'Bearer fixture-token'),
      ).toBe(true);
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('preserves cloned requestInit authentication headers across SSE fallback', async () => {
    const fixture = await startLegacySseFixture({
      expectedAuthorization: 'Bearer static-token',
    });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    const headers = new Headers({
      authorization: 'Bearer static-token',
      'x-sentris-fixture': 'preserved',
    });
    const requestInit: RequestInit = {
      headers,
      cache: 'no-store',
      method: 'PUT',
      body: 'caller-owned-body',
    };
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        requestInit,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      expect(
        fixture.requests.every((request) => request.authorization === 'Bearer static-token'),
      ).toBe(true);
      expect(headers.get('authorization')).toBe('Bearer static-token');
      expect(headers.get('x-sentris-fixture')).toBe('preserved');
      expect(fixture.requests.some((request) => request.method === 'GET')).toBe(true);
      await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('bounds persistent SSE unauthorized refresh to one callback', async () => {
    const fixture = await startLegacySseFixture({
      expectedAuthorization: 'Bearer never-accepted',
      authenticateFallbackRoutesOnly: true,
    });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    let refreshCalls = 0;
    try {
      await expect(
        factory.connect({
          transport: 'http',
          endpoint: fixture.endpoint,
          runtimeKey: key,
          authProvider: {
            token: async () => 'rejected',
            onUnauthorized: async ({ fetchFn }) => {
              refreshCalls += 1;
              const refreshResponse = await fetchFn('data:text/plain,refreshed');
              expect(refreshResponse.ok).toBe(true);
              if (refreshCalls >= 3) throw new Error('unbounded unauthorized refresh');
            },
          },
          signal: AbortSignal.timeout(2_000),
          timeout: 1_000,
        }),
      ).rejects.toBeDefined();
      expect(refreshCalls).toBe(1);
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('bounds hanging SSE startup by total timeout', async () => {
    const fixture = await startHangingLegacySseFixture();
    const factory = new McpClientFactory();
    const key = runtimeKey();
    try {
      await expect(
        factory.connect({
          transport: 'http',
          endpoint: fixture.endpoint,
          runtimeKey: key,
          signal: AbortSignal.timeout(1_000),
          timeout: 60,
        }),
      ).rejects.toMatchObject({ code: SdkErrorCode.RequestTimeout });
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('aborts hanging SSE startup with the caller reason', async () => {
    const fixture = await startHangingLegacySseFixture();
    const factory = new McpClientFactory();
    const key = runtimeKey();
    const controller = new AbortController();
    const reason = new Error('cancel SSE startup');
    try {
      const connection = factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: controller.signal,
        timeout: 1_000,
      });
      setTimeout(() => controller.abort(reason), 60);
      await expect(connection).rejects.toBe(reason);
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  test('does not publish an SSE fallback after the runtime key is closed', async () => {
    const fixture = await startLegacySseFixture({ fallbackStartDelayMs: 150 });
    const factory = new McpClientFactory();
    const key = runtimeKey();
    try {
      const connection = factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(2_000),
        timeout: 1_000,
      });
      await waitForCondition(() => fixture.requests.some((request) => request.method === 'GET'));
      await factory.close(key);

      await expect(connection).rejects.toBeDefined();
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });

  for (const rejection of [
    { name: 'authentication failures', status: 401, body: '' },
    {
      name: 'recognized modern JSON-RPC errors',
      status: 400,
      body: '{"jsonrpc":"2.0","error":{"code":-32600,"message":"modern"},"id":1}',
    },
    { name: 'arbitrary server failures', status: 503, body: 'unavailable' },
  ]) {
    test(`constructs no SSE fallback and evicts ownership for ${rejection.name}`, async () => {
      const fixture = startResponseFixture(rejection.status, rejection.body);
      const compatibility = new ObservedSseCompatibilityAdapter();
      const factory = new McpClientFactory({ sseAdapter: compatibility });
      const key = runtimeKey();
      const initial = factory.createOwnedClient(key);
      try {
        const failure = await captureConnectFailure(factory, fixture.endpoint, key);

        expect(failure).toBeDefined();
        expect(compatibility.clients).toHaveLength(0);
        expect(compatibility.transports).toHaveLength(0);
        expect(factory.createOwnedClient(key).adapter).not.toBe(initial.adapter);
      } finally {
        await factory.close(key);
        fixture.close();
      }
    });
  }

  test('constructs no SSE fallback after a timeout without a captured response', async () => {
    const fixture = startResponseFixture(200, '', 500);
    const compatibility = new ObservedSseCompatibilityAdapter();
    const factory = new McpClientFactory({ sseAdapter: compatibility });
    const key = runtimeKey();
    const initial = factory.createOwnedClient(key);
    try {
      const failure = await captureConnectFailure(factory, fixture.endpoint, key, 40);

      expect(failure).toBeDefined();
      expect(compatibility.clients).toHaveLength(0);
      expect(compatibility.transports).toHaveLength(0);
      expect(factory.createOwnedClient(key).adapter).not.toBe(initial.adapter);
    } finally {
      await factory.close(key);
      fixture.close();
    }
  });

  test('retries an ineligible connect failure with clean owned state', async () => {
    const rejected = startResponseFixture(401, 'unauthorized');
    const healthy = await startHttpFixture();
    const compatibility = new ObservedSseCompatibilityAdapter();
    const factory = new McpClientFactory({ sseAdapter: compatibility });
    const key = runtimeKey();
    const initial = factory.createOwnedClient(key);
    try {
      expect(await captureConnectFailure(factory, rejected.endpoint, key)).toBeDefined();
      rejected.close();

      const retried = await factory.connect({
        transport: 'http',
        endpoint: healthy.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await retried.adapter.discover(
        'source',
        'c'.repeat(64),
        operationContext(),
      );

      expect(retried.adapter).not.toBe(initial.adapter);
      expect(discovered.tools.map((tool) => tool.canonicalName)).toEqual(['echo']);
      expect(compatibility.clients).toHaveLength(0);
    } finally {
      await factory.close(key);
      rejected.close();
      await healthy.close();
    }
  });

  test('cleans a partial SSE client and retries with clean ownership after fallback fails', async () => {
    const rejected = startResponseFixture(405, '');
    const healthy = await startHttpFixture();
    const compatibility = new ObservedSseCompatibilityAdapter();
    const factory = new McpClientFactory({ sseAdapter: compatibility });
    const key = runtimeKey();
    const initial = factory.createOwnedClient(key);
    try {
      expect(await captureConnectFailure(factory, rejected.endpoint, key, 250)).toBeDefined();
      expect(compatibility.clients).toHaveLength(1);
      expect(compatibility.transports).toHaveLength(1);
      expect(compatibility.closedClients.has(compatibility.clients[0]!)).toBe(true);
      expect(compatibility.closedTransports.has(compatibility.transports[0]!)).toBe(true);
      rejected.close();

      const retried = await factory.connect({
        transport: 'http',
        endpoint: healthy.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await retried.adapter.discover(
        'source',
        'c'.repeat(64),
        operationContext(),
      );

      expect(retried.adapter).not.toBe(initial.adapter);
      expect(discovered.tools.map((tool) => tool.canonicalName)).toEqual(['echo']);
    } finally {
      await factory.close(key);
      rejected.close();
      await healthy.close();
    }
  });

  test('does not construct SSE fallback for a post-connect operation failure', async () => {
    const fixture = await startHttpFixture();
    const compatibility = new ObservedSseCompatibilityAdapter();
    const factory = new McpClientFactory({ sseAdapter: compatibility });
    const key = runtimeKey();
    try {
      const owned = await factory.connect({
        transport: 'http',
        endpoint: fixture.endpoint,
        runtimeKey: key,
        signal: AbortSignal.timeout(5_000),
        timeout: 2_000,
      });
      const discovered = await owned.adapter.discover('source', 'c'.repeat(64), operationContext());
      const missingTool = {
        ...discovered.tools[0]!,
        canonicalName: 'missing',
        source: { ...discovered.tools[0]!.source, upstreamName: 'missing' },
      };

      await expect(
        owned.adapter.callTool(missingTool, { value: 'hello' }, operationContext()),
      ).rejects.toBeDefined();
      expect(compatibility.clients).toHaveLength(0);
      expect(compatibility.transports).toHaveLength(0);
    } finally {
      await factory.close(key);
      await fixture.close();
    }
  });
});

class ObservedSseCompatibilityAdapter extends McpSseCompatibilityAdapter {
  readonly clients: Client[] = [];
  readonly transports: SSEClientTransport[] = [];
  readonly closedClients = new Set<Client>();
  readonly closedTransports = new Set<SSEClientTransport>();

  protected override createClient(
    cachePartition: string,
    responseCacheStore: InMemoryResponseCacheStore,
  ): Client {
    const client = super.createClient(cachePartition, responseCacheStore);
    const close = client.close.bind(client);
    client.close = async () => {
      this.closedClients.add(client);
      await close();
    };
    this.clients.push(client);
    return client;
  }

  protected override createTransport(
    endpoint: URL,
    authProvider?: AuthProvider,
  ): SSEClientTransport {
    const transport = super.createTransport(endpoint, authProvider);
    const close = transport.close.bind(transport);
    transport.close = async () => {
      this.closedTransports.add(transport);
      await close();
    };
    this.transports.push(transport);
    return transport;
  }
}

async function captureConnectFailure(
  factory: McpClientFactory,
  endpoint: URL,
  key: ReturnType<typeof runtimeKey>,
  timeout = 500,
): Promise<unknown> {
  let failure: unknown;
  try {
    await factory.connect({
      transport: 'http',
      endpoint,
      runtimeKey: key,
      signal: AbortSignal.timeout(timeout),
      timeout,
    });
  } catch (error: unknown) {
    failure = error;
  }
  return failure;
}

function startResponseFixture(status: number, body: string, delayMs = 0) {
  const listener = Bun.serve({
    port: 0,
    async fetch() {
      if (delayMs > 0) await Bun.sleep(delayMs);
      return new Response(body, {
        status,
        headers: { 'content-type': body.startsWith('{') ? 'application/json' : 'text/plain' },
      });
    },
  });
  return {
    endpoint: new URL(`http://127.0.0.1:${listener.port}/mcp`),
    close: () => listener.stop(true),
  };
}

function definedProcessEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

async function waitForSpawnPids(path: string, expected: number): Promise<number[]> {
  let pids: number[] = [];
  await waitForCondition(() => {
    if (!existsSync(path)) return false;
    pids = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('start:'))
      .map((line) => Number(line.slice('start:'.length)))
      .filter(Number.isInteger);
    return new Set(pids).size === expected;
  });
  return [...new Set(pids)];
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForCondition(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for MCP fixture lifecycle condition');
    }
    await Bun.sleep(20);
  }
}
