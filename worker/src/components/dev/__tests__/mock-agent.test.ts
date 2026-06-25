import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import type { ExecutionContext } from '@sentris/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@sentris/component-sdk';

function createTestContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    runId: 'test-run',
    componentRef: 'mock.agent',
    logger: {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: () => {},
    },
    emitProgress: () => {},
    metadata: {
      runId: 'test-run',
      componentRef: 'mock.agent',
    },
    http: {
      fetch: async (input, init) => globalThis.fetch(input as any, init),
      toCurl: () => '',
    },
    ...overrides,
  };
}

beforeAll(async () => {
  await import('../../index');
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
});

describe('mock.agent', () => {
  test('returns empty list when no connected tools', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: {} },
      createTestContext(),
    );

    expect(result).toEqual({ discoveredTools: [], toolCount: 0, toolCallResults: [] });
  });

  test('writes diagnostics through the execution logger instead of console.log', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const loggerInfo = vi.fn();

    try {
      await runComponentWithRunner(
        component!.runner,
        component!.execute,
        { inputs: {}, params: {} },
        createTestContext({
          logger: {
            debug: () => {},
            info: loggerInfo,
            error: () => {},
            warn: () => {},
          },
        }),
      );

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(loggerInfo).toHaveBeenCalledWith(
        '[mock.agent] No connected tool nodes, returning empty list',
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('discovers tools from gateway when connected tools exist', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    const mockListTools = vi.fn().mockResolvedValue({
      tools: [
        { name: 'aws-cloudtrail__lookup_events', description: 'Look up CloudTrail events' },
        { name: 'aws-s3__list_buckets', description: 'List S3 buckets' },
      ],
    });
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockConnect = vi.fn().mockResolvedValue(undefined);

    class MockClient {
      connect = mockConnect;
      listTools = mockListTools;
      close = mockClose;
    }

    class MockTransport {
      constructor(
        public url: URL,
        public options: any,
      ) {}
    }

    const mockGetToken = vi.fn().mockResolvedValue('mock-gateway-token');

    const context = createTestContext({
      metadata: {
        runId: 'test-run',
        componentRef: 'mock.agent',
        connectedToolNodeIds: ['aws-mcp-group'],
        organizationId: 'org-1',
        mockAgentOverrides: {
          Client: MockClient as any,
          StreamableHTTPClientTransport: MockTransport as any,
          getGatewaySessionToken: mockGetToken,
        },
      } as any,
    });

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: {} },
      context,
    );

    expect(result.toolCount).toBe(2);
    expect(result.discoveredTools).toEqual([
      { name: 'aws-cloudtrail__lookup_events', description: 'Look up CloudTrail events' },
      { name: 'aws-s3__list_buckets', description: 'List S3 buckets' },
    ]);

    expect(mockGetToken).toHaveBeenCalledWith('test-run', 'org-1', ['aws-mcp-group']);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockListTools).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  test('passes authorization header to transport', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    let capturedTransportOptions: any;

    class MockClient {
      connect = vi.fn().mockResolvedValue(undefined);
      listTools = vi.fn().mockResolvedValue({ tools: [] });
      close = vi.fn().mockResolvedValue(undefined);
    }

    class MockTransport {
      constructor(
        public url: URL,
        public options: any,
      ) {
        capturedTransportOptions = options;
      }
    }

    const context = createTestContext({
      metadata: {
        runId: 'test-run',
        componentRef: 'mock.agent',
        connectedToolNodeIds: ['some-tool'],
        mockAgentOverrides: {
          Client: MockClient as any,
          StreamableHTTPClientTransport: MockTransport as any,
          getGatewaySessionToken: vi.fn().mockResolvedValue('my-token'),
        },
      } as any,
    });

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: {} },
      context,
    );

    expect(capturedTransportOptions.requestInit.headers).toMatchObject({
      Authorization: 'Bearer my-token',
    });
  });

  test('calls Fetch MCP tools with safe fixed arguments', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    const mockCallTool = vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'Example Domain\nThis domain is for use in examples.' }],
    });

    class MockClient {
      connect = vi.fn().mockResolvedValue(undefined);
      listTools = vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'Fetch_Reference__fetch',
            description: 'Fetches a URL from the internet',
          },
        ],
      });
      callTool = mockCallTool;
      close = vi.fn().mockResolvedValue(undefined);
    }

    class MockTransport {
      constructor(
        public url: URL,
        public options: any,
      ) {}
    }

    const context = createTestContext({
      metadata: {
        runId: 'test-run',
        componentRef: 'mock.agent',
        connectedToolNodeIds: ['custom_mcp_tools'],
        mockAgentOverrides: {
          Client: MockClient as any,
          StreamableHTTPClientTransport: MockTransport as any,
          getGatewaySessionToken: vi.fn().mockResolvedValue('fetch-token'),
        },
      } as any,
    });

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: { callTools: true, maxToolCalls: 1 } },
      context,
    );

    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'Fetch_Reference__fetch',
      arguments: { url: 'https://example.com', max_length: 1200 },
    });
    expect(result.toolCallResults).toEqual([
      {
        toolName: 'Fetch_Reference__fetch',
        success: true,
        durationMs: expect.any(Number),
        output: 'Example Domain\nThis domain is for use in examples.',
      },
    ]);
  });
});
