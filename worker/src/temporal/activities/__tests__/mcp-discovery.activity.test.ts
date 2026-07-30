import { afterEach, beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';

const redisSetex = vi.fn(async (_key: string, _ttlSeconds: number, _value: string) => 'OK');
const redisGet = vi.fn(async (_key: string): Promise<string | null> => null);
const mockHeartbeat = vi.fn();

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
let discoverMcpToolsActivity: typeof import('../mcp-discovery.activity').discoverMcpToolsActivity;
let discoverMcpGroupToolsActivity: typeof import('../mcp-discovery.activity').discoverMcpGroupToolsActivity;

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
    ({ cacheDiscoveryResultActivity, discoverMcpToolsActivity, discoverMcpGroupToolsActivity } =
      await import('../mcp-discovery.activity'));
  });

  beforeEach(() => {
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
      endpoint: 'https://example.test/mcp',
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
    expect(String(url)).toBe('https://example.test/mcp');
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
