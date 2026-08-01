import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext } from '@sentris/component-sdk';
import type { McpServer, PersistedMcpTool } from '../mcp-library-utils';

const originalFetch = globalThis.fetch;
const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

const mockStartMcpStdioHostProxy = vi.fn(async () => ({
  endpoint: 'http://localhost:3000/mcp',
  proxyId: 'host-mcp-proxy-test',
}));
const mockStopMcpStdioHostProxy = vi.fn(async () => true);

vi.mock('../mcp-stdio-host-proxy', () => ({
  startMcpStdioHostProxy: mockStartMcpStdioHostProxy,
  stopMcpStdioHostProxy: mockStopMcpStdioHostProxy,
}));

const mockConnect = vi.fn(async () => {});
const mockListTools = vi.fn(async () => ({
  tools: [
    {
      name: 'ping',
      title: 'Ping target',
      description: 'Ping a target',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { target: { type: 'string' } },
        unevaluatedProperties: false,
      },
      outputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { reachable: { type: 'boolean' } },
      },
      icons: [
        {
          src: 'https://example.test/ping.svg',
          mimeType: 'image/svg+xml',
          sizes: ['any'],
          theme: 'dark',
        },
      ],
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: { 'com.example/source': 'worker-library' },
    },
  ],
}));
const mockClose = vi.fn(async () => {});

class MockClient {
  connect = mockConnect;
  listTools = mockListTools;
  close = mockClose;
}

const mockTransport = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mockTransport,
}));

import {
  buildMcpToolExclusionKey,
  filterMcpToolsForServer,
  registerServerTools,
} from '../mcp-library-utils';

const liveTools = [
  {
    name: 'ping',
    description: 'Ping a target',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'status',
    description: 'Read status',
    inputSchema: { type: 'object', properties: {} },
  },
];

function persistedTool(serverId: string, toolName: string, enabled: boolean): PersistedMcpTool {
  return {
    id: `${serverId}-${toolName}`,
    toolName,
    description: null,
    inputSchema: null,
    serverId,
    serverName: serverId,
    enabled,
    discoveredAt: '2026-07-31T00:00:00.000Z',
  };
}

const stdioServer: McpServer = {
  id: 'stdio-server',
  name: 'STDIO Server',
  description: null,
  transportType: 'stdio',
  endpoint: null,
  command: 'example-mcp',
  args: [],
  hasHeaders: false,
  headerKeys: null,
  enabled: true,
  healthCheckUrl: null,
  lastHealthCheck: null,
  lastHealthStatus: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

describe('mcp-library-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKEND_URL = 'http://backend.test';
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDebugWorkflow === undefined) {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;
    } else {
      process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
    }
    vi.restoreAllMocks();
  });

  test('removes live tools disabled in persisted server records', () => {
    const result = filterMcpToolsForServer('server-a', liveTools, [
      persistedTool('server-a', 'ping', false),
      persistedTool('server-a', 'status', true),
    ]);

    expect(result.map((tool) => tool.name)).toEqual(['status']);
  });

  test('uses server-qualified workflow exclusions without removing another server same-name tool', () => {
    const exclusions = [buildMcpToolExclusionKey('server-a', 'ping')];

    const serverATools = filterMcpToolsForServer('server-a', liveTools, [], exclusions);
    const serverBTools = filterMcpToolsForServer('server-b', liveTools, [], exclusions);

    expect(serverATools.map((tool) => tool.name)).toEqual(['status']);
    expect(serverBTools.map((tool) => tool.name)).toEqual(['ping', 'status']);
  });

  test('preserves live discovery when a server has no persisted tool records', () => {
    const result = filterMcpToolsForServer('server-a', liveTools, [
      persistedTool('another-server', 'ping', false),
    ]);

    expect(result.map((tool) => tool.name)).toEqual(['ping', 'status']);
  });

  test('returns an explicit empty tool policy when no tools remain after filtering', () => {
    expect(
      filterMcpToolsForServer(
        'server-a',
        [liveTools[0]],
        [persistedTool('server-a', 'ping', false)],
      ),
    ).toEqual([]);
  });

  test('registers a started stdio resource/prompt-only server with an empty tool policy', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchMock: typeof fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ url, init });
      if (url.endsWith('/api/v1/mcp-servers/stdio-server/resolve')) {
        return Response.json({ headers: {}, args: [] });
      }
      if (url.endsWith('/api/v1/internal/mcp/register-mcp-server')) {
        return Response.json({ success: true });
      }
      return new Response('not found', { status: 404 });
    };
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;
    const context = createExecutionContext({
      runId: 'run-stdio-filter-failure',
      componentRef: 'mcp.custom',
    });

    await registerServerTools(stdioServer, context, {
      persistedTools: [persistedTool('stdio-server', 'ping', false)],
    });

    const registration = requests.find(({ url }) =>
      url.endsWith('/api/v1/internal/mcp/register-mcp-server'),
    );
    expect(JSON.parse(String(registration?.init?.body))).toMatchObject({ tools: [] });
    expect(mockStopMcpStdioHostProxy).not.toHaveBeenCalled();
  });

  test('stops a started stdio proxy once on registration failure and preserves that error', async () => {
    const fetchMock: typeof fetch = async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/mcp-servers/stdio-server/resolve')) {
        return Response.json({ headers: {}, args: [] });
      }
      if (url.endsWith('/api/v1/internal/mcp/register-mcp-server')) {
        return new Response('registry unavailable', {
          status: 503,
          statusText: 'Registry unavailable',
        });
      }
      return new Response('not found', { status: 404 });
    };
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;
    mockStopMcpStdioHostProxy.mockRejectedValueOnce(new Error('cleanup also failed'));
    const context = createExecutionContext({
      runId: 'run-stdio-registration-failure',
      componentRef: 'mcp.custom',
    });

    await expect(registerServerTools(stdioServer, context)).rejects.toThrow(
      'Failed to register server stdio-server: Registry unavailable',
    );

    expect(mockStopMcpStdioHostProxy).toHaveBeenCalledTimes(1);
  });

  test('does not mirror successful HTTP server registration diagnostics to console.log by default', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchMock: typeof fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ url, init });

      if (url.endsWith('/api/v1/mcp-servers/http-server/resolve')) {
        return new Response(JSON.stringify({ headers: {}, args: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/v1/internal/mcp/register-mcp-server')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    };
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const context = createExecutionContext({
      runId: 'run-mcp-library-quiet',
      componentRef: 'mcp.custom',
    });
    const server: McpServer = {
      id: 'http-server',
      name: 'HTTP Server',
      description: null,
      transportType: 'http',
      endpoint: 'https://example.test/mcp',
      command: null,
      args: null,
      hasHeaders: false,
      headerKeys: null,
      enabled: true,
      healthCheckUrl: null,
      lastHealthCheck: null,
      lastHealthStatus: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await registerServerTools(server, context);

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockListTools).toHaveBeenCalledTimes(1);
    const registrationRequest = requests.find((request) =>
      request.url.endsWith('/register-mcp-server'),
    );
    expect(registrationRequest).toBeDefined();
    expect(JSON.parse(String(registrationRequest?.init?.body)).tools).toEqual([
      {
        name: 'ping',
        title: 'Ping target',
        description: 'Ping a target',
        inputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { target: { type: 'string' } },
          unevaluatedProperties: false,
        },
        outputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { reachable: { type: 'boolean' } },
        },
        icons: [
          {
            src: 'https://example.test/ping.svg',
            mimeType: 'image/svg+xml',
            sizes: ['any'],
            theme: 'dark',
          },
        ],
        annotations: { readOnlyHint: true, idempotentHint: true },
        _meta: { 'com.example/source': 'worker-library' },
      },
    ]);
  });
});
