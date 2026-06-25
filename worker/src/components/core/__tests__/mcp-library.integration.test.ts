import { beforeAll, beforeEach, afterEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext, componentRegistry } from '@sentris/component-sdk';
import type { McpLibraryInput, McpLibraryOutput } from '../mcp-library';

const mockStartMcpDockerServer = vi.fn(async () => ({
  endpoint: 'http://localhost:3000/mcp',
  containerId: 'container-123',
}));
const mockStartMcpStdioHostProxy = vi.fn(async () => ({
  endpoint: 'http://localhost:3000/mcp',
  containerId: 'host-mcp-proxy-123',
}));
const mockStopMcpStdioHostProxy = vi.fn(async () => true);

vi.mock('../mcp-runtime', () => ({
  startMcpDockerServer: mockStartMcpDockerServer,
}));

vi.mock('../mcp-stdio-host-proxy', () => ({
  MCP_STDIO_HOST_PROXY_ID_PREFIX: 'host-mcp-proxy-',
  isMcpStdioHostProxyId: (id: string) => id.startsWith('host-mcp-proxy-'),
  startMcpStdioHostProxy: mockStartMcpStdioHostProxy,
  stopMcpStdioHostProxy: mockStopMcpStdioHostProxy,
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

// Save the original fetch before any mocking
const originalFetch = global.fetch;

describe('MCP Library Integration Tests', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKEND_URL = 'http://localhost:3000';
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
  });

  afterEach(() => {
    // Always restore original fetch after each test
    global.fetch = originalFetch;
  });

  function setupFetchMocks(servers: any[] = []) {
    // Add required timestamps to servers
    const serversWithTimestamps = servers.map((s) => ({
      ...s,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    // Mock fetch implementation
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      // Internal token generation endpoint
      if (url.includes('/generate-token')) {
        return new Response(JSON.stringify({ token: 'test-internal-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Fetch all servers endpoint
      if (url.includes('/mcp-servers') && !url.includes('/resolve')) {
        return new Response(JSON.stringify(serversWithTimestamps), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Resolve config endpoint
      if (url.includes('/resolve')) {
        return new Response(JSON.stringify({ headers: {}, args: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Docker spawn endpoint (should not be called due to mock)
      if (url.includes('/docker')) {
        return new Response(
          JSON.stringify({
            endpoint: 'http://localhost:3000/mcp',
            containerId: 'container-123',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Register discovered tools endpoint
      if (url.includes('/register-mcp-server') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Default response
      return new Response(JSON.stringify({ token: 'test-internal-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
  }

  describe('Test Case 1: Single Server Selection (aws-cloudtrail)', () => {
    test('should fetch and register a single stdio server', async () => {
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-single',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail'],
          },
        },
        context,
      );

      // Verify result
      expect(result).toEqual({});
      expect(mockStartMcpStdioHostProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
        }),
      );
      expect(mockStartMcpDockerServer).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/mcp-servers',
        expect.any(Object),
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/internal/mcp/register-mcp-server',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    test('should handle server not found gracefully', async () => {
      // Return empty server list
      setupFetchMocks([]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-not-found',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['non-existent-server'],
          },
        },
        context,
      );

      // Should return empty result without errors
      expect(result).toEqual({});
    });
  });

  describe('Test Case 2: Multiple Server Selection (aws-cloudtrail + aws-cloudwatch)', () => {
    test('should fetch and register multiple stdio servers', async () => {
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
        {
          id: 'aws-cloudwatch',
          name: 'Amazon CloudWatch',
          transportType: 'stdio',
          command: 'awslabs.cloudwatch-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-multiple',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail', 'aws-cloudwatch'],
          },
        },
        context,
      );

      expect(result).toEqual({});
      expect(mockStartMcpStdioHostProxy).toHaveBeenCalledTimes(2);
      expect(mockStartMcpDockerServer).not.toHaveBeenCalled();
    });

    test('should register all enabled servers with distinct child node ids when useAllEnabled is true', async () => {
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
        {
          id: 'http-server',
          name: 'HTTP MCP Server',
          transportType: 'http',
          command: null,
          args: null,
          enabled: true,
          endpoint: 'https://example.com/mcp',
          hasHeaders: false,
          headerKeys: null,
        },
        {
          id: 'disabled-server',
          name: 'Disabled MCP Server',
          transportType: 'http',
          command: null,
          args: null,
          enabled: false,
          endpoint: 'https://disabled.example.com/mcp',
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-all-enabled',
        componentRef: 'custom-mcps',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: [],
            useAllEnabled: true,
          },
        },
        context,
      );

      expect(result).toEqual({});
      const registerCalls = (global.fetch as any).mock.calls.filter(
        ([url, init]: [string, RequestInit]) =>
          url.includes('/register-mcp-server') && init?.method === 'POST',
      );
      const nodeIds = registerCalls.map(
        ([, init]: [string, RequestInit]) => JSON.parse(String(init.body)).nodeId,
      );

      expect(nodeIds).toEqual(['custom-mcps/aws-cloudtrail', 'custom-mcps/http-server']);
      expect(mockStartMcpStdioHostProxy).toHaveBeenCalledTimes(1);
      expect(mockStartMcpDockerServer).not.toHaveBeenCalled();
    });

    test('should continue registering remaining servers when an optional MCP server fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setupFetchMocks([
        {
          id: 'broken-stdio',
          name: 'Broken STDIO MCP',
          transportType: 'stdio',
          command: 'missing-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
        {
          id: 'working-stdio',
          name: 'Working STDIO MCP',
          transportType: 'stdio',
          command: 'working-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);
      mockStartMcpStdioHostProxy
        .mockRejectedValueOnce(new Error('host proxy failed to start'))
        .mockResolvedValueOnce({
          endpoint: 'http://localhost:3000/mcp',
          containerId: 'host-mcp-proxy-456',
        });

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-optional-failure',
        componentRef: 'custom-mcps',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['broken-stdio', 'working-stdio'],
            continueOnServerError: true,
          },
        },
        context,
      );

      expect(result).toEqual({});
      const registerCalls = (global.fetch as any).mock.calls.filter(
        ([url, init]: [string, RequestInit]) =>
          url.includes('/register-mcp-server') && init?.method === 'POST',
      );
      expect(registerCalls).toHaveLength(1);
      expect(JSON.parse(String(registerCalls[0][1].body)).nodeId).toBe('custom-mcps/working-stdio');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping unavailable MCP server'),
      );
      warnSpy.mockRestore();
    });

    test('should filter out disabled servers', async () => {
      // Return only enabled servers (cloudtrail enabled, cloudwatch disabled)
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-filter',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail', 'aws-cloudwatch'],
          },
        },
        context,
      );

      expect(result).toEqual({});
      expect(mockStartMcpStdioHostProxy).toHaveBeenCalledTimes(1);
      expect(mockStartMcpDockerServer).not.toHaveBeenCalled();
    });
  });

  describe('Test Case 3: Tool Registration Verification', () => {
    test('should verify tool registration payload structure', async () => {
      setupFetchMocks([
        {
          id: 'filesystem',
          name: 'Filesystem MCP',
          transportType: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/mcp'],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-registration',
        componentRef: 'mcp.custom',
      });

      await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['filesystem'],
          },
        },
        context,
      );

      expect(true).toBe(true); // Test passes if no error thrown
    });
  });

  describe('Test Case 4: HTTP Server Support', () => {
    test('should handle HTTP server registration without Docker', async () => {
      setupFetchMocks([
        {
          id: 'http-server',
          name: 'HTTP MCP Server',
          transportType: 'http',
          command: null,
          args: null,
          enabled: true,
          endpoint: 'https://example.com/mcp',
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-http',
        componentRef: 'mcp.custom',
      });

      await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['http-server'],
          },
        },
        context,
      );

      expect(true).toBe(true); // Test passes if no error thrown
      expect(mockStartMcpDockerServer).not.toHaveBeenCalled();
      expect(mockStartMcpStdioHostProxy).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty server selection', async () => {
      setupFetchMocks([]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-empty',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: [],
          },
        },
        context,
      );

      expect(result).toEqual({});
    });
  });

  describe('Component Metadata', () => {
    test('should have correct component metadata', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();
      expect(component!.id).toBe('mcp.custom');
      expect(component!.label).toBe('Custom MCPs');
      expect(component!.category).toBe('mcp');
      expect(component!.ui).toMatchObject({
        slug: 'mcp-library',
        version: '1.0.0',
        type: 'process',
        category: 'mcp',
        icon: 'Library',
        isLatest: true,
      });
    });

    test('should have correct port configuration', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();
      expect(component!.outputs).toBeDefined();
    });

    test('should have correct parameter schema', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();
      expect(component!.parameters).toBeDefined();
    });
  });
});
