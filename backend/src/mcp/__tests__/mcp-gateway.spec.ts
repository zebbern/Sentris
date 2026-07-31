import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer, Tool } from '@modelcontextprotocol/server';
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
import type { McpLegacyOutboundCompatibilityService } from '../mcp-legacy-outbound-compatibility.service';
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
  let legacyOutbound: {
    discoverTools: ReturnType<typeof jest.fn>;
    callTool: ReturnType<typeof jest.fn>;
  };
  let temporalService: {
    signalWorkflow: ReturnType<typeof jest.fn>;
    queryWorkflow: ReturnType<typeof jest.fn>;
  };
  let workflowRunRepository: { findByRunId: ReturnType<typeof jest.fn> };
  const clients: Client[] = [];
  const servers: McpServer[] = [];

  beforeEach(() => {
    toolRegistry = {
      getServerTools: jest.fn().mockResolvedValue(null),
      getToolsForRun: jest.fn().mockResolvedValue([]),
      getToolCredentials: jest.fn().mockResolvedValue(null),
    } as unknown as ToolRegistryService;
    legacyOutbound = {
      discoverTools: jest.fn().mockResolvedValue([]),
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'proxied' }],
        structuredContent: { count: 1 },
      }),
    };
    temporalService = {
      signalWorkflow: jest.fn().mockResolvedValue(undefined),
      queryWorkflow: jest.fn().mockResolvedValue({ success: true, output: { finding: true } }),
    };
    workflowRunRepository = {
      findByRunId: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    };

    service = new McpGatewayService(
      toolRegistry,
      legacyOutbound as unknown as McpLegacyOutboundCompatibilityService,
      temporalService as never,
      workflowRunRepository as never,
      {
        getLastSequence: jest.fn().mockResolvedValue(0),
        append: jest.fn().mockResolvedValue(undefined),
      } as never,
      { listTools: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
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
  });

  it('preserves raw external schemas and metadata while delegating calls', async () => {
    const inputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { query: { type: 'string' } },
      additionalProperties: false,
      'x-sentris-schema': 'preserve-me',
    } satisfies Tool['inputSchema'];
    const outputSchema = {
      type: 'object',
      properties: { count: { type: 'integer' } },
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
    const called = await client.callTool({
      name: 'External_Server__lookup_events',
      arguments: { query: 'critical' },
    });

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
    expect(called.content).toEqual([{ type: 'text', text: 'proxied' }]);
    expect(legacyOutbound.callTool).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ nodeId: 'parent/external' }),
      'lookup.events',
      { query: 'critical' },
    );
  });

  it('applies hierarchical node scope before advertising tools', async () => {
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('parent/child-a', 'Child A'),
      externalSource('sibling/child-b', 'Child B'),
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockImplementation(
      async (_runId: string, nodeId: string) =>
        nodeId === 'parent/child-a'
          ? [{ name: 'lookup', inputSchema: { type: 'object' } }]
          : [{ name: 'should-not-leak', inputSchema: { type: 'object' } }],
    );

    const client = await connectToGateway(
      service,
      withRunContext({ allowedNodeIds: Object.freeze(['parent']) }),
      clients,
      servers,
    );

    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['Child_A__lookup']);
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
  return { nodeId, toolName, type: 'mcp-server', endpoint, status: 'ready' };
}

function withRunContext(overrides: Partial<RunMcpRequestContext>): RunMcpRequestContext {
  return Object.freeze({ ...RUN_CONTEXT, ...overrides });
}
