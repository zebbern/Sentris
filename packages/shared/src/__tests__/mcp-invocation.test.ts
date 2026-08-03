import { describe, expect, it } from 'bun:test';
import * as mcpInvocationContracts from '../mcp-invocation.js';
import type {
  CapabilityGrant,
  ExecutionScope,
  McpCapabilityCatalogSnapshot,
  ToolDescriptor,
} from '../mcp-capabilities.js';
import {
  assertCapabilityGrantApplies,
  buildInvocationManifest,
  ClaimComponentDispatchOutcomeSchema,
  MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS,
  MCP_OPERATION_PROTOCOL_QUERY_NAME,
  MCP_OPERATION_PROTOCOL_VERSION,
  PrepareToolInvocationOutcomeSchema,
  resolveInvocationManifestEntry,
  TOOL_INVOCATION_UPDATE_NAME,
  TOOL_INVOCATION_PROTOCOL_QUERY_NAME,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  type InvocationManifest,
  type InvocationManifestEntry,
} from '../mcp-invocation.js';

describe('MCP operation protocol negotiation', () => {
  it('exports a generic protocol query distinct from the legacy tool protocol', () => {
    expect(MCP_OPERATION_PROTOCOL_QUERY_NAME).toBe('getMcpOperationProtocolVersion');
    expect(MCP_OPERATION_PROTOCOL_VERSION).toBe(1);
    expect(MCP_OPERATION_PROTOCOL_QUERY_NAME).not.toBe(TOOL_INVOCATION_PROTOCOL_QUERY_NAME);
  });
});

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GRANT_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const INVOCATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUNTIME_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_EPOCH = '55555555-5555-4555-8555-555555555555';

const runtimeFence = {
  runtimeId: RUNTIME_ID,
  ownerId: 'worker-3',
  ownerEpoch: OWNER_EPOCH,
  leaseGeneration: 4,
};

const scope: ExecutionScope = {
  kind: 'run',
  organizationId: 'org-123',
  runId: 'run-123',
  capabilityGrantId: GRANT_ID,
  invokingNodeId: 'agent-node',
};

const request = {
  invocationId: INVOCATION_ID,
  scope,
  capabilitySnapshotId: SNAPSHOT_ID,
  toolName: 'osv_query',
  input: { package: { ecosystem: 'npm', name: 'lodash' }, version: '4.17.20' },
  requestedAt: '2026-07-31T10:00:00.000Z',
  deadlineAt: '2026-07-31T10:05:00.000Z',
};

const preparedRef = {
  invocationId: INVOCATION_ID,
  attemptId: ATTEMPT_ID,
  attemptNumber: 1,
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  toolName: 'osv_query',
  sourceId: 'component:osv',
  destination: 'component-activity' as const,
  retryPolicy: 'pre-dispatch-only' as const,
  preparedAt: '2026-07-31T10:00:01.000Z',
};

class ObjectValue {
  value = 1;
}

class ArrayValues extends Array<number> {}

describe('ToolInvocationRequestSchema', () => {
  it('parses a bounded request with nested finite JSON input', () => {
    expect(ToolInvocationRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects input at or above the inline byte limit', () => {
    expect(() =>
      ToolInvocationRequestSchema.parse({
        ...request,
        input: { text: 'x'.repeat(262_144) },
      }),
    ).toThrow('Invocation input exceeds 262144 UTF-8 bytes');
  });

  it.each([
    { input: { count: Number.POSITIVE_INFINITY } },
    { input: { count: Number.NaN } },
    { input: { missing: undefined } },
  ])('rejects non-finite and undefined JSON input %#', ({ input }) => {
    expect(() => ToolInvocationRequestSchema.parse({ ...request, input })).toThrow();
  });

  it('rejects functions in JSON input', () => {
    expect(
      ToolInvocationRequestSchema.safeParse({
        ...request,
        input: { callback: () => undefined },
      }).success,
    ).toBe(false);
  });

  it('rejects object class instances in JSON input', () => {
    expect(
      ToolInvocationRequestSchema.safeParse({
        ...request,
        input: { value: new ObjectValue() },
      }).success,
    ).toBe(false);
  });

  it('rejects Array subclass instances in JSON input', () => {
    expect(
      ToolInvocationRequestSchema.safeParse({
        ...request,
        input: { values: new ArrayValues(1, 2) },
      }).success,
    ).toBe(false);
  });

  it('rejects cyclic JSON input without throwing', () => {
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.self = cyclicInput;
    let result: { success: boolean } | undefined;

    expect(() => {
      result = ToolInvocationRequestSchema.safeParse({ ...request, input: cyclicInput });
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it('rejects a deadline before the request time', () => {
    expect(() =>
      ToolInvocationRequestSchema.parse({
        ...request,
        deadlineAt: '2026-07-31T09:59:59.999Z',
      }),
    ).toThrow('Invocation deadline must not be before requestedAt');
  });
});

describe('InstallToolInvocationManifestRequestSchema', () => {
  const manifest: InvocationManifest = {
    capabilitySnapshotId: SNAPSHOT_ID,
    capabilityGrantId: GRANT_ID,
    version: '1',
    entries: [
      {
        toolName: 'osv_query',
        sourceId: 'component:osv',
        destination: 'component-activity',
        retryPolicy: 'pre-dispatch-only',
      },
    ],
  };

  it('accepts only a strict scope-bound immutable manifest install request', async () => {
    const invocationModule = (await import('../mcp-invocation.js')) as Record<string, any>;
    expect(typeof invocationModule.InstallToolInvocationManifestRequestSchema?.parse).toBe(
      'function',
    );
    const installSchema = invocationModule.InstallToolInvocationManifestRequestSchema;
    const install = { scope, manifest };

    expect(installSchema.parse(install)).toEqual(install);
    expect(() => installSchema.parse({ ...install, extra: true })).toThrow();
    expect(() =>
      installSchema.parse({
        scope: { ...scope, capabilityGrantId: OTHER_GRANT_ID },
        manifest,
      }),
    ).toThrow('Invocation manifest does not match the execution scope grant');
  });

  it('keeps legacy tool manifests and durable generic manifests on distinct versions', async () => {
    const invocationModule = (await import('../mcp-invocation.js')) as Record<string, any>;
    const schema = invocationModule.InvocationManifestSchema;
    const legacyEntry = manifest.entries[0];
    const genericEntry = {
      operationKind: 'tool-call',
      operationTarget: 'osv_query',
      sourceId: 'component:osv',
      destination: 'component-activity',
      retryPolicy: 'pre-dispatch-only',
    };

    expect(schema.safeParse({ ...manifest, version: '1', entries: [genericEntry] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...manifest, version: '2', entries: [legacyEntry] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...manifest, version: '2', entries: [genericEntry] }).success).toBe(
      true,
    );
  });
});

describe('ToolInvocationResultSchema', () => {
  const completedResult = {
    invocationId: INVOCATION_ID,
    status: 'completed' as const,
    output: { vulnerabilities: [] },
    completedAt: '2026-07-31T10:01:00.000Z',
  };

  const failedResult = {
    invocationId: INVOCATION_ID,
    status: 'failed' as const,
    error: {
      class: 'remote-tool' as const,
      message: 'Upstream tool rejected the package.',
      retryable: false,
    },
    completedAt: '2026-07-31T10:01:00.000Z',
  };

  it('enforces terminal output and error combinations', () => {
    expect(ToolInvocationResultSchema.parse(completedResult)).toEqual(completedResult);
    expect(ToolInvocationResultSchema.parse(failedResult)).toEqual(failedResult);
    expect(() =>
      ToolInvocationResultSchema.parse({ ...completedResult, output: undefined }),
    ).toThrow();
    expect(() =>
      ToolInvocationResultSchema.parse({ ...completedResult, error: failedResult.error }),
    ).toThrow();
    expect(() => ToolInvocationResultSchema.parse({ ...failedResult, output: null })).toThrow();
    expect(() => ToolInvocationResultSchema.parse({ ...failedResult, error: undefined })).toThrow();
  });

  it('rejects output at or above the inline byte limit', () => {
    expect(() =>
      ToolInvocationResultSchema.parse({
        ...completedResult,
        output: { text: 'x'.repeat(1_048_576) },
      }),
    ).toThrow('Invocation output exceeds 1048576 UTF-8 bytes');
  });

  it('bounds persisted and public error messages', () => {
    expect(() =>
      ToolInvocationResultSchema.parse({
        ...failedResult,
        error: {
          ...failedResult.error,
          message: 'x'.repeat(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS + 1),
        },
      }),
    ).toThrow();
  });
});

describe('generic MCP operation contracts', () => {
  it('parses each operation discriminant with bounded SDK-independent inputs', async () => {
    const operationContracts = (await import('../mcp-invocation.js')) as Record<string, any>;
    const schema = operationContracts.McpOperationSchema;

    expect(
      schema.parse({
        kind: 'tool-call',
        name: 'search_code',
        arguments: { query: 'repo:sentris security', page: 1 },
      }),
    ).toEqual({
      kind: 'tool-call',
      name: 'search_code',
      arguments: { query: 'repo:sentris security', page: 1 },
    });
    expect(schema.parse({ kind: 'resource-read', uri: 'repo://sentris/main/README.md' })).toEqual({
      kind: 'resource-read',
      uri: 'repo://sentris/main/README.md',
    });
    expect(
      schema.parse({
        kind: 'prompt-get',
        name: 'review_finding',
        arguments: { severity: 'high', findingId: 'F-42' },
      }),
    ).toEqual({
      kind: 'prompt-get',
      name: 'review_finding',
      arguments: { severity: 'high', findingId: 'F-42' },
    });
    expect(
      schema.safeParse({ kind: 'prompt-get', name: 'review_finding', arguments: { count: 2 } })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ kind: 'resource-read', uri: '' }).success).toBe(false);
    expect(
      schema.safeParse({
        kind: 'tool-call',
        name: 'search_code',
        arguments: { count: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        kind: 'tool-call',
        name: 'search_code',
        arguments: { text: 'x'.repeat(262_144) },
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ kind: 'tasks-create', name: 'unsupported' }).success).toBe(false);
  });

  it('requires the complete acquire-returned fence on operation requests', async () => {
    const operationContracts = (await import('../mcp-invocation.js')) as Record<string, any>;
    const schema = operationContracts.McpRuntimeOperationRequestSchema;
    const operationRequest = {
      operationId: INVOCATION_ID,
      fence: runtimeFence,
      operation: { kind: 'resource-read' as const, uri: 'repo://sentris/main/README.md' },
      requestedAt: '2026-08-01T10:00:00.000Z',
      deadlineAt: '2026-08-01T10:05:00.000Z',
    };

    expect(schema.parse(operationRequest)).toEqual(operationRequest);
    const { fence: _fence, ...unfencedRequest } = operationRequest;
    expect(schema.safeParse(unfencedRequest).success).toBe(false);
    expect(schema.safeParse({ ...operationRequest, token: 'secret' }).success).toBe(false);
    expect(
      schema.safeParse({ ...operationRequest, deadlineAt: '2026-08-01T09:59:59.999Z' }).success,
    ).toBe(false);
  });

  it.each([
    ['tool name', { kind: 'tool-call' as const, name: 'x'.repeat(262_144), arguments: {} }],
    ['prompt name', { kind: 'prompt-get' as const, name: 'x'.repeat(262_144), arguments: {} }],
    ['resource URI', { kind: 'resource-read' as const, uri: 'x'.repeat(262_144) }],
  ])('rejects an oversized %s in the complete operation request', async (_name, operation) => {
    const operationContracts = (await import('../mcp-invocation.js')) as Record<string, any>;

    expect(
      operationContracts.McpRuntimeOperationRequestSchema.safeParse({
        operationId: INVOCATION_ID,
        fence: runtimeFence,
        operation,
        requestedAt: '2026-08-01T10:00:00.000Z',
        deadlineAt: '2026-08-01T10:05:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('parses completed, remote failure, cancellation, ambiguity, and input-required results', async () => {
    const operationContracts = (await import('../mcp-invocation.js')) as Record<string, any>;
    const schema = operationContracts.McpOperationResultSchema;
    const terminalBase = {
      operationId: INVOCATION_ID,
      completedAt: '2026-08-01T10:01:00.000Z',
    };
    const results = [
      { ...terminalBase, kind: 'completed', output: { content: [{ type: 'text', text: 'ok' }] } },
      {
        ...terminalBase,
        kind: 'remote-failure',
        message: 'Upstream MCP server rejected the operation.',
        retryable: false,
      },
      { ...terminalBase, kind: 'cancelled', message: 'Workflow cancelled.' },
      { ...terminalBase, kind: 'ambiguous', message: 'Owner lost after dispatch.' },
      {
        ...terminalBase,
        kind: 'input-required-unsupported',
        message: 'The MCP server requires additional input.',
        retryable: false,
      },
    ];

    for (const result of results) {
      expect(schema.parse(result)).toEqual(result);
    }

    expect(schema.safeParse({ ...results[4], retryable: true }).success).toBe(false);
    expect(schema.safeParse({ ...results[1], output: { leaked: true } }).success).toBe(false);
    expect(
      schema.safeParse({
        ...results[0],
        output: { text: 'x'.repeat(1_048_576) },
      }).success,
    ).toBe(false);
  });

  it('keeps the existing tool request and Workflow update wire projection unchanged', () => {
    expect(ToolInvocationRequestSchema.parse(request)).toEqual(request);
    expect(JSON.parse(JSON.stringify(ToolInvocationRequestSchema.parse(request)))).toEqual(request);
    expect(TOOL_INVOCATION_UPDATE_NAME).toBe('executeToolInvocation');
  });
});

describe('ClaimComponentDispatchOutcomeSchema', () => {
  it('parses structural dispatch context and terminal replay outcomes', () => {
    expect(
      ClaimComponentDispatchOutcomeSchema.parse({
        kind: 'dispatch',
        context: {
          ref: preparedRef,
          run: {
            runId: 'run-123',
            workflowId: '44444444-4444-4444-8444-444444444444',
            workflowVersionId: null,
            organizationId: 'org-123',
            scopeId: null,
          },
          component: {
            nodeId: 'scanner-node',
            componentId: 'security.scanner',
            arguments: { target: 'example.com' },
            parameters: { mode: 'safe' },
            credentials: { token: 'resolved-only-here' },
          },
        },
      }),
    ).toMatchObject({ kind: 'dispatch' });

    expect(
      ClaimComponentDispatchOutcomeSchema.parse({
        kind: 'terminal',
        result: {
          invocationId: INVOCATION_ID,
          status: 'cancelled',
          error: { class: 'cancelled', message: 'Run ended', retryable: false },
          completedAt: '2026-07-31T10:01:00.000Z',
        },
      }),
    ).toMatchObject({ kind: 'terminal' });
  });
});

describe('PrepareToolInvocationOutcomeSchema', () => {
  it('parses prepared and terminal preflight outcomes', () => {
    expect(
      PrepareToolInvocationOutcomeSchema.parse({
        kind: 'prepared',
        ref: preparedRef,
        manifest: {
          capabilitySnapshotId: SNAPSHOT_ID,
          capabilityGrantId: GRANT_ID,
          version: '1',
          entries: [
            {
              toolName: 'osv_query',
              sourceId: 'component:osv',
              destination: 'component-activity',
              retryPolicy: 'pre-dispatch-only',
            },
          ],
        },
      }),
    ).toMatchObject({ kind: 'prepared', ref: preparedRef });

    expect(
      PrepareToolInvocationOutcomeSchema.parse({
        kind: 'terminal',
        result: {
          invocationId: INVOCATION_ID,
          status: 'cancelled',
          error: {
            class: 'cancelled',
            message: 'Invocation cancelled before dispatch.',
            retryable: false,
          },
          completedAt: '2026-07-31T10:01:00.000Z',
        },
      }),
    ).toMatchObject({ kind: 'terminal' });
  });
});

describe('durable MCP operation dispatch contracts', () => {
  it('carries immutable operation authority to a fence-capturing dispatch claim', () => {
    const contracts = mcpInvocationContracts as Record<string, unknown>;
    const preparedSchema = contracts.PrepareMcpOperationOutcomeSchema as
      | { safeParse(value: unknown): { success: boolean; data?: unknown } }
      | undefined;
    const claimSchema = contracts.ClaimMcpOperationDispatchRequestSchema as
      | { safeParse(value: unknown): { success: boolean; data?: unknown } }
      | undefined;
    const prepared = {
      kind: 'prepared' as const,
      plan: {
        ref: {
          invocationId: INVOCATION_ID,
          attemptId: ATTEMPT_ID,
          attemptNumber: 1,
          capabilitySnapshotId: SNAPSHOT_ID,
          capabilityGrantId: GRANT_ID,
          operationKind: 'resource-read' as const,
          operationTarget: 'repo://{path}',
          toolName: null,
          sourceId: 'mcp:github',
          destination: 'mcp-activity' as const,
          retryPolicy: 'reviewed-idempotent' as const,
          preparedAt: '2026-07-31T10:00:01.000Z',
        },
        manifestEntry: {
          operationKind: 'resource-read' as const,
          operationTarget: 'repo://{path}',
          sourceId: 'mcp:github',
          destination: 'mcp-activity' as const,
          retryPolicy: 'reviewed-idempotent' as const,
        },
        runtimeBinding: {
          runtimeKey: {
            sourceId: 'github-server',
            transport: 'http' as const,
            configFingerprint: 'a'.repeat(64),
            organizationId: 'org-123',
            principalPartitionHash: 'b'.repeat(64),
            credentialReference: 'mcp-server:github-server',
            credentialGeneration: 7,
          },
          protocolEra: 'modern' as const,
          protocolVersion: '2026-07-28',
          capabilityFingerprint: 'c'.repeat(64),
        },
        operation: { kind: 'resource-read' as const, uri: 'repo://src/index.ts' },
        requestedAt: '2026-07-31T10:00:00.000Z',
        deadlineAt: '2026-07-31T10:05:00.000Z',
      },
      manifest: {
        capabilitySnapshotId: SNAPSHOT_ID,
        capabilityGrantId: GRANT_ID,
        version: '1' as const,
        entries: [],
      },
    };
    const acquiredRef = {
      fence: runtimeFence,
      leaseExpiresAt: '2026-07-31T10:10:00.000Z',
      protocolEra: 'modern' as const,
      protocolVersion: '2026-07-28',
      ownerAddress: 'http://worker-3.internal:9301',
      state: 'ready' as const,
      capabilityFingerprint: 'c'.repeat(64),
    };

    expect(preparedSchema?.safeParse(prepared)).toEqual({ success: true, data: prepared });
    expect(claimSchema?.safeParse({ plan: prepared.plan, runtimeRef: acquiredRef })).toEqual({
      success: true,
      data: { plan: prepared.plan, runtimeRef: acquiredRef },
    });
  });

  it('rejects a tool reference whose nullable compatibility projection drifts', () => {
    const contracts = mcpInvocationContracts as Record<string, unknown>;
    const schema = contracts.PreparedMcpOperationRefSchema as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(
      schema?.safeParse({
        invocationId: INVOCATION_ID,
        attemptId: ATTEMPT_ID,
        attemptNumber: 1,
        capabilitySnapshotId: SNAPSHOT_ID,
        capabilityGrantId: GRANT_ID,
        operationKind: 'tool-call',
        operationTarget: 'github.search_code',
        toolName: null,
        sourceId: 'mcp:github',
        destination: 'mcp-activity',
        retryPolicy: 'pre-dispatch-only',
        preparedAt: '2026-07-31T10:00:01.000Z',
      }).success,
    ).toBe(false);
  });
});

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
      bindingFingerprint: 'a'.repeat(64),
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

function mcpTool(canonicalName: string, overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    canonicalName,
    displayName: canonicalName,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    source: {
      kind: 'mcp',
      sourceId: 'mcp:github',
      serverId: 'github-server',
      upstreamName: canonicalName.split('.')[1] ?? canonicalName,
      bindingFingerprint: 'b'.repeat(64),
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
    version: '2',
    configFingerprint: 'a'.repeat(64),
    runtimeBindings: {},
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
    {
      name: 'operator',
      scope: {
        kind: 'operator' as const,
        organizationId: 'org-123',
        sessionId: '66666666-6666-4666-8666-666666666666',
        turnId: '77777777-7777-4777-8777-777777777777',
        capabilityGrantId: GRANT_ID,
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
      grant: {
        ...grant,
        subject: {
          kind: 'operator' as const,
          sessionId: '66666666-6666-4666-8666-666666666666',
          turnId: '77777777-7777-4777-8777-777777777777',
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
    {
      name: 'Operator turn',
      scope: {
        kind: 'operator' as const,
        organizationId: 'org-123',
        sessionId: '66666666-6666-4666-8666-666666666666',
        turnId: '77777777-7777-4777-8777-777777777777',
        capabilityGrantId: GRANT_ID,
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
      grant: {
        ...grant,
        subject: {
          kind: 'operator' as const,
          sessionId: '66666666-6666-4666-8666-666666666666',
          turnId: '88888888-8888-4888-8888-888888888888',
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
  it('authorizes every operation family by kind, immutable target, and source identity', () => {
    const manifest = buildInvocationManifest(
      {
        ...snapshot([mcpTool('github.search_code')]),
        resources: [
          { sourceId: 'mcp:github', uri: 'repo://README.md', name: 'README' },
          { sourceId: 'mcp:other', uri: 'repo://README.md', name: 'Other README' },
        ],
        resourceTemplates: [
          {
            sourceId: 'mcp:github',
            uriTemplate: 'repo://{path}',
            name: 'Repository file',
          },
        ],
        prompts: [
          { sourceId: 'mcp:github', name: 'review', arguments: [] },
          { sourceId: 'mcp:other', name: 'review', arguments: [] },
        ],
      },
      {
        ...grant,
        sources: [
          ...grant.sources,
          { sourceId: 'mcp:other', toolAccess: { mode: 'all' as const } },
        ],
      },
    );

    expect(manifest.entries).toEqual([
      {
        operationKind: 'prompt-get',
        operationTarget: 'review',
        sourceId: 'mcp:github',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'prompt-get',
        operationTarget: 'review',
        sourceId: 'mcp:other',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'resource-read',
        operationTarget: 'repo://{path}',
        sourceId: 'mcp:github',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'resource-read',
        operationTarget: 'repo://README.md',
        sourceId: 'mcp:github',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'resource-read',
        operationTarget: 'repo://README.md',
        sourceId: 'mcp:other',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'tool-call',
        operationTarget: 'github.search_code',
        sourceId: 'mcp:github',
        destination: 'mcp-activity',
        retryPolicy: 'pre-dispatch-only',
      },
    ]);
  });

  it('parses a keyed generic operation request without parallel operation contracts', () => {
    const genericRequest = {
      invocationId: INVOCATION_ID,
      scope,
      capabilitySnapshotId: SNAPSHOT_ID,
      sourceId: 'mcp:github',
      authorizationTarget: 'repo://{path}',
      operation: { kind: 'resource-read' as const, uri: 'repo://src/index.ts' },
      requestedAt: '2026-07-31T10:00:00.000Z',
      deadlineAt: '2026-07-31T10:05:00.000Z',
    };

    const contracts = mcpInvocationContracts as Record<string, unknown>;
    expect(contracts.MCP_OPERATION_UPDATE_NAME).toBe('executeMcpOperation');
    const schema = contracts.McpOperationInvocationRequestSchema as
      | { safeParse(value: unknown): { success: boolean; data?: unknown } }
      | undefined;
    expect(schema?.safeParse(genericRequest)).toEqual({ success: true, data: genericRequest });
  });

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
            bindingFingerprint: 'c'.repeat(64),
          },
        }),
      ]),
      grant,
    );

    expect(manifest).toEqual({
      capabilitySnapshotId: SNAPSHOT_ID,
      capabilityGrantId: GRANT_ID,
      version: '2',
      entries: [
        {
          operationKind: 'tool-call',
          operationTarget: 'github.create_issue',
          sourceId: 'mcp:github',
          destination: 'mcp-activity',
          retryPolicy: 'reviewed-idempotent',
        },
        {
          operationKind: 'tool-call',
          operationTarget: 'github.search_code',
          sourceId: 'mcp:github',
          destination: 'mcp-activity',
          retryPolicy: 'pre-dispatch-only',
        },
        {
          operationKind: 'tool-call',
          operationTarget: 'scanner.scan_target',
          sourceId: 'component:scanner',
          destination: 'component-activity',
          retryPolicy: 'reviewed-idempotent',
        },
      ],
    });
  });

  it('keeps schemas, descriptions, endpoints, credentials, and catalog metadata out', () => {
    const manifest = buildInvocationManifest(
      snapshot([componentTool('scanner.scan_target')]),
      grant,
    );
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
        snapshot([componentTool('duplicate.tool'), mcpTool('duplicate.tool')]),
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

    // eslint-disable-next-line no-constant-condition -- compile-time-only readonly assertions
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
    expect([...(manifest.entries as readonly InvocationManifestEntry[])]).toEqual([originalEntry]);
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
    [
      'scope grant',
      {
        scope: { ...scope, capabilityGrantId: OTHER_GRANT_ID },
        capabilitySnapshotId: SNAPSHOT_ID,
        toolName: 'scanner.scan_target',
      },
    ],
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

    // eslint-disable-next-line no-constant-condition -- compile-time-only readonly assertion
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
