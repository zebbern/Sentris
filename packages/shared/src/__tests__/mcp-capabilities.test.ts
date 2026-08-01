import { describe, expect, it } from 'bun:test';
import {
  CapabilityGrantSchema,
  ExecutionScopeSchema,
  McpCapabilityCatalogSnapshotSchema,
  McpResolvedRuntimeDefinitionSchema,
  ToolDescriptorSchema,
} from '../mcp-capabilities.js';
import { InvocationManifestSchema, MAX_INVOCATION_MANIFEST_ENTRIES } from '../mcp-invocation.js';

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const RUNTIME_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_EPOCH = '55555555-5555-4555-8555-555555555555';
const EXPIRES_AT = '2026-08-01T12:00:00.000Z';
const HASH = 'a'.repeat(64);

const runtimeKey = {
  sourceId: 'mcp:github',
  transport: 'http' as const,
  configFingerprint: HASH,
  organizationId: null,
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: 'secret:mcp-github',
  credentialGeneration: 7,
};

const fence = {
  runtimeId: RUNTIME_ID,
  ownerId: 'worker-3',
  ownerEpoch: OWNER_EPOCH,
  leaseGeneration: 4,
};

describe('ExecutionScopeSchema', () => {
  it.each([
    {
      kind: 'run' as const,
      organizationId: null,
      runId: 'run-123',
      capabilityGrantId: GRANT_ID,
      invokingNodeId: 'agent-node',
    },
    {
      kind: 'studio' as const,
      organizationId: 'org-123',
      operationId: OPERATION_ID,
      capabilityGrantId: GRANT_ID,
      expiresAt: EXPIRES_AT,
    },
    {
      kind: 'discovery' as const,
      organizationId: null,
      operationId: OPERATION_ID,
      capabilityGrantId: GRANT_ID,
      expiresAt: EXPIRES_AT,
    },
  ])('accepts the strict $kind scope variant', (scope) => {
    expect(ExecutionScopeSchema.parse(scope)).toEqual(scope);
  });

  it('rejects malformed UUIDs and datetimes', () => {
    expect(
      ExecutionScopeSchema.safeParse({
        kind: 'studio',
        organizationId: null,
        operationId: 'not-a-uuid',
        capabilityGrantId: GRANT_ID,
        expiresAt: 'tomorrow',
      }).success,
    ).toBe(false);
  });

  it('rejects fields belonging to a different scope kind', () => {
    expect(
      ExecutionScopeSchema.safeParse({
        kind: 'run',
        organizationId: null,
        runId: 'run-123',
        operationId: OPERATION_ID,
        capabilityGrantId: GRANT_ID,
      }).success,
    ).toBe(false);
  });
});

describe('CapabilityGrantSchema', () => {
  it('accepts a nullable organization and strict subject/tool access shapes', () => {
    const grant = {
      id: GRANT_ID,
      organizationId: null,
      subject: { kind: 'run' as const, runId: 'run-123' },
      sources: [
        { sourceId: 'component:scanner', toolAccess: { mode: 'all' as const } },
        {
          sourceId: 'mcp:github',
          toolAccess: { mode: 'subset' as const, names: ['search_code'] },
        },
      ],
      createdAt: '2026-07-31T10:00:00.000Z',
    };

    expect(CapabilityGrantSchema.parse(grant)).toEqual(grant);
  });

  it('rejects malformed grant UUIDs and datetimes', () => {
    expect(
      CapabilityGrantSchema.safeParse({
        id: 'not-a-uuid',
        organizationId: null,
        subject: {
          kind: 'studio',
          operationId: OPERATION_ID,
          expiresAt: 'later',
        },
        sources: [],
        createdAt: 'today',
      }).success,
    ).toBe(false);
  });

  it('rejects cross-kind subject fields', () => {
    expect(
      CapabilityGrantSchema.safeParse({
        id: GRANT_ID,
        organizationId: null,
        subject: { kind: 'run', runId: 'run-123', expiresAt: EXPIRES_AT },
        sources: [],
        createdAt: '2026-07-31T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate source grants', () => {
    expect(
      CapabilityGrantSchema.safeParse({
        id: GRANT_ID,
        organizationId: 'org-123',
        subject: { kind: 'run', runId: 'run-123' },
        sources: [
          { sourceId: 'mcp:github', toolAccess: { mode: 'all' } },
          { sourceId: 'mcp:github', toolAccess: { mode: 'subset', names: ['search_code'] } },
        ],
        createdAt: '2026-07-31T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('capability descriptors', () => {
  it('round-trips JSON Schema and MCP metadata without losing extension fields', () => {
    const descriptor = {
      canonicalName: 'github.search_code',
      displayName: 'Search code',
      description: 'Search source code',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $defs: {
          query: { type: 'string', minLength: 1, 'x-sentris-secret': false },
        },
        type: 'object',
        properties: {
          query: { $ref: '#/$defs/query' },
          qualifier: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            allOf: [{ 'x-upstream-constraint': 'searchable' }],
            oneOf: [{ const: 'repo' }, { const: 'org' }],
          },
        },
        _meta: { upstream: { pagination: true } },
        'x-provider': 'github',
      },
      outputSchema: {
        type: 'array',
        items: { $ref: '#/$defs/result' },
        $defs: { result: { type: 'object' } },
      },
      source: {
        kind: 'mcp' as const,
        sourceId: 'mcp:github',
        serverId: 'github-server',
        nodeId: 'github-node',
        upstreamName: 'search_code',
        bindingFingerprint: 'b'.repeat(64),
      },
      title: 'GitHub code search',
      icons: [
        {
          src: 'https://example.com/github.svg',
          mimeType: 'image/svg+xml',
          sizes: ['any'],
          theme: 'dark' as const,
        },
      ],
      annotations: { readOnlyHint: true, 'x-risk': 'low' },
      meta: { upstream: { revision: 2 }, 'x-catalog': 'primary' },
      effects: 'read-only' as const,
      effectsSource: 'mcp-annotation' as const,
      retryPolicy: 'reviewed-idempotent' as const,
    };

    expect(ToolDescriptorSchema.parse(descriptor)).toEqual(descriptor);
  });

  it('accepts an ephemeral MCP source without inventing a saved server ID', () => {
    const source = {
      kind: 'mcp' as const,
      sourceId: 'local-node',
      nodeId: 'local-node',
      upstreamName: 'scan',
      bindingFingerprint: 'c'.repeat(64),
    };

    expect(
      ToolDescriptorSchema.parse({
        canonicalName: 'local__scan',
        displayName: 'scan',
        inputSchema: { type: 'object' },
        source,
        effects: 'unknown',
        effectsSource: 'unknown',
        retryPolicy: 'pre-dispatch-only',
      }).source,
    ).toEqual(source);
  });

  it('rejects invocation manifests above the bounded entry count', () => {
    const entries = Array.from({ length: MAX_INVOCATION_MANIFEST_ENTRIES + 1 }, (_, index) => ({
      toolName: `tool-${index}`,
      sourceId: `source-${index}`,
      destination: 'component-activity' as const,
      retryPolicy: 'pre-dispatch-only' as const,
    }));

    expect(
      InvocationManifestSchema.safeParse({
        capabilitySnapshotId: SNAPSHOT_ID,
        capabilityGrantId: GRANT_ID,
        version: '1',
        entries,
      }).success,
    ).toBe(false);
  });

  it('accepts an empty catalog without claiming resource or prompt runtime support', () => {
    const snapshot = {
      id: SNAPSHOT_ID,
      scope: {
        kind: 'discovery' as const,
        organizationId: null,
        operationId: OPERATION_ID,
        capabilityGrantId: GRANT_ID,
        expiresAt: EXPIRES_AT,
      },
      version: '1' as const,
      configFingerprint: 'a'.repeat(64),
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      createdAt: '2026-07-31T10:00:00.000Z',
    };

    expect(McpCapabilityCatalogSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
});

describe('MCP runtime ownership contracts', () => {
  it('preserves the bounded Docker container options needed by saved stdio servers', () => {
    const definition = {
      sourceId: 'server-a',
      configFingerprint: HASH,
      bindingFingerprint: 'b'.repeat(64),
      kind: 'docker-stdio' as const,
      image: 'example/mcp:latest',
      command: ['serve'],
      volumes: ['cache:/data:ro', 'C:\\Work Space:/workspace'],
      mounts: ['type=bind,src=/source path,dst=/workspace,readonly'],
      workingDirectory: '/workspace',
      user: '1000:1000',
      entrypoint: '',
      readOnlyRootFilesystem: true,
      init: true,
    };

    expect(McpResolvedRuntimeDefinitionSchema.parse(definition)).toEqual(definition);
    expect(
      McpResolvedRuntimeDefinitionSchema.safeParse({
        ...definition,
        volumes: Array.from({ length: 65 }, (_, index) => `volume-${index}:/data`),
      }).success,
    ).toBe(false);
    expect(
      McpResolvedRuntimeDefinitionSchema.safeParse({
        ...definition,
        mounts: ['type=bind,src=/safe,dst=/data\0escaped'],
      }).success,
    ).toBe(false);
  });

  it('parses a strict nullable-organization runtime key without resolved credentials', async () => {
    const runtimeContracts = (await import('../mcp-capabilities.js')) as Record<string, any>;
    const schema = runtimeContracts.McpRuntimeKeySchema;

    expect(schema.parse(runtimeKey)).toEqual(runtimeKey);
    expect(schema.safeParse({ ...runtimeKey, configFingerprint: 'not-a-hash' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...runtimeKey, principalPartitionHash: 'C'.repeat(64) }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...runtimeKey, resolvedHeaders: { authorization: 'secret' } }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...runtimeKey, token: 'secret' }).success).toBe(false);

    const serialized = JSON.stringify(schema.parse(runtimeKey));
    expect(serialized).toContain('"credentialReference":"secret:mcp-github"');
    expect(serialized).toContain('"credentialGeneration":7');
    expect(serialized).not.toContain('resolvedHeaders');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('token');
  });

  it('requires paired credential reference and generation values', async () => {
    const runtimeContracts = (await import('../mcp-capabilities.js')) as Record<string, any>;
    const schema = runtimeContracts.McpRuntimeKeySchema;

    expect(
      schema.parse({
        ...runtimeKey,
        credentialReference: null,
        credentialGeneration: null,
      }),
    ).toEqual({
      ...runtimeKey,
      credentialReference: null,
      credentialGeneration: null,
    });
    expect(
      schema.safeParse({ ...runtimeKey, credentialReference: null, credentialGeneration: 7 })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...runtimeKey,
        credentialReference: 'secret:mcp-github',
        credentialGeneration: null,
      }).success,
    ).toBe(false);
  });

  it('acquires with an unfenced candidate owner and rejects leaked owner internals', async () => {
    const runtimeContracts = (await import('../mcp-capabilities.js')) as Record<string, any>;
    const schema = runtimeContracts.McpRuntimeAcquireRequestSchema;
    const request = {
      runtimeKey,
      candidateOwner: {
        ownerId: 'worker-3',
        ownerEpoch: OWNER_EPOCH,
        ownerAddress: 'http://sentris-worker-3:9200',
      },
    };

    expect(schema.parse(request)).toEqual(request);
    expect(schema.safeParse({ ...request, fence }).success).toBe(false);
    expect(
      schema.safeParse({
        ...request,
        candidateOwner: { ...request.candidateOwner, ownerEpoch: 'stable-worker-name' },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...request,
        candidateOwner: {
          ...request.candidateOwner,
          ownerAddress: 'http://token@sentris-worker-3:9200',
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...request,
        candidateOwner: { ...request.candidateOwner, processId: 1234 },
      }).success,
    ).toBe(false);
  });

  it.each(['ready', 'draining'] as const)(
    'validates the complete returned fence and direct %s runtime reference',
    async (state) => {
      const runtimeContracts = (await import('../mcp-capabilities.js')) as Record<string, any>;
      const fenceSchema = runtimeContracts.McpRuntimeFenceSchema;
      const refSchema = runtimeContracts.McpRuntimeRefSchema;
      const ref = {
        fence,
        protocolEra: 'modern' as const,
        protocolVersion: '2026-07-28',
        ownerAddress: 'https://sentris-worker-3.internal:9200',
        state,
        leaseExpiresAt: EXPIRES_AT,
        capabilityFingerprint: 'c'.repeat(64),
      };

      expect(fenceSchema.parse(fence)).toEqual(fence);
      expect(fenceSchema.safeParse({ ...fence, ownerEpoch: 'worker-boot' }).success).toBe(false);
      expect(fenceSchema.safeParse({ ...fence, leaseGeneration: 0 }).success).toBe(false);
      expect(refSchema.parse(ref)).toEqual(ref);
      expect(refSchema.safeParse({ ...ref, ownerAddress: 'sentris-worker-3:9200' }).success).toBe(
        false,
      );
      expect(
        refSchema.safeParse({ ...ref, containerEndpoint: 'http://container:3000' }).success,
      ).toBe(false);
      expect(refSchema.safeParse({ ...ref, token: 'secret' }).success).toBe(false);
    },
  );

  it('keeps owner routing and negotiated identity unpublished while starting', async () => {
    const runtimeContracts = (await import('../mcp-capabilities.js')) as Record<string, any>;
    const schema = runtimeContracts.McpRuntimeRefSchema;
    const startingRef = {
      fence,
      protocolEra: null,
      protocolVersion: null,
      ownerAddress: null,
      state: 'starting' as const,
      leaseExpiresAt: EXPIRES_AT,
      capabilityFingerprint: null,
    };

    expect(schema.parse(startingRef)).toEqual(startingRef);
    expect(
      schema.safeParse({
        ...startingRef,
        ownerAddress: 'http://sentris-worker-3:9200',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...startingRef,
        state: 'ready',
      }).success,
    ).toBe(false);
  });

  it('parses strict runtime health and complete capability catalog shapes', async () => {
    const runtimeContracts = (await import('../mcp-capabilities.js')) as Record<string, any>;
    const health = {
      fence,
      state: 'ready' as const,
      status: 'healthy' as const,
      checkedAt: '2026-08-01T11:59:00.000Z',
      leaseExpiresAt: EXPIRES_AT,
    };
    const catalog = {
      protocolEra: 'modern' as const,
      protocolVersion: '2026-07-28',
      capabilityFingerprint: 'd'.repeat(64),
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
    };

    expect(runtimeContracts.McpRuntimeHealthSchema.parse(health)).toEqual(health);
    expect(
      runtimeContracts.McpRuntimeHealthSchema.safeParse({ ...health, resolvedToken: 'secret' })
        .success,
    ).toBe(false);
    expect(runtimeContracts.McpCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(
      runtimeContracts.McpCatalogSchema.safeParse({
        ...catalog,
        capabilityFingerprint: HASH.slice(1),
      }).success,
    ).toBe(false);
  });

  it('exports the SDK-independent runtime schemas from the shared entry point', async () => {
    const shared = (await import('../index.js')) as Record<string, any>;

    expect(typeof shared.McpRuntimeKeySchema?.parse).toBe('function');
    expect(typeof shared.McpRuntimeAcquireRequestSchema?.parse).toBe('function');
    expect(typeof shared.McpRuntimeRefSchema?.parse).toBe('function');
    expect(typeof shared.McpRuntimeHealthSchema?.parse).toBe('function');
    expect(typeof shared.McpCatalogSchema?.parse).toBe('function');
  });
});
