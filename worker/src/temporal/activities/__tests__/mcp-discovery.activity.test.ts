import { afterEach, beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';
import type {
  McpCatalog,
  McpRuntimeAcquisition,
  McpRuntimeKey,
  McpRuntimeRef,
} from '@sentris/shared';
import type { McpRuntimeRouter } from '../../../mcp-runtime/mcp-runtime-router';

const redisSetex = vi.fn(async (_key: string, _ttlSeconds: number, _value: string) => 'OK');
const redisGet = vi.fn(async (_key: string): Promise<string | null> => null);
const mockHeartbeat = vi.fn();
let mockCancellationSignal = new AbortController().signal;
const mockActivityInfo = {
  activityId: 'saved-mcp-discovery-activity',
  attempt: 1,
  workflowExecution: {
    workflowId: 'saved-mcp-discovery-workflow',
    runId: '44444444-4444-4444-8444-444444444444',
  },
};

interface MockMcpDockerServerInput {
  context: {
    logger: {
      debug: (...args: unknown[]) => void;
      info: (...args: unknown[]) => void;
    };
  };
}

const mockStartMcpDockerServer = vi.fn(async (_input: MockMcpDockerServerInput) => ({
  endpoint: 'http://worker:9101/containers/mcp-container-1/mcp',
  authToken: 'worker-proxy-token',
  containerId: 'mcp-container-1',
}));
const mockExecFile = vi.fn(
  (
    _file: string,
    _args: string[],
    callback?: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback?.(null, '', '');
  },
);
const mockSpawn = vi.fn();
const mockMcpConnect = vi.fn(async (_transport: unknown) => undefined);
const mockMcpListTools = vi.fn(async () => ({
  tools: [{ name: 'list_buckets', description: 'List storage buckets', inputSchema: {} }],
}));
const mockMcpClose = vi.fn(async () => undefined);
const mockMcpTransport = vi.fn((_url: URL, _options?: unknown) => ({}));
const mockStartMcpStdioHostProxy = vi.fn(async () => ({
  endpoint: 'http://127.0.0.1:4101/mcp',
  proxyId: 'host-mcp-proxy-test',
}));
const mockStopMcpStdioHostProxy = vi.fn(async () => true);

class MockMcpClient {
  connect = mockMcpConnect;
  listTools = mockMcpListTools;
  close = mockMcpClose;
}

class MockRedis {
  setex = redisSetex;
  get = redisGet;
}

class MockApplicationFailure extends Error {
  type: string;
  nonRetryable: boolean;
  details?: unknown[];

  constructor(message: string, type: string, nonRetryable: boolean, details?: unknown[]) {
    super(message);
    this.name = 'ApplicationFailure';
    this.type = type;
    this.nonRetryable = nonRetryable;
    this.details = details;
  }

  static nonRetryable(message: string, type: string, details?: unknown[]) {
    return new MockApplicationFailure(message, type, true, details);
  }

  static retryable(message: string, type: string, details?: unknown[]) {
    return new MockApplicationFailure(message, type, false, details);
  }
}

mock.module('ioredis', () => ({
  default: MockRedis,
}));

mock.module('@temporalio/activity', () => ({
  ApplicationFailure: MockApplicationFailure,
  Context: {
    current: () => ({
      heartbeat: mockHeartbeat,
      cancellationSignal: mockCancellationSignal,
      info: mockActivityInfo,
    }),
  },
}));

mock.module('../../../components/core/mcp-runtime', () => ({
  startMcpDockerServer: mockStartMcpDockerServer,
}));

mock.module('../../../components/core/mcp-stdio-host-proxy', () => ({
  MCP_STDIO_HOST_PROXY_HOST: '127.0.0.1',
  isMcpStdioHostProxyId: (containerId: string) => containerId.startsWith('host-mcp-proxy-'),
  startMcpStdioHostProxy: mockStartMcpStdioHostProxy,
  stopMcpStdioHostProxy: mockStopMcpStdioHostProxy,
}));

mock.module('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockMcpClient,
}));

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mockMcpTransport,
}));

const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;
const originalTrustedLocalStdio = process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO;
const originalTrustProfile = process.env.SENTRIS_TRUST_PROFILE;
const originalFetch = globalThis.fetch;
let cacheDiscoveryResultActivity: typeof import('../mcp-discovery.activity').cacheDiscoveryResultActivity;
let discoverSavedMcpRuntimeActivity: typeof import('../mcp-discovery.activity').discoverSavedMcpRuntimeActivity;
let discoverMcpToolsActivity: typeof import('../mcp-discovery.activity').discoverMcpToolsActivity;
let discoverMcpGroupToolsActivity: typeof import('../mcp-discovery.activity').discoverMcpGroupToolsActivity;
let initializeMcpRuntimeDiscoveryActivities: typeof import('../mcp-discovery.activity').initializeMcpRuntimeDiscoveryActivities;

const savedRuntimeKey: McpRuntimeKey = {
  sourceId: 'mcp-server:server-1',
  transport: 'http',
  configFingerprint: 'a'.repeat(64),
  organizationId: 'organization-a',
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: 'mcp-server:server-1',
  credentialGeneration: 7,
};

const savedRuntimeRef: McpRuntimeRef = {
  state: 'ready',
  fence: {
    runtimeId: '11111111-1111-4111-8111-111111111111',
    ownerId: 'worker-owner-a',
    ownerEpoch: '22222222-2222-4222-8222-222222222222',
    leaseGeneration: 3,
  },
  ownerAddress: 'http://worker-owner-a:9301',
  leaseExpiresAt: '2099-08-01T12:00:00.000Z',
  protocolEra: 'modern',
  protocolVersion: '2026-07-28',
  capabilityFingerprint: 'c'.repeat(64),
};
const savedRuntimeAcquisition: McpRuntimeAcquisition = {
  ref: savedRuntimeRef as McpRuntimeAcquisition['ref'],
  holderId: '33333333-3333-4333-8333-333333333333',
};

const savedCatalog: McpCatalog = {
  protocolEra: 'modern',
  protocolVersion: '2026-07-28',
  capabilityFingerprint: 'c'.repeat(64),
  tools: [
    {
      canonicalName: 'mcp_server_1.search',
      displayName: 'Search',
      description: 'Search the upstream service',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
      source: {
        kind: 'mcp',
        sourceId: 'mcp-server:server-1',
        serverId: 'server-1',
        upstreamName: 'search',
        bindingFingerprint: 'd'.repeat(64),
      },
      effects: 'read-only',
      effectsSource: 'mcp-annotation',
      retryPolicy: 'reviewed-idempotent',
    },
  ],
  resources: [
    {
      sourceId: 'mcp-server:server-1',
      uri: 'sentris://reports/latest',
      name: 'Latest report',
      mimeType: 'application/json',
    },
  ],
  resourceTemplates: [
    {
      sourceId: 'mcp-server:server-1',
      uriTemplate: 'sentris://reports/{id}',
      name: 'Report',
      mimeType: 'application/json',
    },
  ],
  prompts: [
    {
      sourceId: 'mcp-server:server-1',
      name: 'summarize_report',
      arguments: [{ name: 'reportId', required: true }],
    },
  ],
};

function createJsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

function getDiscoveryFetch(): typeof fetch {
  const [, options] = mockMcpTransport.mock.calls.at(-1) as [URL, { fetch?: typeof fetch }];
  if (!options.fetch) {
    throw new Error('MCP transport did not receive a custom fetch');
  }
  return options.fetch;
}

async function prepareDiscoveryFetch(): Promise<typeof fetch> {
  await discoverMcpToolsActivity({
    transport: 'http',
    endpoint: 'http://93.184.216.34/mcp',
  });
  return getDiscoveryFetch();
}

describe('MCP discovery activity diagnostics', () => {
  beforeAll(async () => {
    ({
      cacheDiscoveryResultActivity,
      discoverSavedMcpRuntimeActivity,
      discoverMcpToolsActivity,
      discoverMcpGroupToolsActivity,
      initializeMcpRuntimeDiscoveryActivities,
    } = await import('../mcp-discovery.activity'));
  });

  beforeEach(() => {
    mockCancellationSignal = new AbortController().signal;
    mockActivityInfo.attempt = 1;
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    delete process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO;
    delete process.env.SENTRIS_TRUST_PROFILE;
    vi.clearAllMocks();
    mockMcpListTools.mockResolvedValue({
      tools: [{ name: 'list_buckets', description: 'List storage buckets', inputSchema: {} }],
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDebugWorkflow === undefined) {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;
    } else {
      process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
    }
    if (originalTrustedLocalStdio === undefined) {
      delete process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO;
    } else {
      process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO = originalTrustedLocalStdio;
    }
    if (originalTrustProfile === undefined) {
      delete process.env.SENTRIS_TRUST_PROFILE;
    } else {
      process.env.SENTRIS_TRUST_PROFILE = originalTrustProfile;
    }
  });

  test('cacheDiscoveryResultActivity does not mirror successful cache diagnostics to console.log by default', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    redisGet.mockResolvedValueOnce(
      JSON.stringify({
        status: 'pending',
        workflowId: 'workflow-1',
        organizationId: 'organization-a',
      }),
    );

    try {
      await cacheDiscoveryResultActivity({
        cacheToken: 'cache-token-1',
        workflowId: 'workflow-1',
        tools: [{ name: 'http_request', description: 'Makes HTTP requests' }],
      });

      expect(redisSetex).toHaveBeenCalledTimes(1);
      const [key, ttlSeconds, rawValue] = redisSetex.mock.calls[0];
      expect(key).toBe('mcp-discovery:cache-token-1');
      expect(ttlSeconds).toBe(300);
      expect(JSON.parse(rawValue as string)).toMatchObject({
        status: 'completed',
        workflowId: 'workflow-1',
        organizationId: 'organization-a',
        toolCount: 1,
      });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test('discovers a saved server through the runtime router without leaking runtime ownership', async () => {
    const acquire = vi.fn(
      async (_runtimeKey: McpRuntimeKey, _holderId: string, _signal: AbortSignal) => ({
        ...savedRuntimeAcquisition,
        testOnlySecret: 'must-not-cross-the-activity-boundary',
      }),
    );
    const execute = vi.fn(async (_ref: McpRuntimeAcquisition, operation: { kind: string }) =>
      operation.kind === 'discover' ? savedCatalog : undefined,
    );
    initializeMcpRuntimeDiscoveryActivities({ acquire, execute } as unknown as McpRuntimeRouter);

    const result = await discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey });

    expect(acquire).toHaveBeenCalledWith(
      savedRuntimeKey,
      expect.any(String),
      mockCancellationSignal,
    );
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining(savedRuntimeAcquisition),
      { kind: 'discover' },
      mockCancellationSignal,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining(savedRuntimeAcquisition),
      { kind: 'release' },
      expect.any(AbortSignal),
    );
    expect(mockHeartbeat.mock.calls).toEqual([
      ['mcp-runtime:acquire'],
      ['mcp-runtime:discover'],
      ['mcp-runtime:catalog-ready'],
      ['mcp-runtime:release'],
    ]);
    expect(result).toEqual({ catalog: savedCatalog });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('worker-owner-a');
    expect(serialized).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(serialized).not.toContain('must-not-cross-the-activity-boundary');
    expect(result).not.toHaveProperty('runtimeRef');
    expect(result).not.toHaveProperty('ownerAddress');
    expect(result).not.toHaveProperty('fence');
  });

  test('passes Temporal activity cancellation to saved-server discovery', async () => {
    const cancellation = new Error('Temporal activity cancelled');
    const controller = new AbortController();
    mockCancellationSignal = controller.signal;
    controller.abort(cancellation);
    const acquire = vi.fn(
      async (_runtimeKey: McpRuntimeKey, _holderId: string, signal: AbortSignal) => {
        if (signal.aborted) throw signal.reason;
        return savedRuntimeAcquisition;
      },
    );
    const execute = vi.fn(async () => savedCatalog);
    initializeMcpRuntimeDiscoveryActivities({ acquire, execute } as unknown as McpRuntimeRouter);

    await expect(discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey })).rejects.toBe(
      cancellation,
    );

    expect(acquire).toHaveBeenCalledWith(savedRuntimeKey, expect.any(String), controller.signal);
    expect(execute).not.toHaveBeenCalled();
  });

  test('releases each successful saved discovery so repeated checks do not accumulate runtimes', async () => {
    const acquire = vi.fn(
      async (_runtimeKey: McpRuntimeKey, _holderId: string, _signal: AbortSignal) =>
        savedRuntimeAcquisition,
    );
    const operations: string[] = [];
    const execute = vi.fn(async (_ref: McpRuntimeAcquisition, operation: { kind: string }) => {
      operations.push(operation.kind);
      return operation.kind === 'discover' ? savedCatalog : undefined;
    });
    initializeMcpRuntimeDiscoveryActivities({ acquire, execute } as unknown as McpRuntimeRouter);

    await discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey });
    await discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey });

    expect(operations).toEqual(['discover', 'release', 'discover', 'release']);
    expect(acquire.mock.calls[0]?.[1]).toBe(acquire.mock.calls[1]?.[1]);
  });

  test('uses a new holder incarnation when Temporal retries after a lost release response', async () => {
    const holderIds: string[] = [];
    const acquire = vi.fn(
      async (_runtimeKey: McpRuntimeKey, holderId: string, _signal: AbortSignal) => {
        holderIds.push(holderId);
        return { ...savedRuntimeAcquisition, holderId };
      },
    );
    let releaseCalls = 0;
    const execute = vi.fn(async (_ref: McpRuntimeAcquisition, operation: { kind: string }) => {
      if (operation.kind === 'discover') return savedCatalog;
      releaseCalls += 1;
      if (releaseCalls === 1) throw new Error('release response was lost');
      return undefined;
    });
    initializeMcpRuntimeDiscoveryActivities({ acquire, execute } as unknown as McpRuntimeRouter);

    await expect(discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey })).rejects.toThrow(
      'release response was lost',
    );
    mockActivityInfo.attempt = 2;
    await expect(discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey })).resolves.toEqual(
      { catalog: savedCatalog },
    );

    expect(holderIds).toHaveLength(2);
    expect(holderIds[0]).not.toBe(holderIds[1]);
  });

  test('serializes holder keepalives and stops them before fenced release', async () => {
    const discoveryStarted = testDeferred<undefined>();
    const finishDiscovery = testDeferred<McpCatalog>();
    const operations: string[] = [];
    let touchInFlight = false;
    let overlappingTouches = false;
    const shortLeaseAcquisition: McpRuntimeAcquisition = {
      ...savedRuntimeAcquisition,
      ref: {
        ...savedRuntimeAcquisition.ref,
        leaseExpiresAt: new Date(Date.now() + 45).toISOString(),
      },
    };
    const acquire = vi.fn(async () => shortLeaseAcquisition);
    const execute = vi.fn(
      async (_ref: McpRuntimeAcquisition, operation: { kind: string }): Promise<unknown> => {
        operations.push(operation.kind);
        if (operation.kind === 'discover') {
          discoveryStarted.resolve(undefined);
          return finishDiscovery.promise;
        }
        if (operation.kind === 'touch') {
          if (touchInFlight) overlappingTouches = true;
          touchInFlight = true;
          await new Promise((resolve) => setTimeout(resolve, 5));
          touchInFlight = false;
          return {
            ...shortLeaseAcquisition.ref,
            leaseExpiresAt: new Date(Date.now() + 45).toISOString(),
          };
        }
        return undefined;
      },
    );
    initializeMcpRuntimeDiscoveryActivities({ acquire, execute } as unknown as McpRuntimeRouter);

    const activity = discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey });
    await discoveryStarted.promise;
    try {
      await waitForTestCondition(() => operations.includes('touch'));
    } finally {
      finishDiscovery.resolve(savedCatalog);
    }
    const activityOutcome = await Promise.race([
      activity,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`activity did not settle; operations=${operations.join(',')}`)),
          500,
        ),
      ),
    ]);
    expect(activityOutcome).toEqual({ catalog: savedCatalog });
    const operationsAtCompletion = [...operations];
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(overlappingTouches).toBe(false);
    expect(operationsAtCompletion.at(-1)).toBe('release');
    expect(operations).toEqual(operationsAtCompletion);
  });

  test('does not mask a discovery failure when fenced release also fails', async () => {
    const primaryFailure = new Error('catalog discovery failed');
    const cleanupFailure = new Error('fenced release failed');
    const acquire = vi.fn(async () => savedRuntimeAcquisition);
    const execute = vi.fn(async (_ref: McpRuntimeAcquisition, operation: { kind: string }) => {
      if (operation.kind === 'discover') throw primaryFailure;
      throw cleanupFailure;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    initializeMcpRuntimeDiscoveryActivities({ acquire, execute } as unknown as McpRuntimeRouter);

    try {
      await expect(discoverSavedMcpRuntimeActivity({ runtimeKey: savedRuntimeKey })).rejects.toBe(
        primaryFailure,
      );
      expect(execute.mock.calls.map(([, operation]) => operation)).toEqual([
        { kind: 'discover' },
        { kind: 'release' },
      ]);
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('discoverMcpToolsActivity uses the MCP SDK for HTTP tool discovery', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('raw MCP fetch should not be used for HTTP discovery');
    }) as unknown as typeof fetch;
    mockMcpListTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'fetch_url',
          description: 'Fetches a URL',
          inputSchema: { type: 'object' },
        },
      ],
    });

    const result = await discoverMcpToolsActivity({
      transport: 'http',
      endpoint: 'http://93.184.216.34/mcp',
      headers: { Authorization: 'Bearer token' },
    });

    expect(result.tools).toEqual([
      {
        name: 'fetch_url',
        description: 'Fetches a URL',
        inputSchema: { type: 'object' },
      },
    ]);
    expect(mockMcpTransport).toHaveBeenCalledTimes(1);
    const [url, options] = mockMcpTransport.mock.calls[0];
    expect(String(url)).toBe('http://93.184.216.34/mcp');
    expect(options).toMatchObject({
      requestInit: {
        headers: {
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer token',
        },
      },
    });
    expect(mockMcpConnect).toHaveBeenCalledTimes(1);
    expect(mockMcpListTools).toHaveBeenCalledTimes(1);
    expect(mockMcpClose).toHaveBeenCalledTimes(1);
  });

  test('rejects stdio discovery unless trusted-local host execution is explicitly enabled', async () => {
    await expect(
      discoverMcpToolsActivity({
        transport: 'stdio',
        command: 'arbitrary-user-supplied-command',
      }),
    ).rejects.toThrow(
      'MCP same-worker loopback stdio discovery requires the trusted-local profile and MCP_DISCOVERY_TRUSTED_LOCAL_STDIO=true',
    );

    expect(mockStartMcpStdioHostProxy).not.toHaveBeenCalled();
  });

  test('runs trusted-local stdio discovery when explicitly enabled', async () => {
    process.env.SENTRIS_TRUST_PROFILE = 'trusted-local';
    process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO = 'true';
    globalThis.fetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('/health')) {
        return createJsonResponse({ status: 'ok', servers: [{ ready: true }] });
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    }) as unknown as typeof fetch;

    const result = await discoverMcpToolsActivity({
      transport: 'stdio',
      command: 'trusted-mcp-server',
    });

    expect(mockStartMcpStdioHostProxy).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'trusted-mcp-server' }),
    );
    expect(result.tools).toHaveLength(1);
    expect(mockHeartbeat).toHaveBeenCalledWith('host-proxy-started');
    expect(mockHeartbeat).toHaveBeenCalledWith('host-proxy-ready');
    expect(mockStopMcpStdioHostProxy).toHaveBeenCalledWith('host-mcp-proxy-test');
  });

  test('rejects same-worker stdio discovery when hardened even if the flag is set', async () => {
    process.env.SENTRIS_TRUST_PROFILE = 'hardened';
    process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO = 'true';

    await expect(
      discoverMcpToolsActivity({
        transport: 'stdio',
        command: 'must-not-start',
      }),
    ).rejects.toThrow('requires the trusted-local profile');

    expect(mockStartMcpStdioHostProxy).not.toHaveBeenCalled();
  });

  test('blocks a private HTTP MCP endpoint before constructing an MCP transport', async () => {
    await expect(
      discoverMcpToolsActivity({
        transport: 'http',
        endpoint: 'http://127.0.0.1:3000/mcp',
      }),
    ).rejects.toThrow(/SSRF blocked/);

    expect(mockMcpTransport).not.toHaveBeenCalled();
  });

  test('validates redirect targets before an HTTP MCP request follows them', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1:3000/private' },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await discoverMcpToolsActivity({
      transport: 'http',
      endpoint: 'http://93.184.216.34/mcp',
    });

    const discoveryFetch = getDiscoveryFetch();
    await expect(discoveryFetch('http://93.184.216.34/mcp')).rejects.toThrow(/SSRF blocked/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  for (const status of [301, 302]) {
    test(`changes POST to GET and drops its body/content headers after ${status}`, async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status, headers: { location: '/redirected' } }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const discoveryFetch = await prepareDiscoveryFetch();

      await discoveryFetch('http://93.184.216.34/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer same-origin',
          'Content-Type': 'application/json',
          'Content-Length': '2',
          'X-Keep': 'yes',
        },
        body: '{}',
      });

      const [redirectedUrl, redirectedInit] = fetchSpy.mock.calls[1];
      const redirectedHeaders = new Headers(redirectedInit?.headers);
      expect(String(redirectedUrl)).toBe('http://93.184.216.34/redirected');
      expect(redirectedInit?.method).toBe('GET');
      expect(redirectedInit?.body).toBeUndefined();
      expect(redirectedHeaders.get('content-type')).toBeNull();
      expect(redirectedHeaders.get('content-length')).toBeNull();
      expect(redirectedHeaders.get('authorization')).toBe('Bearer same-origin');
      expect(redirectedHeaders.get('x-keep')).toBe('yes');
    });
  }

  test('changes a non-HEAD request to GET after 303', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 303, headers: { location: '/redirected' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const discoveryFetch = await prepareDiscoveryFetch();

    await discoveryFetch('http://93.184.216.34/mcp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const [, redirectedInit] = fetchSpy.mock.calls[1];
    expect(redirectedInit?.method).toBe('GET');
    expect(redirectedInit?.body).toBeUndefined();
    expect(new Headers(redirectedInit?.headers).get('content-type')).toBeNull();
  });

  test('preserves GET and its representation headers after 303', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 303, headers: { location: '/redirected' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const discoveryFetch = await prepareDiscoveryFetch();

    await discoveryFetch('http://93.184.216.34/mcp', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Content-Language': 'en',
        'X-Keep': 'yes',
      },
    });

    const [, redirectedInit] = fetchSpy.mock.calls[1];
    const redirectedHeaders = new Headers(redirectedInit?.headers);
    expect(redirectedInit?.method).toBe('GET');
    expect(redirectedHeaders.get('content-type')).toBe('application/json');
    expect(redirectedHeaders.get('content-language')).toBe('en');
    expect(redirectedHeaders.get('x-keep')).toBe('yes');
  });

  for (const status of [300, 304, 305, 306, 309, 399]) {
    test(`does not follow non-redirect status ${status} even when Location is present`, async () => {
      const fetchSpy = vi.fn(
        async () =>
          new Response(null, {
            status,
            headers: { location: '/must-not-be-followed' },
          }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const discoveryFetch = await prepareDiscoveryFetch();

      const response = await discoveryFetch('http://93.184.216.34/mcp');

      expect(response.status).toBe(status);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  }

  for (const status of [307, 308]) {
    test(`preserves method and body after ${status}`, async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status, headers: { location: '/redirected' } }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const discoveryFetch = await prepareDiscoveryFetch();

      await discoveryFetch('http://93.184.216.34/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
      });

      const [, redirectedInit] = fetchSpy.mock.calls[1];
      expect(redirectedInit?.method).toBe('POST');
      expect(redirectedInit?.body).toBe('{"ok":true}');
      expect(new Headers(redirectedInit?.headers).get('content-type')).toBe('application/json');
    });
  }

  test('strips caller-supplied credential headers on cross-origin redirects', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'http://93.184.216.35/redirected' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const discoveryFetch = await prepareDiscoveryFetch();

    await discoveryFetch('http://93.184.216.34/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        'Proxy-Authorization': 'Basic secret',
        'X-API-Key': 'api-key-secret',
        'Api-Key': 'alternate-api-key-secret',
        'X-Auth-Token': 'token-secret',
        'X-Custom-Authentication': 'custom-secret',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    const [, redirectedInit] = fetchSpy.mock.calls[1];
    const redirectedHeaders = new Headers(redirectedInit?.headers);
    expect(redirectedHeaders.get('authorization')).toBeNull();
    expect(redirectedHeaders.get('cookie')).toBeNull();
    expect(redirectedHeaders.get('proxy-authorization')).toBeNull();
    expect(redirectedHeaders.get('x-api-key')).toBeNull();
    expect(redirectedHeaders.get('api-key')).toBeNull();
    expect(redirectedHeaders.get('x-auth-token')).toBeNull();
    expect(redirectedHeaders.get('x-custom-authentication')).toBeNull();
    expect(redirectedHeaders.get('accept')).toBe('application/json, text/event-stream');
    expect(redirectedHeaders.get('content-type')).toBe('application/json');
  });

  test('stops after five followed redirects', async () => {
    let redirect = 0;
    const fetchSpy = vi.fn(async () => {
      redirect += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `/redirect-${redirect}` },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const discoveryFetch = await prepareDiscoveryFetch();

    await expect(discoveryFetch('http://93.184.216.34/mcp')).rejects.toThrow(
      'MCP discovery exceeded 5 HTTP redirects',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  test('preserves method, headers, and body from a Request input', async () => {
    const fetchSpy = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response('ok', { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const discoveryFetch = await prepareDiscoveryFetch();
    const request = new Request('http://93.184.216.34/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request': 'yes' },
      body: '{"request":true}',
    });

    await discoveryFetch(request);

    const [, requestInit] = fetchSpy.mock.calls[0];
    expect(requestInit?.method).toBe('POST');
    expect(new Headers(requestInit?.headers).get('x-request')).toBe('yes');
    expect(requestInit?.body).toBeDefined();
  });

  test('discoverMcpGroupToolsActivity does not mirror successful stdio readiness diagnostics to console.log by default', async () => {
    globalThis.fetch = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/health')) {
        expect(new Headers(init?.headers).get('x-sentris-mcp-proxy-token')).toBe(
          'worker-proxy-token',
        );
        return createJsonResponse({
          status: 'ok',
          servers: [{ ready: true }],
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const result = await discoverMcpGroupToolsActivity({
        servers: [
          {
            name: 'storage',
            transport: 'stdio',
            command: 'storage-mcp',
          },
        ],
      });

      expect(result.results).toEqual([
        {
          name: 'storage',
          tools: [{ name: 'list_buckets', description: 'List storage buckets', inputSchema: {} }],
        },
      ]);
      expect(mockStartMcpDockerServer).toHaveBeenCalledTimes(1);
      expect(mockMcpTransport).toHaveBeenCalledWith(
        new URL('http://worker:9101/containers/mcp-container-1/servers/storage/sse'),
        expect.objectContaining({
          requestInit: expect.objectContaining({
            headers: expect.objectContaining({
              'x-sentris-mcp-proxy-token': 'worker-proxy-token',
            }),
          }),
        }),
      );
      expect(mockExecFile.mock.calls[0]?.[0]).toBe('docker');
      expect(mockExecFile.mock.calls[0]?.[1]).toEqual(['rm', '-f', 'mcp-container-1']);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test('discoverMcpGroupToolsActivity does not mirror docker info/debug collector logs to console by default', async () => {
    mockStartMcpDockerServer.mockImplementationOnce(async (input: MockMcpDockerServerInput) => {
      input.context.logger.info('stdio proxy started');
      input.context.logger.debug('stdio proxy details');
      return {
        endpoint: 'http://localhost:4100/mcp',
        authToken: 'worker-proxy-token',
        containerId: 'mcp-container-1',
      };
    });
    globalThis.fetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const href = String(url);
      if (href.endsWith('/health')) {
        return createJsonResponse({
          status: 'ok',
          servers: [{ ready: true }],
        });
      }
      return createJsonResponse({
        result: {
          tools: [{ name: 'list_buckets', description: 'List storage buckets' }],
        },
      });
    }) as unknown as typeof fetch;
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    try {
      await discoverMcpGroupToolsActivity({
        servers: [
          {
            name: 'storage',
            transport: 'stdio',
            command: 'storage-mcp',
          },
        ],
      });

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
      consoleDebugSpy.mockRestore();
    }
  });
});

function testDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForTestCondition(predicate: () => boolean, timeoutMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for activity test condition');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
