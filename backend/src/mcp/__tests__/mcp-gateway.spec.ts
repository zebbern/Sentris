import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer, type Tool } from '@modelcontextprotocol/server';
import {
  componentRegistry,
  inputs,
  outputs,
  port,
  type ComponentDefinition,
} from '@sentris/component-sdk';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import type { StoredMcpAuthority } from '../../mcp-runtime/mcp-runtime.repository';
import { computeMcpBindingFingerprint } from '../../mcp-runtime/mcp-binding-fingerprint';
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
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const DURABLE_RUN_CONTEXT: RunMcpRequestContext = Object.freeze({
  ...RUN_CONTEXT,
  capabilitySnapshotId: SNAPSHOT_ID,
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
    executeWorkflowUpdate: ReturnType<typeof jest.fn>;
  };
  let workflowRunRepository: { findByRunId: ReturnType<typeof jest.fn> };
  let mcpRuntimeRepository: { getAuthority: ReturnType<typeof jest.fn> };
  let runtimeConfigService: { buildRuntimeKey: ReturnType<typeof jest.fn> };
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
      executeWorkflowUpdate: jest
        .fn()
        .mockImplementation(async ({ updateName }) =>
          updateName === 'executeMcpOperation'
            ? completedOperationResult()
            : completedInvocationResult(),
        ),
    };
    workflowRunRepository = {
      findByRunId: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    };
    mcpRuntimeRepository = {
      getAuthority: jest.fn().mockResolvedValue(componentAuthority()),
    };
    runtimeConfigService = {
      buildRuntimeKey: jest.fn().mockResolvedValue(savedRuntimeKey()),
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
      mcpRuntimeRepository as never,
      runtimeConfigService as never,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  });

  it('advertises and calls a component tool through the legacy live path without a snapshot', async () => {
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
    expect(mcpRuntimeRepository.getAuthority).not.toHaveBeenCalled();
    expect(temporalService.executeWorkflowUpdate).not.toHaveBeenCalled();
    expect(temporalService.signalWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ signalName: 'executeToolCall' }),
    );
    expect(temporalService.queryWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ queryType: 'getToolCallResult' }),
    );
  });

  it('advertises exactly the persisted snapshot after the live catalog changes', async () => {
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        nodeId: 'changed-node',
        toolName: 'changed_after_snapshot',
        type: 'component',
        status: 'ready',
        exposedToAgent: true,
        componentId: 'changed.component',
        description: 'This must not replace the snapshot',
        inputSchema: { type: 'object' },
      },
    ]);

    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    expect((await client.listTools()).tools).toEqual([
      {
        name: 'scan_target',
        title: 'Snapshot scan',
        description: 'Scan one immutable target',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string' } },
          required: ['target'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { finding: { type: 'boolean' } },
          required: ['finding'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        _meta: { 'x-snapshot': 'immutable' },
      },
    ]);
  });

  it('calls a snapshot component through one keyed Workflow Update', async () => {
    const beforeCall = Date.now();
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);
    const called = await client.callTool({
      name: 'scan_target',
      arguments: { target: 'example.com' },
    });
    const afterCall = Date.now();

    expect(called.content).toEqual([
      { type: 'text', text: JSON.stringify({ finding: true }, null, 2) },
    ]);
    expect(temporalService.executeWorkflowUpdate).toHaveBeenCalledTimes(1);
    const update = temporalService.executeWorkflowUpdate.mock.calls[0]?.[0] as {
      workflowId: string;
      updateName: string;
      updateId: string;
      args: Record<string, unknown>;
    };
    expect(update).toMatchObject({
      workflowId: 'run-1',
      updateName: 'executeToolInvocation',
      updateId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      args: {
        invocationId: update.updateId,
        scope: {
          kind: 'run',
          runId: 'run-1',
          organizationId: 'org-1',
          capabilityGrantId: RUN_CONTEXT.capabilityGrantId,
        },
        capabilitySnapshotId: SNAPSHOT_ID,
        toolName: 'scan_target',
        input: { target: 'example.com' },
      },
    });
    const requestedAt = Date.parse(update.args.requestedAt as string);
    const deadlineAt = Date.parse(update.args.deadlineAt as string);
    expect(requestedAt).toBeGreaterThanOrEqual(beforeCall);
    expect(requestedAt).toBeLessThanOrEqual(afterCall);
    expect(deadlineAt - requestedAt).toBe(5 * 60_000);
    expect(temporalService.signalWorkflow).not.toHaveBeenCalled();
    expect(temporalService.queryWorkflow).not.toHaveBeenCalled();
  });

  it('surfaces a rejected Workflow Update without falling back to executeToolCall', async () => {
    temporalService.executeWorkflowUpdate.mockRejectedValue(new Error('Workflow Update timed out'));
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    const called = await client.callTool({
      name: 'scan_target',
      arguments: { target: 'example.com' },
    });

    expect(called).toMatchObject({
      content: [{ type: 'text', text: 'Error: Workflow Update timed out' }],
      isError: true,
    });
    expect(temporalService.executeWorkflowUpdate).toHaveBeenCalledTimes(1);
    expect(temporalService.signalWorkflow).not.toHaveBeenCalled();
    expect(temporalService.queryWorkflow).not.toHaveBeenCalled();
  });

  it.each(['failed', 'ambiguous', 'cancelled'] as const)(
    'returns snapshot invocation status %s as an MCP tool error',
    async (status) => {
      temporalService.executeWorkflowUpdate.mockResolvedValue({
        invocationId: '33333333-3333-4333-8333-333333333333',
        status,
        error: {
          class: status === 'cancelled' ? 'cancelled' : 'remote-tool',
          message: `Safe ${status} result`,
          retryable: false,
        },
        completedAt: '2026-07-31T10:05:00.000Z',
      });
      const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

      const called = await client.callTool({
        name: 'scan_target',
        arguments: { target: 'example.com' },
      });

      expect(called).toMatchObject({
        content: [{ type: 'text', text: `Error: Safe ${status} result` }],
        isError: true,
      });
    },
  );

  it('calls an external snapshot descriptor through one generic keyed Workflow Update', async () => {
    const immutableSource = {
      ...externalSource('external-node', 'Snapshot Server'),
      encryptedCredentials: 'captured-ciphertext',
    };
    const authority = externalAuthority(immutableSource);
    mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('unrelated-node', 'Unrelated'),
      immutableSource,
    ]);
    (toolRegistry.getServerTools as ReturnType<typeof jest.fn>).mockResolvedValue([
      { name: 'changed-after-snapshot', inputSchema: { type: 'object' } },
    ]);
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        ...immutableSource,
        encryptedCredentials: 'replacement-ciphertext',
        registeredAt: '2026-07-31T10:01:00.000Z',
      },
    ]);

    const listed = await client.listTools();
    const called = await client.callTool({
      name: 'Snapshot_Server__lookup_events',
      arguments: { query: 'critical' },
    });

    expect(listed.tools).toEqual([
      {
        name: 'Snapshot_Server__lookup_events',
        title: 'Immutable lookup',
        description: 'Search the snapshotted upstream tool',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        _meta: { 'x-source': 'snapshot' },
      },
    ]);
    expect(legacyOutbound.callTool).not.toHaveBeenCalled();
    expect(temporalService.executeWorkflowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'run-1',
        updateName: 'executeMcpOperation',
        updateId: expect.any(String),
        args: expect.objectContaining({
          sourceId: 'external-node',
          authorizationTarget: 'Snapshot_Server__lookup_events',
          operation: {
            kind: 'tool-call',
            name: 'Snapshot_Server__lookup_events',
            arguments: { query: 'critical' },
          },
        }),
      }),
    );
    expect(called.content).toEqual([{ type: 'text', text: 'durable' }]);
    expect(called.isError).toBe(true);
    expect(toolRegistry.getToolsForRun).toHaveBeenCalledTimes(1);
    expect(toolRegistry.getServerTools).not.toHaveBeenCalled();
    expect(temporalService.executeWorkflowUpdate).toHaveBeenCalledTimes(1);
  });

  it('denormalizes only protocol metadata in durable tool results', async () => {
    mcpRuntimeRepository.getAuthority.mockResolvedValue(externalAuthority());
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('external-node', 'Snapshot Server'),
    ]);
    temporalService.executeWorkflowUpdate.mockResolvedValue({
      operationId: '33333333-3333-4333-8333-333333333333',
      kind: 'completed',
      output: {
        meta: { resultProtocolMetadata: true },
        content: [
          {
            type: 'text',
            text: 'durable metadata',
            meta: { contentProtocolMetadata: true },
          },
          {
            type: 'text',
            text: 'already denormalized',
            _meta: {
              retained: true,
              nestedBusinessValue: { meta: { business: true } },
            },
          },
          {
            type: 'resource_link',
            uri: 'repo://README.md',
            name: 'README',
            meta: { linkProtocolMetadata: true },
          },
          {
            type: 'resource_link',
            uri: expectedResourceFacadeUri('external-node', 'repo://opaque-prefix-shaped-value'),
            name: 'Opaque prefix-shaped upstream URI',
          },
          {
            type: 'resource',
            meta: { blockProtocolMetadata: true },
            resource: {
              uri: 'repo://embedded.txt',
              text: 'embedded',
              meta: { resourceProtocolMetadata: true },
            },
          },
        ],
        structuredContent: {
          meta: { business: true },
          nested: { meta: { alsoBusiness: true } },
        },
      },
      completedAt: '2026-07-31T10:05:00.000Z',
    });
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    const called = await client.callTool({
      name: 'Snapshot_Server__lookup_events',
      arguments: { query: 'critical' },
    });

    expect(called).toMatchObject({
      _meta: { resultProtocolMetadata: true },
      content: [
        {
          type: 'text',
          text: 'durable metadata',
          _meta: { contentProtocolMetadata: true },
        },
        {
          type: 'text',
          text: 'already denormalized',
          _meta: {
            retained: true,
            nestedBusinessValue: { meta: { business: true } },
          },
        },
        {
          type: 'resource_link',
          uri: expectedResourceFacadeUri('external-node', 'repo://README.md'),
          name: 'README',
          _meta: { linkProtocolMetadata: true },
        },
        {
          type: 'resource_link',
          uri: expectedResourceFacadeUri(
            'external-node',
            expectedResourceFacadeUri('external-node', 'repo://opaque-prefix-shaped-value'),
          ),
          name: 'Opaque prefix-shaped upstream URI',
        },
        {
          type: 'resource',
          _meta: { blockProtocolMetadata: true },
          resource: {
            uri: expectedResourceFacadeUri('external-node', 'repo://embedded.txt'),
            text: 'embedded',
            _meta: { resourceProtocolMetadata: true },
          },
        },
      ],
      structuredContent: {
        meta: { business: true },
        nested: { meta: { alsoBusiness: true } },
      },
    });
  });

  it('keeps legacy unbound snapshot tools on the explicit v1 compatibility path', async () => {
    const source = { ...externalSource('external-node', 'Snapshot Server') };
    delete (source as { serverId?: string }).serverId;
    const durableAuthority = externalAuthority(source);
    if (durableAuthority.snapshot.version !== '2') throw new Error('Expected v2 fixture');
    const { runtimeBindings: _runtimeBindings, ...legacySnapshot } = durableAuthority.snapshot;
    const authority: StoredMcpAuthority = {
      ...durableAuthority,
      snapshot: {
        ...legacySnapshot,
        version: '1',
        resources: [{ sourceId: 'external-node', uri: 'repo://ignored', name: 'Ignored' }],
        prompts: [{ sourceId: 'external-node', name: 'ignored', arguments: [] }],
      },
      manifest: {
        capabilitySnapshotId: SNAPSHOT_ID,
        capabilityGrantId: RUN_CONTEXT.capabilityGrantId,
        version: '1',
        entries: [
          {
            toolName: 'Snapshot_Server__lookup_events',
            sourceId: 'external-node',
            destination: 'mcp-activity',
            retryPolicy: 'reviewed-idempotent',
          },
        ],
      },
    };
    const registerResource = jest.spyOn(McpServer.prototype, 'registerResource');
    const registerPrompt = jest.spyOn(McpServer.prototype, 'registerPrompt');
    mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([source]);
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    const called = await client.callTool({
      name: 'Snapshot_Server__lookup_events',
      arguments: { query: 'critical' },
    });

    expect(called.content).toEqual([{ type: 'text', text: 'proxied' }]);
    expect(legacyOutbound.callTool).toHaveBeenCalledWith(
      'run-1',
      source,
      'lookup.events',
      { query: 'critical' },
      authority.snapshot.tools[0]!.source.bindingFingerprint,
    );
    expect(registerResource).not.toHaveBeenCalled();
    expect(registerPrompt).not.toHaveBeenCalled();
    registerResource.mockRestore();
    registerPrompt.mockRestore();
    expect(temporalService.executeWorkflowUpdate).not.toHaveBeenCalled();
    expect(runtimeConfigService.buildRuntimeKey).not.toHaveBeenCalled();
  });

  it('keeps v2 unbound tool-only sources on the owned compatibility path', async () => {
    const source = { ...externalSource('external-node', 'Snapshot Server') };
    delete (source as { serverId?: string }).serverId;
    const authority = externalAuthority(source);
    if (authority.snapshot.version !== '2') throw new Error('Expected v2 fixture');
    authority.snapshot.runtimeBindings = {};
    mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([source]);
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    await client.callTool({
      name: 'Snapshot_Server__lookup_events',
      arguments: { query: 'critical' },
    });

    expect(legacyOutbound.callTool).toHaveBeenCalledWith(
      'run-1',
      source,
      'lookup.events',
      { query: 'critical' },
      authority.snapshot.tools[0]!.source.bindingFingerprint,
    );
    expect(temporalService.executeWorkflowUpdate).not.toHaveBeenCalled();
  });

  it('registers exact/template resources and prompts from the immutable snapshot', async () => {
    const authority = externalAuthorityWithFacade();
    mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('external-node', 'Snapshot Server'),
    ]);
    temporalService.executeWorkflowUpdate.mockImplementation(async ({ args }) => {
      const operation = args.operation as { kind: string; uri?: string };
      if (operation.kind === 'resource-read') {
        return {
          operationId: args.invocationId,
          kind: 'completed',
          output: {
            contents: [
              {
                uri: operation.uri!,
                text: 'snapshot resource',
                meta: { resourceProtocolMetadata: true },
              },
            ],
          },
          completedAt: '2026-07-31T10:05:00.000Z',
        };
      }
      return {
        operationId: args.invocationId,
        kind: 'completed',
        output: {
          description: 'Snapshot prompt description',
          meta: { promptResultProtocolMetadata: true },
          messages: [
            {
              role: 'user',
              content: {
                type: 'resource_link',
                uri: 'repo://README.md',
                name: 'README',
                meta: { promptContentProtocolMetadata: true },
              },
            },
          ],
        },
        completedAt: '2026-07-31T10:05:00.000Z',
      };
    });
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    expect((await client.listResources()).resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: expectedResourceFacadeUri('external-node', 'repo://README.md'),
        }),
      ]),
    );
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uriTemplate: expectedResourceFacadeUri('external-node', 'repo://{+path}'),
        }),
      ]),
    );
    await expect(
      client.readResource({
        uri: expectedResourceFacadeUri('external-node', 'repo://README.md'),
      }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({
          uri: expectedResourceFacadeUri('external-node', 'repo://README.md'),
          text: 'snapshot resource',
          _meta: { resourceProtocolMetadata: true },
        }),
      ],
    });
    await expect(
      client.readResource({
        uri: expectedResourceFacadeUri('external-node', 'repo://src/index.ts'),
      }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({
          uri: expectedResourceFacadeUri('external-node', 'repo://src/index.ts'),
          text: 'snapshot resource',
        }),
      ],
    });
    expect((await client.listPrompts()).prompts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Snapshot_Server__review' })]),
    );
    await expect(
      client.getPrompt({ name: 'Snapshot_Server__review', arguments: { focus: 'auth' } }),
    ).resolves.toMatchObject({
      _meta: { promptResultProtocolMetadata: true },
      description: 'Snapshot prompt description',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: {
            type: 'resource_link',
            uri: expectedResourceFacadeUri('external-node', 'repo://README.md'),
            name: 'README',
            _meta: { promptContentProtocolMetadata: true },
          },
        }),
      ],
    });

    expect(
      temporalService.executeWorkflowUpdate.mock.calls.map(([call]) => call.args.operation.kind),
    ).toEqual(['resource-read', 'resource-read', 'prompt-get']);
  });

  it('namespaces duplicate resource URIs by source and routes reads upstream', async () => {
    const authority = externalAuthorityWithFacade();
    if (authority.snapshot.version !== '2' || authority.manifest.version !== '2') {
      throw new Error('Expected v2 fixture');
    }
    const secondKey = {
      ...savedRuntimeKey(),
      sourceId: 'saved-server-2',
      credentialReference: 'mcp-server:saved-server-2',
    };
    authority.snapshot.runtimeBindings['second-node'] = {
      ...authority.snapshot.runtimeBindings['external-node']!,
      runtimeKey: secondKey,
    };
    authority.snapshot.resources.push({
      sourceId: 'second-node',
      uri: 'repo://README.md',
      name: 'Repository README',
    });
    authority.snapshot.resourceTemplates.push({
      sourceId: 'second-node',
      uriTemplate: 'repo://{+path}',
      name: 'Repository file',
    });
    authority.snapshot.prompts.push({
      sourceId: 'second-node',
      name: 'review',
      arguments: [],
    });
    authority.grant.sources.push({ sourceId: 'second-node', toolAccess: { mode: 'all' } });
    authority.manifest = {
      ...authority.manifest,
      entries: [
        ...authority.manifest.entries,
        {
          operationKind: 'resource-read',
          operationTarget: 'repo://README.md',
          sourceId: 'second-node',
          destination: 'mcp-activity',
          retryPolicy: 'reviewed-idempotent',
        },
        {
          operationKind: 'resource-read',
          operationTarget: 'repo://{+path}',
          sourceId: 'second-node',
          destination: 'mcp-activity',
          retryPolicy: 'reviewed-idempotent',
        },
        {
          operationKind: 'prompt-get',
          operationTarget: 'review',
          sourceId: 'second-node',
          destination: 'mcp-activity',
          retryPolicy: 'reviewed-idempotent',
        },
      ],
    };
    mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('external-node', 'Snapshot Server'),
      { ...externalSource('second-node', 'Second Server'), serverId: 'saved-server-2' },
    ]);
    runtimeConfigService.buildRuntimeKey.mockImplementation(async (_principal, serverId) =>
      serverId === 'saved-server-2' ? secondKey : savedRuntimeKey(),
    );
    temporalService.executeWorkflowUpdate.mockImplementation(async ({ args }) => {
      const operation = args.operation as { kind: string; uri?: string };
      if (operation.kind !== 'resource-read' || !operation.uri) {
        return completedOperationResult();
      }
      return {
        operationId: args.invocationId,
        kind: 'completed',
        output: {
          meta: { resultProtocolMetadata: args.sourceId },
          contents: [
            {
              uri: operation.uri,
              text: `${args.sourceId}:${operation.uri}`,
              meta: { resourceProtocolMetadata: true },
            },
          ],
        },
        completedAt: '2026-07-31T10:05:00.000Z',
      };
    });
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    const firstExactUri = expectedResourceFacadeUri('external-node', 'repo://README.md');
    const secondExactUri = expectedResourceFacadeUri('second-node', 'repo://README.md');
    const firstTemplate = expectedResourceFacadeUri('external-node', 'repo://{+path}');
    const secondTemplate = expectedResourceFacadeUri('second-node', 'repo://{+path}');

    expect((await client.listResources()).resources).toEqual([
      expect.objectContaining({
        name: 'Snapshot_Server__Repository_README',
        uri: firstExactUri,
      }),
      expect.objectContaining({
        name: 'Second_Server__Repository_README',
        uri: secondExactUri,
      }),
    ]);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([
      expect.objectContaining({
        name: 'Snapshot_Server__Repository_file',
        uriTemplate: firstTemplate,
      }),
      expect.objectContaining({
        name: 'Second_Server__Repository_file',
        uriTemplate: secondTemplate,
      }),
    ]);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual([
      'Snapshot_Server__review',
      'Second_Server__review',
    ]);

    const reads = [
      await client.readResource({ uri: firstExactUri }),
      await client.readResource({ uri: secondExactUri }),
      await client.readResource({
        uri: expectedResourceFacadeUri('external-node', 'repo://src/index.ts'),
      }),
      await client.readResource({
        uri: expectedResourceFacadeUri('second-node', 'repo://src/index.ts'),
      }),
    ];

    expect(reads.map((read) => read.contents[0]?.uri)).toEqual([
      firstExactUri,
      secondExactUri,
      expectedResourceFacadeUri('external-node', 'repo://src/index.ts'),
      expectedResourceFacadeUri('second-node', 'repo://src/index.ts'),
    ]);
    expect(reads[0]).toMatchObject({
      _meta: { resultProtocolMetadata: 'external-node' },
      contents: [{ _meta: { resourceProtocolMetadata: true } }],
    });
    expect(
      temporalService.executeWorkflowUpdate.mock.calls.map(([call]) => ({
        sourceId: call.args.sourceId,
        authorizationTarget: call.args.authorizationTarget,
        operationUri: call.args.operation.uri,
      })),
    ).toEqual([
      {
        sourceId: 'external-node',
        authorizationTarget: 'repo://README.md',
        operationUri: 'repo://README.md',
      },
      {
        sourceId: 'second-node',
        authorizationTarget: 'repo://README.md',
        operationUri: 'repo://README.md',
      },
      {
        sourceId: 'external-node',
        authorizationTarget: 'repo://{+path}',
        operationUri: 'repo://src/index.ts',
      },
      {
        sourceId: 'second-node',
        authorizationTarget: 'repo://{+path}',
        operationUri: 'repo://src/index.ts',
      },
    ]);
  });

  it('deduplicates repeated same-source resources without hiding other capabilities', async () => {
    const authority = externalAuthorityWithFacade();
    if (authority.snapshot.version !== '2') throw new Error('Expected v2 fixture');
    authority.snapshot.resources.push({
      ...authority.snapshot.resources[0]!,
      title: 'Duplicate exact resource',
    });
    authority.snapshot.resourceTemplates.push({
      ...authority.snapshot.resourceTemplates[0]!,
      title: 'Duplicate resource template',
    });
    authority.snapshot.resourceTemplates.push({
      ...authority.snapshot.resourceTemplates[0]!,
      uriTemplate: authority.snapshot.resources[0]!.uri,
      title: 'Unreachable literal template',
    });
    mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('external-node', 'Snapshot Server'),
    ]);
    const client = await connectToGateway(service, DURABLE_RUN_CONTEXT, clients, servers);

    expect((await client.listResources()).resources).toEqual([
      expect.objectContaining({ title: 'README' }),
    ]);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([
      expect.objectContaining({ title: 'Repository file' }),
    ]);
    expect((await client.listPrompts()).prompts).toEqual([
      expect.objectContaining({ name: 'Snapshot_Server__review' }),
    ]);
    expect((await client.listTools()).tools).toEqual([
      expect.objectContaining({ name: 'Snapshot_Server__lookup_events' }),
    ]);
  });

  it('rejects an external snapshot when its live binding fingerprint changed', async () => {
    const snapshottedSource = externalSource('external-node', 'Snapshot Server');
    mcpRuntimeRepository.getAuthority.mockResolvedValue(externalAuthority(snapshottedSource));
    (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
      externalSource('external-node', 'Snapshot Server', 'http://127.0.0.1:10/mcp'),
    ]);

    await expect(service.createServerForRun(DURABLE_RUN_CONTEXT)).rejects.toThrow(
      ForbiddenException,
    );
    expect(legacyOutbound.callTool).not.toHaveBeenCalled();
  });

  it.each(['resource', 'prompt'] as const)(
    'rejects a snapshotted %s facade when its live runtime binding changed',
    async (family) => {
      const authority = externalAuthorityWithFacade();
      authority.snapshot.tools = [];
      authority.snapshot.resources = family === 'resource' ? authority.snapshot.resources : [];
      authority.snapshot.resourceTemplates =
        family === 'resource' ? authority.snapshot.resourceTemplates : [];
      authority.snapshot.prompts = family === 'prompt' ? authority.snapshot.prompts : [];
      mcpRuntimeRepository.getAuthority.mockResolvedValue(authority);
      (toolRegistry.getToolsForRun as ReturnType<typeof jest.fn>).mockResolvedValue([
        externalSource('external-node', 'Snapshot Server'),
      ]);
      runtimeConfigService.buildRuntimeKey.mockResolvedValue({
        ...savedRuntimeKey(),
        credentialGeneration: 8,
      });

      await expect(service.createServerForRun(DURABLE_RUN_CONTEXT)).rejects.toThrow(
        ForbiddenException,
      );
      expect(temporalService.executeWorkflowUpdate).not.toHaveBeenCalled();
      expect(legacyOutbound.callTool).not.toHaveBeenCalled();
    },
  );

  it('rejects a snapshot, grant, run, or organization mismatch before tool registration', async () => {
    mcpRuntimeRepository.getAuthority.mockResolvedValue(null);
    const registerTool = jest.spyOn(McpServer.prototype, 'registerTool');

    await expect(service.createServerForRun(DURABLE_RUN_CONTEXT)).rejects.toThrow(
      ForbiddenException,
    );

    expect(mcpRuntimeRepository.getAuthority).toHaveBeenCalledWith({
      capabilityGrantId: RUN_CONTEXT.capabilityGrantId,
      capabilitySnapshotId: SNAPSHOT_ID,
      scope: {
        kind: 'run',
        capabilityGrantId: RUN_CONTEXT.capabilityGrantId,
        organizationId: 'org-1',
        runId: 'run-1',
      },
    });
    expect(registerTool).not.toHaveBeenCalled();
    expect(toolRegistry.getToolsForRun).not.toHaveBeenCalled();
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
  return {
    nodeId,
    serverId: 'saved-server-1',
    toolName,
    type: 'mcp-server',
    endpoint,
    status: 'ready',
    description: `MCP server: ${toolName}`,
    inputSchema: { type: 'object', properties: {} },
  };
}

function withRunContext(overrides: Partial<RunMcpRequestContext>): RunMcpRequestContext {
  return Object.freeze({ ...RUN_CONTEXT, ...overrides });
}

function completedInvocationResult() {
  return {
    invocationId: '33333333-3333-4333-8333-333333333333',
    status: 'completed' as const,
    output: { finding: true },
    completedAt: '2026-07-31T10:05:00.000Z',
  };
}

function completedOperationResult() {
  return {
    operationId: '33333333-3333-4333-8333-333333333333',
    kind: 'completed' as const,
    output: { content: [{ type: 'text', text: 'durable' }], isError: true },
    completedAt: '2026-07-31T10:05:00.000Z',
  };
}

function savedRuntimeKey() {
  return {
    sourceId: 'saved-server-1',
    transport: 'http' as const,
    configFingerprint: 'f'.repeat(64),
    organizationId: 'org-1',
    principalPartitionHash: '1'.repeat(64),
    credentialReference: 'mcp-server:saved-server-1',
    credentialGeneration: 7,
  };
}

function expectedResourceFacadeUri(sourceId: string, upstreamUri: string): string {
  return `sentris-mcp://resource/${Buffer.from(sourceId, 'utf8').toString('base64url')}/${upstreamUri}`;
}

function componentAuthority(): StoredMcpAuthority {
  return authorityFor([
    {
      canonicalName: 'scan_target',
      displayName: 'Snapshot scan',
      title: 'Snapshot scan',
      description: 'Scan one immutable target',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { finding: { type: 'boolean' } },
        required: ['finding'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      meta: { 'x-snapshot': 'immutable' },
      source: {
        kind: 'component',
        sourceId: 'component-node',
        nodeId: 'component-node',
        componentId: 'test.gateway-component',
        bindingFingerprint: 'a'.repeat(64),
      },
      effects: 'read-only',
      effectsSource: 'sentris-contract',
      retryPolicy: 'pre-dispatch-only',
    },
  ]);
}

function externalAuthority(
  source = externalSource('external-node', 'Snapshot Server'),
): StoredMcpAuthority {
  const tool = {
    canonicalName: 'Snapshot_Server__lookup_events',
    displayName: 'Immutable lookup',
    title: 'Immutable lookup',
    description: 'Search the snapshotted upstream tool',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    meta: { 'x-source': 'snapshot' },
    source: {
      kind: 'mcp',
      sourceId: 'external-node',
      nodeId: 'external-node',
      upstreamName: 'lookup.events',
      bindingFingerprint: '',
    },
    effects: 'read-only',
    effectsSource: 'mcp-annotation',
    retryPolicy: 'reviewed-idempotent',
  } satisfies StoredMcpAuthority['snapshot']['tools'][number];
  tool.source.bindingFingerprint = computeMcpBindingFingerprint(source, [
    {
      name: tool.source.upstreamName,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      _meta: tool.meta,
    },
  ]);
  return authorityFor([tool]);
}

function externalAuthorityWithFacade(): StoredMcpAuthority {
  const authority = externalAuthority();
  if (authority.snapshot.version !== '2' || authority.manifest.version !== '2') {
    throw new Error('Expected v2 authority fixture');
  }
  authority.snapshot.resources = [
    {
      sourceId: 'external-node',
      uri: 'repo://README.md',
      name: 'Repository README',
      title: 'README',
      mimeType: 'text/markdown',
    },
  ];
  authority.snapshot.resourceTemplates = [
    {
      sourceId: 'external-node',
      uriTemplate: 'repo://{+path}',
      name: 'Repository file',
      title: 'Repository file',
      mimeType: 'text/plain',
    },
  ];
  authority.snapshot.prompts = [
    {
      sourceId: 'external-node',
      name: 'review',
      title: 'Review repository',
      description: 'Review one area',
      arguments: [{ name: 'focus', description: 'Review focus', required: true }],
    },
  ];
  authority.manifest = {
    ...authority.manifest,
    entries: [
      ...authority.manifest.entries,
      {
        operationKind: 'resource-read',
        operationTarget: 'repo://README.md',
        sourceId: 'external-node',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'resource-read',
        operationTarget: 'repo://{+path}',
        sourceId: 'external-node',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'prompt-get',
        operationTarget: 'review',
        sourceId: 'external-node',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
    ],
  };
  return authority;
}

function authorityFor(tools: StoredMcpAuthority['snapshot']['tools']): StoredMcpAuthority {
  const createdAt = '2026-07-31T10:00:00.000Z';
  return {
    grant: {
      id: RUN_CONTEXT.capabilityGrantId,
      organizationId: 'org-1',
      subject: { kind: 'run', runId: 'run-1' },
      sources: tools.map((tool) => ({
        sourceId: tool.source.sourceId,
        toolAccess: { mode: 'all' as const },
      })),
      createdAt,
    },
    snapshot: {
      id: SNAPSHOT_ID,
      scope: {
        kind: 'run',
        runId: 'run-1',
        organizationId: 'org-1',
        capabilityGrantId: RUN_CONTEXT.capabilityGrantId,
      },
      version: '2',
      configFingerprint: 'c'.repeat(64),
      runtimeBindings: Object.fromEntries(
        tools
          .filter((tool) => tool.source.kind === 'mcp')
          .map((tool) => [
            tool.source.sourceId,
            {
              runtimeKey: savedRuntimeKey(),
              protocolEra: 'modern' as const,
              protocolVersion: '2026-07-28',
              capabilityFingerprint: '2'.repeat(64),
            },
          ]),
      ),
      tools,
      resources: [],
      resourceTemplates: [],
      prompts: [],
      createdAt,
    },
    manifest: {
      capabilitySnapshotId: SNAPSHOT_ID,
      capabilityGrantId: RUN_CONTEXT.capabilityGrantId,
      version: '2',
      entries: tools.map((tool) => ({
        operationKind: 'tool-call' as const,
        operationTarget: tool.canonicalName,
        sourceId: tool.source.sourceId,
        destination: tool.source.kind === 'component' ? 'component-activity' : 'mcp-activity',
        retryPolicy: tool.retryPolicy,
      })),
    },
  };
}
