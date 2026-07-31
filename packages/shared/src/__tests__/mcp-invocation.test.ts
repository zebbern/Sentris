import { describe, expect, it } from 'bun:test';
import type {
  CapabilityGrant,
  ExecutionScope,
  McpCapabilityCatalogSnapshot,
  ToolDescriptor,
} from '../mcp-capabilities.js';
import {
  assertCapabilityGrantApplies,
  buildInvocationManifest,
  resolveInvocationManifestEntry,
  type InvocationManifest,
  type InvocationManifestEntry,
} from '../mcp-invocation.js';

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GRANT_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

const scope: ExecutionScope = {
  kind: 'run',
  organizationId: 'org-123',
  runId: 'run-123',
  capabilityGrantId: GRANT_ID,
  invokingNodeId: 'agent-node',
};

const grant: CapabilityGrant = {
  id: GRANT_ID,
  organizationId: 'org-123',
  subject: { kind: 'run', runId: 'run-123' },
  sources: [
    { sourceId: 'component:scanner', toolAccess: { mode: 'all' } },
    {
      sourceId: 'mcp:github',
      toolAccess: {
        mode: 'subset',
        names: ['github.search_code', 'github.create_issue'],
      },
    },
  ],
  createdAt: '2026-07-31T10:00:00.000Z',
};

function componentTool(
  canonicalName: string,
  overrides: Partial<ToolDescriptor> = {},
): ToolDescriptor {
  return {
    canonicalName,
    displayName: canonicalName,
    description: `Description for ${canonicalName}`,
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { target: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    source: {
      kind: 'component',
      sourceId: 'component:scanner',
      nodeId: 'scanner-node',
      componentId: 'security.scanner',
    },
    title: 'Scanner',
    icons: [{ src: 'https://example.com/scanner.svg' }],
    annotations: { audience: ['assistant'] },
    meta: { catalog: 'official' },
    effects: 'idempotent',
    effectsSource: 'sentris-contract',
    retryPolicy: 'reviewed-idempotent',
    ...overrides,
  };
}

function mcpTool(
  canonicalName: string,
  overrides: Partial<ToolDescriptor> = {},
): ToolDescriptor {
  return {
    canonicalName,
    displayName: canonicalName,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    source: {
      kind: 'mcp',
      sourceId: 'mcp:github',
      serverId: 'github-server',
      upstreamName: canonicalName.split('.')[1] ?? canonicalName,
    },
    effects: 'read-only',
    effectsSource: 'mcp-annotation',
    retryPolicy: 'reviewed-idempotent',
    ...overrides,
  };
}

function snapshot(tools: ToolDescriptor[]): McpCapabilityCatalogSnapshot {
  return {
    id: SNAPSHOT_ID,
    scope,
    version: '1',
    configFingerprint: 'a'.repeat(64),
    tools,
    resources: [],
    resourceTemplates: [],
    prompts: [],
    createdAt: '2026-07-31T10:00:00.000Z',
  };
}

describe('assertCapabilityGrantApplies', () => {
  it.each([
    {
      name: 'run',
      scope: {
        kind: 'run' as const,
        organizationId: null,
        runId: 'run-local',
        capabilityGrantId: GRANT_ID,
      },
      grant: {
        ...grant,
        organizationId: null,
        subject: { kind: 'run' as const, runId: 'run-local' },
      },
    },
    {
      name: 'studio',
      scope: {
        kind: 'studio' as const,
        organizationId: 'org-123',
        operationId: '44444444-4444-4444-8444-444444444444',
        capabilityGrantId: GRANT_ID,
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
      grant: {
        ...grant,
        subject: {
          kind: 'studio' as const,
          operationId: '44444444-4444-4444-8444-444444444444',
          expiresAt: '2026-08-01T12:00:00.000Z',
        },
      },
    },
    {
      name: 'discovery',
      scope: {
        kind: 'discovery' as const,
        organizationId: 'org-123',
        operationId: '55555555-5555-4555-8555-555555555555',
        capabilityGrantId: GRANT_ID,
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
      grant: {
        ...grant,
        subject: {
          kind: 'discovery' as const,
          operationId: '55555555-5555-4555-8555-555555555555',
          expiresAt: '2026-08-01T12:00:00.000Z',
        },
      },
    },
  ])('accepts matching $name organization, subject, and expiry bindings', ({ scope, grant }) => {
    expect(() => assertCapabilityGrantApplies(scope, grant)).not.toThrow();
  });

  const bindingMismatches: Array<{
    name: string;
    scope: ExecutionScope;
    grant: CapabilityGrant;
  }> = [
    {
      name: 'grant id',
      scope: { ...scope, capabilityGrantId: OTHER_GRANT_ID },
      grant,
    },
    {
      name: 'organization',
      scope: { ...scope, organizationId: 'other-org' },
      grant,
    },
    {
      name: 'subject kind',
      scope,
      grant: {
        ...grant,
        subject: {
          kind: 'studio' as const,
          operationId: '44444444-4444-4444-8444-444444444444',
          expiresAt: '2026-08-01T12:00:00.000Z',
        },
      },
    },
    {
      name: 'subject id',
      scope,
      grant: { ...grant, subject: { kind: 'run' as const, runId: 'other-run' } },
    },
    {
      name: 'expiry',
      scope: {
        kind: 'studio' as const,
        organizationId: 'org-123',
        operationId: '44444444-4444-4444-8444-444444444444',
        capabilityGrantId: GRANT_ID,
        expiresAt: '2026-08-02T12:00:00.000Z',
      },
      grant: {
        ...grant,
        subject: {
          kind: 'studio' as const,
          operationId: '44444444-4444-4444-8444-444444444444',
          expiresAt: '2026-08-01T12:00:00.000Z',
        },
      },
    },
  ];

  it.each(bindingMismatches)('rejects a mismatched $name binding', (mismatch) => {
    expect(() => assertCapabilityGrantApplies(mismatch.scope, mismatch.grant)).toThrow();
  });
});

describe('buildInvocationManifest', () => {
  it('sorts authorized entries and maps component and MCP destinations', () => {
    const manifest = buildInvocationManifest(
      snapshot([
        mcpTool('github.ungranted_tool'),
        mcpTool('github.search_code'),
        componentTool('scanner.scan_target'),
        mcpTool('github.create_issue', {
          effectsSource: 'operator-policy',
        }),
        mcpTool('other.list', {
          source: {
            kind: 'mcp',
            sourceId: 'mcp:other',
            serverId: 'other-server',
            upstreamName: 'list',
          },
        }),
      ]),
      grant,
    );

    expect(manifest).toEqual({
      capabilitySnapshotId: SNAPSHOT_ID,
      capabilityGrantId: GRANT_ID,
      version: '1',
      entries: [
        {
          toolName: 'github.create_issue',
          sourceId: 'mcp:github',
          destination: 'mcp-activity',
          retryPolicy: 'reviewed-idempotent',
        },
        {
          toolName: 'github.search_code',
          sourceId: 'mcp:github',
          destination: 'mcp-activity',
          retryPolicy: 'pre-dispatch-only',
        },
        {
          toolName: 'scanner.scan_target',
          sourceId: 'component:scanner',
          destination: 'component-activity',
          retryPolicy: 'reviewed-idempotent',
        },
      ],
    });
  });

  it('keeps schemas, descriptions, endpoints, credentials, and catalog metadata out', () => {
    const manifest = buildInvocationManifest(snapshot([componentTool('scanner.scan_target')]), grant);
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain('inputSchema');
    expect(serialized).not.toContain('outputSchema');
    expect(serialized).not.toContain('Description for');
    expect(serialized).not.toContain('icons');
    expect(serialized).not.toContain('annotations');
    expect(serialized).not.toContain('meta');
    expect(serialized).not.toContain('endpoint');
    expect(serialized).not.toContain('credential');
  });

  it('rejects duplicate canonical tool names', () => {
    expect(() =>
      buildInvocationManifest(
        snapshot([
          componentTool('duplicate.tool'),
          mcpTool('duplicate.tool'),
        ]),
        grant,
      ),
    ).toThrow(/duplicate/i);
  });

  it('rejects a grant that does not apply to the snapshot scope', () => {
    expect(() =>
      buildInvocationManifest(snapshot([componentTool('scanner.scan_target')]), {
        ...grant,
        id: OTHER_GRANT_ID,
      }),
    ).toThrow();
  });

  it('makes the planned authority immutable', () => {
    const manifest = buildInvocationManifest(
      snapshot([componentTool('scanner.scan_target')]),
      grant,
    );
    const originalEntry = { ...manifest.entries[0] };

    if (false) {
      // @ts-expect-error Invocation manifests expose readonly properties.
      manifest.capabilityGrantId = OTHER_GRANT_ID;
      // @ts-expect-error Invocation manifest entries are a readonly array.
      manifest.entries.push(manifest.entries[0]);
      // @ts-expect-error Invocation manifest entry properties are readonly.
      manifest.entries[0].destination = 'mcp-activity';
    }

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
    expect(Object.isFrozen(manifest.entries[0])).toBe(true);
    expect(() => {
      (manifest as Mutable<InvocationManifest>).entries = [];
    }).toThrow(TypeError);
    expect(() => {
      (manifest.entries as InvocationManifestEntry[]).push({
        ...originalEntry,
        toolName: 'scanner.injected',
      });
    }).toThrow(TypeError);
    expect(() => {
      (manifest.entries[0] as Mutable<InvocationManifestEntry>).destination = 'mcp-activity';
    }).toThrow(TypeError);
    expect(() => {
      (manifest.entries[0] as Mutable<InvocationManifestEntry>).retryPolicy = 'pre-dispatch-only';
    }).toThrow(TypeError);
    expect(manifest.entries).toEqual([originalEntry]);
  });
});

describe('resolveInvocationManifestEntry', () => {
  const manifest = buildInvocationManifest(snapshot([componentTool('scanner.scan_target')]), grant);

  it('resolves an entry only for the bound scope and snapshot', () => {
    expect(
      resolveInvocationManifestEntry(manifest, {
        scope,
        capabilitySnapshotId: SNAPSHOT_ID,
        toolName: 'scanner.scan_target',
      }),
    ).toEqual({
      toolName: 'scanner.scan_target',
      sourceId: 'component:scanner',
      destination: 'component-activity',
      retryPolicy: 'reviewed-idempotent',
    });
  });

  it.each([
    ['scope grant', { scope: { ...scope, capabilityGrantId: OTHER_GRANT_ID }, capabilitySnapshotId: SNAPSHOT_ID, toolName: 'scanner.scan_target' }],
    ['snapshot', { scope, capabilitySnapshotId: OTHER_GRANT_ID, toolName: 'scanner.scan_target' }],
    ['tool', { scope, capabilitySnapshotId: SNAPSHOT_ID, toolName: 'scanner.missing' }],
  ] as const)('rejects an unbound %s lookup', (_name, input) => {
    expect(() => resolveInvocationManifestEntry(manifest, input)).toThrow();
  });

  it('returns immutable planned authority', () => {
    const resolved = resolveInvocationManifestEntry(manifest, {
      scope,
      capabilitySnapshotId: SNAPSHOT_ID,
      toolName: 'scanner.scan_target',
    });

    if (false) {
      // @ts-expect-error Resolved manifest entry properties are readonly.
      resolved.destination = 'mcp-activity';
    }

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(() => {
      (resolved as Mutable<InvocationManifestEntry>).destination = 'mcp-activity';
    }).toThrow(TypeError);
    expect(
      resolveInvocationManifestEntry(manifest, {
        scope,
        capabilitySnapshotId: SNAPSHOT_ID,
        toolName: 'scanner.scan_target',
      }).destination,
    ).toBe('component-activity');
  });
});
