import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  inputs,
  outputs,
  parameters,
  param,
  port,
  type ComponentDefinition,
} from '@sentris/component-sdk';
import type { McpToolRegistrationDescriptor } from '@sentris/shared';

import { computeMcpBindingFingerprint } from '../mcp-binding-fingerprint';
import { McpRunCatalogService } from '../mcp-run-catalog.service';
import type { RegisteredTool } from '../../mcp/tool-registry.service';

const EXTERNAL_TOOLS: McpToolRegistrationDescriptor[] = [
  {
    name: 'lookup.events',
    title: 'Lookup events',
    description: 'Search upstream events',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
      'x-input-extension': 'preserved',
    },
    outputSchema: {
      type: 'object',
      properties: { count: { type: 'integer', minimum: 0 } },
      required: ['count'],
      'x-output-extension': 'preserved',
    },
    icons: [{ src: 'https://example.test/tool.svg', mimeType: 'image/svg+xml' }],
    annotations: { readOnlyHint: true, idempotentHint: true },
    _meta: { 'x-upstream': 'redis-discovery' },
  },
];

function catalogComponent(profileExposed: boolean): ComponentDefinition {
  return {
    id: 'test.catalog-component-binding',
    label: 'Catalog component binding',
    category: 'security',
    runner: { kind: 'inline' },
    inputs: inputs({
      target: port(z.string(), { label: 'Target' }),
    }),
    outputs: outputs({}),
    parameters: parameters({
      profile: param(z.string().default('default'), {
        label: 'Profile',
        editor: 'text',
        exposeToTool: profileExposed,
      }),
    }),
    toolProvider: {
      kind: 'component',
      name: 'scan_target',
      description: 'Scan one target',
    },
    execute: async () => ({}),
  };
}

const CATALOG_COMPONENT = catalogComponent(true);

describe('McpRunCatalogService', () => {
  beforeEach(() => {
    vi.spyOn(componentRegistry, 'get');
    (
      componentRegistry.get as unknown as {
        mockImplementation(
          implementation: (componentId: string) => ComponentDefinition | undefined,
        ): void;
      }
    ).mockImplementation((componentId) =>
      componentId === CATALOG_COMPONENT.id ? CATALOG_COMPONENT : undefined,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('materializes a closed component descriptor bound to its workflow node', async () => {
    const component = componentSource();
    const service = createService({ sources: [component] });

    const catalog = await service.build({ runId: 'run-1', allowedNodeIds: ['component-node'] });

    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0]).toEqual({
      canonicalName: 'scan_target',
      displayName: 'scan_target',
      description: 'Scan one target',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
        additionalProperties: false,
      },
      source: {
        kind: 'component',
        sourceId: 'component-node',
        nodeId: 'component-node',
        componentId: CATALOG_COMPONENT.id,
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      effects: 'unknown',
      effectsSource: 'sentris-contract',
      retryPolicy: 'pre-dispatch-only',
    });
    expect(JSON.stringify(catalog)).not.toContain(component.encryptedCredentials);
  });

  it('filters hierarchical node scope before preserving external names, schemas, and metadata', async () => {
    const included = externalSource('parent/child', 'External Server');
    const excluded = externalSource('sibling/child', 'Other Server');
    const service = createService({
      sources: [included, excluded],
      getServerTools: async (_runId, nodeId) =>
        nodeId === included.nodeId ? EXTERNAL_TOOLS : [{ name: 'must-not-leak' }],
    });

    const catalog = await service.build({ runId: 'run-1', allowedNodeIds: ['parent'] });

    expect(catalog.tools).toEqual([
      {
        canonicalName: 'External_Server__lookup_events',
        displayName: 'Lookup events',
        title: 'Lookup events',
        description: 'Search upstream events',
        inputSchema: EXTERNAL_TOOLS[0].inputSchema!,
        outputSchema: EXTERNAL_TOOLS[0].outputSchema,
        icons: EXTERNAL_TOOLS[0].icons,
        annotations: EXTERNAL_TOOLS[0].annotations,
        meta: EXTERNAL_TOOLS[0]._meta,
        source: {
          kind: 'mcp',
          sourceId: 'parent/child',
          nodeId: 'parent/child',
          upstreamName: 'lookup.events',
          bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        effects: 'read-only',
        effectsSource: 'mcp-annotation',
        retryPolicy: 'reviewed-idempotent',
      },
    ]);
  });

  it('uses database descriptors before the live fallback and snapshots live discovery once', async () => {
    const saved = externalSource('saved-node', 'Saved', undefined, 'saved-server');
    saved.type = 'remote-mcp';
    const local = externalSource('local-node', 'Local');
    local.type = 'local-mcp';
    const listTools = vi.fn(async () => [
      {
        toolName: 'saved-search',
        description: 'Saved search',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        enabled: true,
      },
    ]);
    const discoverTools = vi.fn(async () => [
      { name: 'live-search', inputSchema: { type: 'object' } },
    ]);
    const service = createService({
      sources: [saved, local],
      getServerTools: async () => null,
      listTools,
      discoverTools,
    });

    const catalog = await service.build({ runId: 'run-1', allowedNodeIds: [] });

    expect(catalog.tools.map((tool) => tool.canonicalName)).toEqual([
      'Local__live-search',
      'Saved__saved-search',
    ]);
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(discoverTools).toHaveBeenCalledTimes(1);
  });

  it('fingerprints canonical non-secret bindings deterministically and changes on every binding input', async () => {
    const base = componentSource();
    const reordered: RegisteredTool = {
      ...base,
      parameters: { nested: { a: 1, b: 2 }, first: true },
      inputSchema: {
        required: ['target'],
        properties: { target: { type: 'string' } },
        type: 'object',
      },
    };
    base.parameters = { first: true, nested: { b: 2, a: 1 } };
    const publicDescriptor: McpToolRegistrationDescriptor = {
      name: base.toolName,
      description: base.description,
      inputSchema: { ...base.inputSchema, additionalProperties: false },
    };

    const original = computeMcpBindingFingerprint(base, [publicDescriptor], CATALOG_COMPONENT);
    const same = computeMcpBindingFingerprint(
      reordered,
      [
        {
          inputSchema: {
            additionalProperties: false,
            type: 'object',
            properties: { target: { type: 'string' } },
            required: ['target'],
          },
          description: base.description,
          name: base.toolName,
        },
      ],
      CATALOG_COMPONENT,
    );
    const variants = [
      { ...base, endpoint: 'https://changed.example.test/mcp' },
      { ...base, parameters: { first: false, nested: { b: 2, a: 1 } } },
      { ...base, inputSchema: { type: 'object', properties: { other: { type: 'string' } } } },
      { ...base, encryptedCredentials: 'ciphertext-version-2' },
    ];

    expect(same).toBe(original);
    for (const variant of variants) {
      const descriptor = {
        ...publicDescriptor,
        inputSchema: { ...variant.inputSchema, additionalProperties: false },
      };
      expect(computeMcpBindingFingerprint(variant, [descriptor], CATALOG_COMPONENT)).not.toBe(
        original,
      );
    }

    const catalog = await createService({ sources: [base] }).build({
      runId: 'run-1',
      allowedNodeIds: ['component-node'],
    });
    expect(catalog.tools[0].source.bindingFingerprint).toBe(original);
    expect(JSON.stringify(catalog)).not.toContain('ciphertext-version-1');
  });

  it('changes the materialized binding when the current component dispatch surface drifts', async () => {
    const source = componentSource();
    const service = createService({ sources: [source] });
    const original = await service.build({
      runId: 'run-1',
      allowedNodeIds: ['component-node'],
    });
    (
      componentRegistry.get as unknown as {
        mockReturnValue(value: ComponentDefinition): void;
      }
    ).mockReturnValue(catalogComponent(false));

    const drifted = await service.build({
      runId: 'run-1',
      allowedNodeIds: ['component-node'],
    });

    expect(drifted.tools[0].source.bindingFingerprint).not.toBe(
      original.tools[0].source.bindingFingerprint,
    );
  });
});

function createService(input: {
  sources: RegisteredTool[];
  getServerTools?: (
    runId: string,
    nodeId: string,
  ) => Promise<McpToolRegistrationDescriptor[] | null>;
  listTools?: (serverId: string) => Promise<unknown[]>;
  discoverTools?: (
    runId: string,
    source: RegisteredTool,
  ) => Promise<McpToolRegistrationDescriptor[]>;
}): McpRunCatalogService {
  return new McpRunCatalogService(
    {
      getToolsForRun: async () => input.sources,
      getServerTools: input.getServerTools ?? (async () => null),
    } as never,
    { listTools: input.listTools ?? (async () => []) } as never,
    { discoverTools: input.discoverTools ?? (async () => []) } as never,
  );
}

function componentSource(): RegisteredTool {
  return {
    nodeId: 'component-node',
    toolName: 'scan_target',
    type: 'component',
    status: 'ready',
    exposedToAgent: true,
    componentId: CATALOG_COMPONENT.id,
    description: 'Scan one target',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
    },
    parameters: {},
    encryptedCredentials: 'ciphertext-version-1',
    registeredAt: '2026-07-31T10:00:00.000Z',
  };
}

function externalSource(
  nodeId: string,
  toolName: string,
  endpoint = 'https://mcp.example.test/mcp',
  serverId?: string,
): RegisteredTool {
  return {
    nodeId,
    toolName,
    type: 'mcp-server',
    status: 'ready',
    description: `MCP server: ${toolName}`,
    inputSchema: { type: 'object', properties: {} },
    endpoint,
    serverId,
    registeredAt: '2026-07-31T10:00:00.000Z',
  };
}
