import { describe, expect, it, vi } from 'bun:test';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MaterializeRunAuthorityBodySchema } from '../../mcp/dto/mcp.dto';
import type { StoredMcpAuthority } from '../mcp-runtime.repository';
import { McpRunAuthorityService } from '../mcp-run-authority.service';

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);
const RUN = {
  runId: 'run-1',
  workflowId: 'workflow-1',
  workflowVersionId: 'version-1',
  organizationId: 'org-1',
};
const VERSION = {
  id: 'version-1',
  workflowId: 'workflow-1',
  organizationId: 'org-1',
  graph: workflowGraph(),
};
const AUTHORITY_INPUT = {
  runId: 'run-1',
  organizationId: 'org-1',
  invokingNodeId: 'agent-node',
  contractVersion: '2' as const,
};

describe('McpRunAuthorityService', () => {
  it('accepts only the run identity and invoking node at the internal request boundary', () => {
    expect(MaterializeRunAuthorityBodySchema.safeParse(AUTHORITY_INPUT).success).toBe(false);
    expect(
      MaterializeRunAuthorityBodySchema.safeParse({
        runId: AUTHORITY_INPUT.runId,
        organizationId: AUTHORITY_INPUT.organizationId,
        invokingNodeId: AUTHORITY_INPUT.invokingNodeId,
      }).success,
    ).toBe(true);
    expect(
      MaterializeRunAuthorityBodySchema.safeParse({
        runId: AUTHORITY_INPUT.runId,
        organizationId: AUTHORITY_INPUT.organizationId,
        invokingNodeId: AUTHORITY_INPUT.invokingNodeId,
        allowedNodeIds: ['component-node'],
      }).success,
    ).toBe(false);
  });

  it('reuses one semantic authority for repeated and concurrent identical requests', async () => {
    let configFingerprint = FINGERPRINT_A;
    const stored = new Map<string, StoredMcpAuthority>();
    const candidates: StoredMcpAuthority[] = [];
    const createOrReadRunAuthority = vi.fn(
      async (input: {
        authorityKey: string;
        grant: StoredMcpAuthority['grant'];
        snapshot: StoredMcpAuthority['snapshot'];
        manifest: StoredMcpAuthority['manifest'];
      }) => {
        const candidate = {
          grant: input.grant,
          snapshot: input.snapshot,
          manifest: input.manifest,
        };
        candidates.push(candidate);
        const existing = stored.get(input.authorityKey);
        if (existing) return existing;
        stored.set(input.authorityKey, candidate);
        return candidate;
      },
    );
    const build = vi.fn(async () => ({
      tools: [componentTool(configFingerprint)],
      resources: [
        {
          sourceId: 'external-node',
          uri: 'sentris://events/latest',
          name: 'Latest events',
          title: 'Latest security events',
          description: 'The latest normalized events',
          mimeType: 'application/json',
          size: 42,
          icons: [{ src: 'https://example.test/resource.svg', theme: 'dark' as const }],
          annotations: { audience: ['assistant'] },
          meta: { retention: 'short' },
        },
      ],
      resourceTemplates: [
        {
          sourceId: 'external-node',
          uriTemplate: 'sentris://events/{eventId}',
          name: 'Event by ID',
          title: 'Security event',
          description: 'Loads one event',
          mimeType: 'application/json',
          meta: { stable: true },
        },
      ],
      prompts: [
        {
          sourceId: 'external-node',
          name: 'investigate-event',
          title: 'Investigate event',
          description: 'Build an investigation plan',
          arguments: [{ name: 'eventId', description: 'Event identifier', required: true }],
          annotations: { audience: ['assistant'] },
          meta: { category: 'investigation' },
        },
      ],
      runtimeBindings: {
        'external-node': {
          runtimeKey: {
            sourceId: 'saved-server',
            transport: 'http' as const,
            configFingerprint: 'c'.repeat(64),
            organizationId: 'org-1',
            principalPartitionHash: 'd'.repeat(64),
            credentialReference: 'mcp-server:saved-server',
            credentialGeneration: 7,
          },
          protocolEra: 'modern' as const,
          protocolVersion: '2026-07-28',
          capabilityFingerprint: 'e'.repeat(64),
        },
      },
      configFingerprint,
    }));
    const service = new McpRunAuthorityService(
      { build } as never,
      { createOrReadRunAuthority } as never,
      { findByRunId: vi.fn(async () => RUN) } as never,
      { findById: vi.fn(async () => VERSION) } as never,
    );
    const input = {
      runId: 'run-1',
      organizationId: 'org-1',
      invokingNodeId: 'agent-node',
      contractVersion: '2' as const,
    };

    const first = await service.materialize(input);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const repeated = await service.materialize(input);
    const [concurrentOne, concurrentTwo] = await Promise.all([
      service.materialize({ ...input, allowedNodeIds: ['not-connected'] }),
      service.materialize({ ...input, allowedNodeIds: ['external-node', 'component-node'] }),
    ]);

    expect(build).toHaveBeenCalledWith({
      runId: 'run-1',
      organizationId: 'org-1',
      invokingNodeId: 'agent-node',
      allowedNodeIds: ['component-node', 'external-node'],
      allowAllSources: false,
    });
    expect(repeated).toBe(first);
    expect(concurrentOne).toBe(first);
    expect(concurrentTwo).toBe(first);
    expect(candidates[0].grant.createdAt).not.toBe(candidates[1].grant.createdAt);
    expect(new Set(candidates.map((candidate) => candidate.grant.id)).size).toBe(1);
    expect(first.snapshot.scope).toEqual({
      kind: 'run',
      runId: 'run-1',
      organizationId: 'org-1',
      capabilityGrantId: first.grant.id,
      invokingNodeId: 'agent-node',
    });
    expect(first.grant.sources).toEqual([
      { sourceId: 'component-node', toolAccess: { mode: 'all' } },
      { sourceId: 'external-node', toolAccess: { mode: 'all' } },
    ]);
    expect(first.snapshot.resources).toEqual([
      expect.objectContaining({
        sourceId: 'external-node',
        uri: 'sentris://events/latest',
        title: 'Latest security events',
        icons: [{ src: 'https://example.test/resource.svg', theme: 'dark' }],
        annotations: { audience: ['assistant'] },
        meta: { retention: 'short' },
      }),
    ]);
    expect(first.snapshot.resourceTemplates).toEqual([
      expect.objectContaining({
        sourceId: 'external-node',
        uriTemplate: 'sentris://events/{eventId}',
        title: 'Security event',
        meta: { stable: true },
      }),
    ]);
    expect(first.snapshot.prompts).toEqual([
      expect.objectContaining({
        sourceId: 'external-node',
        name: 'investigate-event',
        title: 'Investigate event',
        arguments: [{ name: 'eventId', description: 'Event identifier', required: true }],
        annotations: { audience: ['assistant'] },
        meta: { category: 'investigation' },
      }),
    ]);
    if (first.snapshot.version !== '2') throw new Error('Expected v2 authority');
    expect(first.snapshot.runtimeBindings).toEqual({
      'external-node': expect.objectContaining({
        protocolEra: 'modern',
        protocolVersion: '2026-07-28',
        capabilityFingerprint: 'e'.repeat(64),
      }),
    });
    expect(first.manifest.entries).toEqual([
      {
        operationKind: 'prompt-get',
        operationTarget: 'investigate-event',
        sourceId: 'external-node',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'resource-read',
        operationTarget: 'sentris://events/{eventId}',
        sourceId: 'external-node',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'resource-read',
        operationTarget: 'sentris://events/latest',
        sourceId: 'external-node',
        destination: 'mcp-activity',
        retryPolicy: 'reviewed-idempotent',
      },
      {
        operationKind: 'tool-call',
        operationTarget: 'scan_target',
        sourceId: 'component-node',
        destination: 'component-activity',
        retryPolicy: 'pre-dispatch-only',
      },
    ]);

    const legacy = await service.materialize({ ...input, contractVersion: '1' });
    expect(legacy.grant.id).not.toBe(first.grant.id);
    expect(legacy.snapshot.version).toBe('1');
    expect(legacy.snapshot).not.toHaveProperty('runtimeBindings');
    expect(legacy.manifest).toEqual(
      expect.objectContaining({
        version: '1',
        entries: [
          {
            toolName: 'scan_target',
            sourceId: 'component-node',
            destination: 'component-activity',
            retryPolicy: 'pre-dispatch-only',
          },
        ],
      }),
    );

    configFingerprint = FINGERPRINT_B;
    const changed = await service.materialize(input);
    expect(changed.grant.id).not.toBe(first.grant.id);
    expect(changed.snapshot.id).not.toBe(first.snapshot.id);
    expect(stored.size).toBe(3);
  });

  it('rejects an unknown run before reading a graph or catalog', async () => {
    const { service, build, findById } = createGuardedService({ run: null });

    await expect(service.materialize(AUTHORITY_INPUT)).rejects.toThrow(NotFoundException);
    expect(findById).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects a caller organization that does not match the persisted run', async () => {
    const { service, build, findById } = createGuardedService();

    await expect(
      service.materialize({ ...AUTHORITY_INPUT, organizationId: 'org-2' }),
    ).rejects.toThrow(ForbiddenException);
    expect(findById).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects an invoking node that is absent from the immutable run graph', async () => {
    const { service, build } = createGuardedService();

    await expect(
      service.materialize({ ...AUTHORITY_INPUT, invokingNodeId: 'unknown-agent' }),
    ).rejects.toThrow(NotFoundException);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects a workflow version that is not bound to the persisted run', async () => {
    const { service, build } = createGuardedService({
      version: { ...VERSION, workflowId: 'other-workflow' },
    });

    await expect(service.materialize(AUTHORITY_INPUT)).rejects.toThrow(ConflictException);
    expect(build).not.toHaveBeenCalled();
  });

  it('treats an agent with no tool edges as having no sources', async () => {
    const { service, build } = createGuardedService({
      version: { ...VERSION, graph: workflowGraph([]) },
    });

    const authority = await service.materialize({
      ...AUTHORITY_INPUT,
      allowedNodeIds: ['component-node'],
    });

    expect(build).toHaveBeenCalledWith({
      runId: 'run-1',
      organizationId: 'org-1',
      invokingNodeId: 'agent-node',
      allowedNodeIds: [],
      allowAllSources: false,
    });
    expect(authority.grant.sources).toEqual([]);
    expect(authority.snapshot.tools).toEqual([]);
  });
});

function createGuardedService(
  options: {
    run?: typeof RUN | null;
    version?: typeof VERSION | null;
  } = {},
) {
  const build = vi.fn(async () => ({
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    runtimeBindings: {},
    configFingerprint: FINGERPRINT_A,
  }));
  const findByRunId = vi.fn(async () => (options.run === null ? undefined : (options.run ?? RUN)));
  const findById = vi.fn(async () =>
    options.version === null ? undefined : (options.version ?? VERSION),
  );
  const createOrReadRunAuthority = vi.fn(
    async (input: {
      authorityKey: string;
      grant: StoredMcpAuthority['grant'];
      snapshot: StoredMcpAuthority['snapshot'];
      manifest: StoredMcpAuthority['manifest'];
    }) => ({
      grant: input.grant,
      snapshot: input.snapshot,
      manifest: input.manifest,
    }),
  );
  return {
    service: new McpRunAuthorityService(
      { build } as never,
      { createOrReadRunAuthority } as never,
      { findByRunId } as never,
      { findById } as never,
    ),
    build,
    findById,
  };
}

function workflowGraph(
  edges = [
    {
      id: 'component-agent-tools',
      source: 'component-node',
      target: 'agent-node',
      targetHandle: 'tools',
    },
    {
      id: 'external-agent-tools',
      source: 'external-node',
      target: 'agent-node',
      targetHandle: 'tools',
    },
  ],
) {
  return {
    name: 'Agent tool workflow',
    nodes: [
      workflowNode('component-node', 'security.scan-target'),
      workflowNode('external-node', 'core.mcp.server'),
      workflowNode('agent-node', 'core.ai.agent'),
    ],
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function workflowNode(id: string, type: string) {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      config: { params: {}, inputOverrides: {} },
    },
  };
}

function componentTool(bindingFingerprint: string) {
  return {
    canonicalName: 'scan_target',
    displayName: 'Scan target',
    inputSchema: { type: 'object', additionalProperties: false },
    source: {
      kind: 'component' as const,
      sourceId: 'component-node',
      nodeId: 'component-node',
      componentId: 'security.scan-target',
      bindingFingerprint,
    },
    effects: 'unknown' as const,
    effectsSource: 'sentris-contract' as const,
    retryPolicy: 'pre-dispatch-only' as const,
  };
}
