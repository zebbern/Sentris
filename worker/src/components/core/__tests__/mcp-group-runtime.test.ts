import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext } from '@sentris/component-sdk';
import type { McpGroupTemplate } from '../mcp-group-runtime';

const originalFetch = globalThis.fetch;
const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

const mockStartMcpDockerServer = vi.fn(async () => ({
  endpoint: 'http://worker:9101/containers/container-123/mcp',
  authToken: 'worker-proxy-token',
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
      icons: [{ src: 'https://example.test/ping.svg', theme: 'light' }],
      annotations: { readOnlyHint: true },
      _meta: { 'com.example/source': 'worker-group' },
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
    let registrationBody: Record<string, unknown> | undefined;
    const fetchMock: typeof fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/internal/mcp/register-mcp-server')) {
        registrationBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
        endpoint: 'http://worker:9101/containers/container-123/mcp',
        authToken: 'worker-proxy-token',
        containerId: 'container-123',
        serverId: 'cloudtrail',
      },
    ]);
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(mockStartMcpDockerServer).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockListTools).toHaveBeenCalledTimes(1);
    expect(mockTransport).toHaveBeenCalledWith(
      new URL('http://worker:9101/containers/container-123/mcp'),
      expect.objectContaining({
        requestInit: expect.objectContaining({
          headers: expect.objectContaining({
            'x-sentris-mcp-proxy-token': 'worker-proxy-token',
          }),
        }),
      }),
    );
    expect(registrationBody?.headers).toEqual({
      'x-sentris-mcp-proxy-token': 'worker-proxy-token',
    });
    expect(registrationBody?.tools).toEqual([
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
        icons: [{ src: 'https://example.test/ping.svg', theme: 'light' }],
        annotations: { readOnlyHint: true },
        _meta: { 'com.example/source': 'worker-group' },
      },
    ]);
  });
});
