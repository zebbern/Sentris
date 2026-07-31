import { describe, expect, it } from 'bun:test';
import {
  CapabilityGrantSchema,
  ExecutionScopeSchema,
  McpCapabilityCatalogSnapshotSchema,
  ToolDescriptorSchema,
} from '../mcp-capabilities.js';

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const EXPIRES_AT = '2026-08-01T12:00:00.000Z';

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
