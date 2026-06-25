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
  endpoint: 'http://localhost:4100/mcp',
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

describe('MCP discovery activity diagnostics', () => {
  beforeAll(async () => {
    ({ cacheDiscoveryResultActivity, discoverMcpToolsActivity, discoverMcpGroupToolsActivity } =
      await import('../mcp-discovery.activity'));
  });

  beforeEach(() => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
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
  });

  test('cacheDiscoveryResultActivity does not mirror successful cache diagnostics to console.log by default', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

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
    expect(options).toEqual({
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

  test('discoverMcpGroupToolsActivity does not mirror successful stdio readiness diagnostics to console.log by default', async () => {
    globalThis.fetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const href = String(url);
      if (href.endsWith('/health')) {
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
