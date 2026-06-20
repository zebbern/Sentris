import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext } from '@sentris/component-sdk';
import type { McpGroupTemplate } from '../mcp-group-runtime';

const originalFetch = globalThis.fetch;
const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

const mockStartMcpDockerServer = vi.fn(async () => ({
  endpoint: 'http://127.0.0.1:4100/mcp',
  containerId: 'container-123',
}));

vi.mock('../mcp-runtime', () => ({
  startMcpDockerServer: mockStartMcpDockerServer,
}));

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

import { executeMcpGroupNode } from '../mcp-group-runtime';

describe('mcp-group-runtime', () => {
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

  test('does not mirror successful group runtime diagnostics to console.log by default', async () => {
    const fetchMock: typeof fetch = async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
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
      runId: 'run-mcp-group-quiet',
      componentRef: 'aws-group',
    });
    const groupTemplate: McpGroupTemplate = {
      slug: 'aws',
      name: 'AWS',
      description: 'AWS MCP servers',
      credentialContractName: 'credential.aws',
      defaultDockerImage: 'example/mcp-proxy:latest',
      credentialMapping: {
        env: {
          AWS_ACCESS_KEY_ID: 'accessKeyId',
          AWS_SECRET_ACCESS_KEY: 'secretAccessKey',
        },
      },
      servers: [
        {
          id: 'cloudtrail',
          name: 'CloudTrail',
          command: 'cloudtrail-mcp',
          args: ['--readonly'],
        },
      ],
    };

    const result = await executeMcpGroupNode(
      context,
      {
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      },
      { enabledServers: ['cloudtrail'] },
      groupTemplate,
    );

    expect(result.endpoints).toEqual([
      {
        endpoint: 'http://127.0.0.1:4100/mcp',
        containerId: 'container-123',
        serverId: 'cloudtrail',
      },
    ]);
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(mockStartMcpDockerServer).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockListTools).toHaveBeenCalledTimes(1);
  });
});
