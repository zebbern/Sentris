import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext } from '@sentris/component-sdk';
import type { McpServer } from '../mcp-library-utils';

const originalFetch = globalThis.fetch;
const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

const mockConnect = vi.fn(async () => {});
const mockListTools = vi.fn(async () => ({
  tools: [
    {
      name: 'ping',
      description: 'Ping a target',
      inputSchema: { type: 'object', properties: {} },
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

import { registerServerTools } from '../mcp-library-utils';

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
    expect(requests.some((request) => request.url.endsWith('/register-mcp-server'))).toBe(true);
  });
});
