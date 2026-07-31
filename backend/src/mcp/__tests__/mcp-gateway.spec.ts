import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer, Tool } from '@modelcontextprotocol/server';
import { McpServer as LegacyMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport as LegacyStreamableHttpServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  componentRegistry,
  inputs,
  outputs,
  port,
  type ComponentDefinition,
} from '@sentris/component-sdk';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpGatewayService } from '../mcp-gateway.service';
import type { RunMcpRequestContext } from '../run-mcp-request-context';
import type { ToolRegistryService } from '../tool-registry.service';

const RUN_CONTEXT: RunMcpRequestContext = Object.freeze({
  kind: 'run',
  runId: 'run-1',
  organizationId: 'org-1',
  capabilityGrantId: '11111111-1111-4111-8111-111111111111',
  allowedNodeIds: Object.freeze([]),
});

describe('McpGatewayService', () => {
  let service: McpGatewayService;
  let toolRegistry: ToolRegistryService;
  let temporalService: {
    signalWorkflow: ReturnType<typeof jest.fn>;
    queryWorkflow: ReturnType<typeof jest.fn>;
  };
  let workflowRunRepository: { findByRunId: ReturnType<typeof jest.fn> };
  let traceRepository: {
    getLastSequence: ReturnType<typeof jest.fn>;
    append: ReturnType<typeof jest.fn>;
  };
  let mcpServersRepository: { listTools: ReturnType<typeof jest.fn> };
  const clients: Client[] = [];
  const servers: McpServer[] = [];
  const upstreams: LegacyToolServer[] = [];

  beforeEach(() => {
    toolRegistry = {
      getServerTools: jest.fn().mockResolvedValue(null),
      getToolsForRun: jest.fn().mockResolvedValue([]),
      getToolCredentials: jest.fn().mockResolvedValue(null),
    } as unknown as ToolRegistryService;
    temporalService = {
      signalWorkflow: jest.fn().mockResolvedValue(undefined),
      queryWorkflow: jest.fn().mockResolvedValue({ success: true, output: { finding: true } }),
    };
    workflowRunRepository = {
      findByRunId: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    };
    traceRepository = {
      getLastSequence: jest.fn().mockResolvedValue(0),
      append: jest.fn().mockResolvedValue(undefined),
    };
    mcpServersRepository = {
      listTools: jest.fn().mockResolvedValue([]),
    };

    service = new McpGatewayService(
      toolRegistry,
      temporalService as never,
      workflowRunRepository as never,
      traceRepository as never,
      mcpServersRepository as never,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
    await Promise.allSettled(upstreams.splice(0).map((upstream) => upstream.close()));
  });

  it('advertises and calls a component tool through the public MCP protocol', async () => {
    jest.spyOn(componentRegistry, 'get').mockReturnValue(createTestComponent());
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        nodeId: 'component-node',
        toolName: 'scan_target',
        type: 'component',
        status: 'ready',
        exposedToAgent: true,
        componentId: 'test.gateway-component',
        description: 'Scan one target',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string' } },
          required: ['target'],
        },
      },
    ]);

    const client = await connectToGateway(service, RUN_CONTEXT, clients, servers);
    const listed = await client.listTools();
    const called = await client.callTool({
      name: 'scan_target',
      arguments: { target: 'example.com' },
    });

    expect(listed.tools).toHaveLength(1);
    expect(listed.tools[0]).toMatchObject({
      name: 'scan_target',
      description: 'Scan one target',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
    });
    expect(called.content).toEqual([
      { type: 'text', text: JSON.stringify({ finding: true }, null, 2) },
    ]);
    expect(temporalService.signalWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'run-1',
        signalName: 'executeToolCall',
        args: expect.objectContaining({
          nodeId: 'component-node',
          componentId: 'test.gateway-component',
          arguments: { target: 'example.com' },
        }),
      }),
    );
  });

  it('preserves raw external input and output JSON Schemas and tool metadata', async () => {
    const inputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Lookup input',
      type: 'object',
      $defs: {
        Query: { type: 'string', minLength: 1, 'x-query-kind': 'security' },
      },
      properties: {
        query: { $ref: '#/$defs/Query' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      allOf: [{ properties: { query: { description: 'Search query' } } }],
      additionalProperties: false,
      'x-sentris-schema': 'preserve-me',
    } satisfies Tool['inputSchema'];
    const outputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Lookup output',
      type: 'object',
      $defs: { Count: { type: 'integer', minimum: 0 } },
      properties: { count: { $ref: '#/$defs/Count' } },
      required: ['count'],
      'x-result-kind': 'security-events',
    } satisfies NonNullable<Tool['outputSchema']>;
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('parent/external'),
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: 'lookup.events',
        title: 'Lookup events',
        description: 'Search upstream events',
        icons: [{ src: 'https://example.com/lookup.svg', mimeType: 'image/svg+xml' }],
        annotations: { readOnlyHint: true, idempotentHint: true },
        _meta: { 'x-upstream': 'catalog' },
        inputSchema,
        outputSchema,
      },
    ]);

    const client = await connectToGateway(service, RUN_CONTEXT, clients, servers);
    const listed = await client.listTools();

    expect(listed.tools).toEqual([
      {
        name: 'External_Server__lookup_events',
        title: 'Lookup events',
        description: 'Search upstream events',
        icons: [{ src: 'https://example.com/lookup.svg', mimeType: 'image/svg+xml' }],
        annotations: { readOnlyHint: true, idempotentHint: true },
        _meta: { 'x-upstream': 'catalog' },
        inputSchema,
        outputSchema,
      },
    ]);
  });

  it('applies hierarchical node scope before advertising registry-materialized tool names', async () => {
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('parent/child-a', 'Child A'),
      externalSource('sibling/child-b', 'Child B'),
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockImplementation(
      async (_runId: string, nodeId: string) =>
        nodeId === 'parent/child-a'
          ? [
              { name: 'lookup', inputSchema: { type: 'object' } },
              { name: 'materialized-only', inputSchema: { type: 'object' } },
            ]
          : [{ name: 'should-not-leak', inputSchema: { type: 'object' } }],
    );
    const context = withRunContext({ allowedNodeIds: Object.freeze(['parent']) });

    const client = await connectToGateway(service, context, clients, servers);
    const listed = await client.listTools();

    expect(toolRegistry.getToolsForRun).toHaveBeenCalledWith('run-1', ['parent']);
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'Child_A__lookup',
      'Child_A__materialized-only',
    ]);
  });

  it('rejects normalized external tool-name collisions deterministically', async () => {
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('node-a', 'Remote A'),
      externalSource('node-b', 'Remote_A'),
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockImplementation(
      async (_runId: string, nodeId: string) => [
        {
          name: nodeId === 'node-a' ? 'scan.host' : 'scan host',
          inputSchema: { type: 'object' },
        },
      ],
    );

    await expect(service.createServerForRun(RUN_CONTEXT)).rejects.toThrow(
      'MCP tool name collision: Remote_A__scan_host',
    );
  });

  it('forwards v1 outbound calls and registry headers through a public v2 server', async () => {
    const upstream = await startLegacyToolServer();
    upstreams.push(upstream);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('parent/external', 'External Server', upstream.url),
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: 'lookup',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
      },
    ]);
    (toolRegistry.getToolCredentials as ReturnType<typeof jest.fn>).mockResolvedValue({
      'x-sentris-mcp-proxy-token': 'worker-proxy-token',
    });

    const client = await connectToGateway(service, RUN_CONTEXT, clients, servers);
    const called = await client.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'critical' },
    });

    expect(called.content).toEqual([{ type: 'text', text: 'lookup:critical' }]);
    expect(called.structuredContent).toEqual({ count: 1 });
    expect(upstream.toolCalls).toEqual([{ query: 'critical' }]);
    expect(
      upstream.requests.every(
        (request) => request.headers['x-sentris-mcp-proxy-token'] === 'worker-proxy-token',
      ),
    ).toBe(true);
  });

  it('reuses one pending v1 connection across concurrent request-local factories', async () => {
    const upstream = await startLegacyToolServer();
    upstreams.push(upstream);
    configureExternalRegistry(toolRegistry, upstream.url);

    const [firstClient, secondClient] = await Promise.all([
      connectToGateway(service, RUN_CONTEXT, clients, servers),
      connectToGateway(service, RUN_CONTEXT, clients, servers),
    ]);
    await Promise.all([
      firstClient.callTool({ name: 'External_Server__lookup', arguments: { query: 'one' } }),
      secondClient.callTool({ name: 'External_Server__lookup', arguments: { query: 'two' } }),
    ]);

    expect(upstream.initializeCount).toBe(1);
    expect(upstream.toolCalls).toEqual(
      expect.arrayContaining([{ query: 'one' }, { query: 'two' }]),
    );
  });

  it('cleanupRun closes only that run outbound pool entry', async () => {
    const runOneUpstream = await startLegacyToolServer();
    const runTwoUpstream = await startLegacyToolServer();
    upstreams.push(runOneUpstream, runTwoUpstream);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockImplementation(
      async (runId: string) => [
        externalSource(
          'parent/external',
          'External Server',
          runId === 'run-1' ? runOneUpstream.url : runTwoUpstream.url,
        ),
      ],
    );
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: 'lookup',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);

    const runOneClient = await connectToGateway(service, RUN_CONTEXT, clients, servers);
    const runTwoClient = await connectToGateway(
      service,
      withRunContext({ runId: 'run-2' }),
      clients,
      servers,
    );
    await runOneClient.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'run-one-before' },
    });
    await runTwoClient.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'run-two-before' },
    });

    await service.cleanupRun('run-1');
    await runTwoClient.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'run-two-after' },
    });
    await runOneClient.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'run-one-after' },
    });

    expect(runOneUpstream.initializeCount).toBe(2);
    expect(runTwoUpstream.initializeCount).toBe(1);
  });

  it('keeps a replacement v1 client pooled when a concurrent stale close finishes', async () => {
    configureExternalRegistry(toolRegistry, 'http://127.0.0.1:9/mcp');
    let releaseOldClose!: () => void;
    let markOldCloseStarted!: () => void;
    const oldCloseStarted = new Promise<void>((resolve) => {
      markOldCloseStarted = resolve;
    });
    const heldOldClose = new Promise<void>((resolve) => {
      releaseOldClose = resolve;
    });
    const oldClient = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'old' }] }),
      close: jest.fn().mockImplementation(() => {
        if (oldClient.close.mock.calls.length === 1) {
          markOldCloseStarted();
          return heldOldClose;
        }
        return Promise.resolve();
      }),
    };
    const replacementClient = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'replacement' }] }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const unexpectedClient = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'unexpected' }] }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const connectClient = jest.spyOn(
      service as unknown as {
        connectLegacyOutboundClient: () => Promise<typeof oldClient>;
      },
      'connectLegacyOutboundClient',
    );
    connectClient
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(replacementClient)
      .mockResolvedValue(unexpectedClient);
    const client = await connectToGateway(service, RUN_CONTEXT, clients, servers);

    await client.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'before-cleanup' },
    });
    const staleCleanup = service.cleanupRun('run-1');
    await oldCloseStarted;
    await service.cleanupRun('run-1');
    await client.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'replacement-before-stale-close' },
    });

    releaseOldClose();
    await staleCleanup;
    await client.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'replacement-after-stale-close' },
    });
    await service.cleanupRun('run-1');

    expect(connectClient).toHaveBeenCalledTimes(2);
    expect(oldClient.callTool).toHaveBeenCalledTimes(1);
    expect(oldClient.close).toHaveBeenCalledTimes(1);
    expect(replacementClient.callTool).toHaveBeenCalledTimes(2);
    expect(replacementClient.close).toHaveBeenCalledTimes(1);
    expect(unexpectedClient.callTool).not.toHaveBeenCalled();
    expect(unexpectedClient.close).not.toHaveBeenCalled();
  });

  it('does not evict a replacement when an operation on the old v1 client fails late', async () => {
    configureExternalRegistry(toolRegistry, 'http://127.0.0.1:9/mcp');
    let rejectFirstFailure!: () => void;
    let rejectLateFailure!: () => void;
    let markBothOldCallsStarted!: () => void;
    let markReplacementUsed!: () => void;
    const firstFailure = new Promise<never>((_, reject) => {
      rejectFirstFailure = () => reject(new Error('first old-client failure'));
    });
    const lateFailure = new Promise<never>((_, reject) => {
      rejectLateFailure = () => reject(new Error('late old-client failure'));
    });
    const bothOldCallsStarted = new Promise<void>((resolve) => {
      markBothOldCallsStarted = resolve;
    });
    const replacementUsed = new Promise<void>((resolve) => {
      markReplacementUsed = resolve;
    });
    const oldClient = {
      callTool: jest.fn().mockImplementation(() => {
        if (oldClient.callTool.mock.calls.length === 1) return firstFailure;
        markBothOldCallsStarted();
        return lateFailure;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const replacementClient = {
      callTool: jest.fn().mockImplementation(() => {
        markReplacementUsed();
        return Promise.resolve({ content: [{ type: 'text', text: 'replacement' }] });
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const unexpectedClient = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'unexpected' }] }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const connectClient = jest.spyOn(
      service as unknown as {
        connectLegacyOutboundClient: () => Promise<typeof oldClient>;
      },
      'connectLegacyOutboundClient',
    );
    connectClient
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(replacementClient)
      .mockResolvedValue(unexpectedClient);
    const client = await connectToGateway(service, RUN_CONTEXT, clients, servers);

    const firstOperation = client.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'fails-first' },
    });
    const lateOperation = client.callTool({
      name: 'External_Server__lookup',
      arguments: { query: 'fails-late' },
    });
    await bothOldCallsStarted;
    rejectFirstFailure();
    await replacementUsed;
    rejectLateFailure();
    await Promise.all([firstOperation, lateOperation]);
    const replacementCloseCountBeforeCleanup = replacementClient.close.mock.calls.length;
    await service.cleanupRun('run-1');

    expect(connectClient).toHaveBeenCalledTimes(2);
    expect(oldClient.callTool).toHaveBeenCalledTimes(2);
    expect(oldClient.close).toHaveBeenCalledTimes(1);
    expect(replacementClient.callTool).toHaveBeenCalledTimes(2);
    expect(replacementCloseCountBeforeCleanup).toBe(0);
    expect(replacementClient.close).toHaveBeenCalledTimes(1);
    expect(unexpectedClient.callTool).not.toHaveBeenCalled();
    expect(unexpectedClient.close).not.toHaveBeenCalled();
  });

  it('does not evict a replacement when discovery on the old v1 client fails late', async () => {
    const endpoint = 'http://127.0.0.1:9/mcp';
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('parent/external', 'External Server', endpoint),
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockResolvedValue(null);
    let rejectFirstFailure!: () => void;
    let rejectLateFailure!: () => void;
    let markBothOldListsStarted!: () => void;
    let markReplacementUsed!: () => void;
    const firstFailure = new Promise<never>((_, reject) => {
      rejectFirstFailure = () => reject(new Error('first old-client discovery failure'));
    });
    const lateFailure = new Promise<never>((_, reject) => {
      rejectLateFailure = () => reject(new Error('late old-client discovery failure'));
    });
    const bothOldListsStarted = new Promise<void>((resolve) => {
      markBothOldListsStarted = resolve;
    });
    const replacementUsed = new Promise<void>((resolve) => {
      markReplacementUsed = resolve;
    });
    const discoveredTools = {
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
    };
    const oldClient = {
      listTools: jest.fn().mockImplementation(() => {
        if (oldClient.listTools.mock.calls.length === 1) return firstFailure;
        markBothOldListsStarted();
        return lateFailure;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const replacementClient = {
      listTools: jest.fn().mockImplementation(() => {
        markReplacementUsed();
        return Promise.resolve(discoveredTools);
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const unexpectedClient = {
      listTools: jest.fn().mockResolvedValue(discoveredTools),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const connectClient = jest.spyOn(
      service as unknown as {
        connectLegacyOutboundClient: () => Promise<typeof oldClient>;
      },
      'connectLegacyOutboundClient',
    );
    connectClient
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(replacementClient)
      .mockResolvedValue(unexpectedClient);

    const firstDiscovery = service.createServerForRun(RUN_CONTEXT);
    const lateDiscovery = service.createServerForRun(RUN_CONTEXT);
    await bothOldListsStarted;
    rejectFirstFailure();
    servers.push(await firstDiscovery);
    const replacementServer = await service.createServerForRun(RUN_CONTEXT);
    servers.push(replacementServer);
    await replacementUsed;
    rejectLateFailure();
    servers.push(await lateDiscovery);
    servers.push(await service.createServerForRun(RUN_CONTEXT));
    const replacementCloseCountBeforeCleanup = replacementClient.close.mock.calls.length;
    await service.cleanupRun('run-1');

    expect(connectClient).toHaveBeenCalledTimes(2);
    expect(oldClient.listTools).toHaveBeenCalledTimes(2);
    expect(oldClient.close).toHaveBeenCalledTimes(1);
    expect(replacementClient.listTools).toHaveBeenCalledTimes(2);
    expect(replacementCloseCountBeforeCleanup).toBe(0);
    expect(replacementClient.close).toHaveBeenCalledTimes(1);
    expect(unexpectedClient.listTools).not.toHaveBeenCalled();
    expect(unexpectedClient.close).not.toHaveBeenCalled();
  });

  it('keeps run access validation while the legacy controller is mounted', async () => {
    workflowRunRepository.findByRunId.mockResolvedValue(null);

    await expect(service.createServerForRun(RUN_CONTEXT)).rejects.toThrow(NotFoundException);
  });

  it('rejects a null organization context for an organization-owned run', async () => {
    workflowRunRepository.findByRunId.mockResolvedValue({ organizationId: 'org-owned' });

    await expect(
      service.createServerForRun(withRunContext({ organizationId: null })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a null organization context for a local null-organization run', async () => {
    workflowRunRepository.findByRunId.mockResolvedValue({ organizationId: null });

    const server = await service.createServerForRun(withRunContext({ organizationId: null }));
    servers.push(server);

    expect(server).toBeDefined();
  });
});

async function connectToGateway(
  service: McpGatewayService,
  context: RunMcpRequestContext,
  clients: Client[],
  servers: McpServer[],
): Promise<Client> {
  const server = await service.createServerForRun(context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'gateway-test-client', version: '1.0.0' });

  servers.push(server);
  clients.push(client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function createTestComponent(): ComponentDefinition<any, any, any> {
  return {
    id: 'test.gateway-component',
    label: 'Gateway component',
    category: 'security',
    runner: { kind: 'inline' },
    inputs: inputs({ target: port(z.string(), { label: 'Target' }) }),
    outputs: outputs({}),
    docs: 'Test component',
    execute: async () => ({}),
  };
}

function externalSource(
  nodeId: string,
  toolName = 'External Server',
  endpoint = 'http://127.0.0.1:9/mcp',
) {
  return {
    nodeId,
    toolName,
    type: 'mcp-server',
    endpoint,
    status: 'ready',
  };
}

function withRunContext(overrides: Partial<RunMcpRequestContext>): RunMcpRequestContext {
  return Object.freeze({ ...RUN_CONTEXT, ...overrides });
}

function configureExternalRegistry(toolRegistry: ToolRegistryService, endpoint: string): void {
  (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
    externalSource('parent/external', 'External Server', endpoint),
  ]);
  (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockResolvedValue([
    {
      name: 'lookup',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ]);
}

interface LegacyToolServer {
  url: string;
  requests: {
    method: string | undefined;
    headers: Record<string, string | string[] | undefined>;
  }[];
  toolCalls: Record<string, unknown>[];
  initializeCount: number;
  close(): Promise<void>;
}

async function startLegacyToolServer(): Promise<LegacyToolServer> {
  const app = express();
  app.use(express.json());
  const requests: LegacyToolServer['requests'] = [];
  const toolCalls: LegacyToolServer['toolCalls'] = [];
  const mcpServers: LegacyMcpServer[] = [];
  let initializeCount = 0;

  app.post('/mcp', async (req, res) => {
    const method =
      isRecord(req.body) && typeof req.body.method === 'string' ? req.body.method : undefined;
    requests.push({ method, headers: req.headers });
    if (method === 'initialize') {
      initializeCount += 1;
    }

    const mcpServer = new LegacyMcpServer({ name: 'legacy-upstream', version: '1.0.0' });
    mcpServer.registerTool(
      'lookup',
      { inputSchema: z.object({ query: z.string() }) },
      async ({ query }) => {
        toolCalls.push({ query });
        return {
          content: [{ type: 'text', text: `lookup:${query}` }],
          structuredContent: { count: 1 },
        };
      },
    );
    const transport = new LegacyStreamableHttpServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    mcpServers.push(mcpServer);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const httpServer = await listen(app);
  const address = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    toolCalls,
    get initializeCount() {
      return initializeCount;
    },
    async close() {
      await closeHttpServer(httpServer);
      await Promise.allSettled(mcpServers.map((server) => server.close()));
    },
  };
}

function listen(app: express.Express): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
