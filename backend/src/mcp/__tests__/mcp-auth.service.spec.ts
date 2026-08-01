import { describe, expect, it, vi } from 'bun:test';
import { status as grpcStatus } from '@grpc/grpc-js';
import { QueryNotRegisteredError } from '@temporalio/client';
import { McpAuthService } from '../mcp-auth.service';

class MockRedis {
  readonly sets: { key: string; value: string; ttl: number }[] = [];
  private readonly values = new Map<string, string>();

  async set(key: string, value: string, _mode: string, ttl: number): Promise<'OK'> {
    this.sets.push({ key, value, ttl });
    this.values.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DURABLE_GRANT_ID = '11111111-1111-5111-8111-111111111111';
const DURABLE_SNAPSHOT_ID = '22222222-2222-5222-8222-222222222222';
const DURABLE_MANIFEST = {
  capabilityGrantId: DURABLE_GRANT_ID,
  capabilitySnapshotId: DURABLE_SNAPSHOT_ID,
  version: '1' as const,
  entries: [
    {
      toolName: 'osv_query',
      sourceId: 'component:osv',
      destination: 'component-activity' as const,
      retryPolicy: 'pre-dispatch-only' as const,
    },
  ],
};

describe('McpAuthService', () => {
  it.each([
    { requested: undefined, expected: 3600 },
    { requested: Number.NaN, expected: 3600 },
    { requested: 'invalid' as unknown as number, expected: 3600 },
    { requested: 30, expected: 60 },
    { requested: 900.9, expected: 900 },
    { requested: 900, expected: 900 },
    { requested: 20000, expected: 10800 },
  ])('bounds token lifetime for requested TTL $requested', async ({ requested, expected }) => {
    const redis = new MockRedis();
    const service = createService(redis);

    const before = Math.floor(Date.now() / 1000);
    await service.generateSessionToken('run-ttl', 'org-ttl', 'agent-ttl', ['tool-a'], requested);
    const after = Math.floor(Date.now() / 1000);

    expect(redis.sets).toHaveLength(1);
    expect(redis.sets[0].ttl).toBe(expected);
    const metadata = JSON.parse(redis.sets[0].value) as { expiresAt: number };
    expect(metadata.expiresAt).toBeGreaterThanOrEqual(before + expected);
    expect(metadata.expiresAt).toBeLessThanOrEqual(after + expected);
  });

  it('stores the materialized grant and snapshot with normalized immutable token scope', async () => {
    const redis = new MockRedis();
    const materialize = vi.fn(async () => durableAuthority());
    const service = createService(redis, undefined, materialize);

    const token = await service.generateSessionToken(
      'run-grant',
      'org-grant',
      'agent-grant',
      [' node-b ', '', 'node-a', 'node-b', '   '],
      undefined,
      'agent-node',
    );

    expect(redis.sets).toHaveLength(1);
    const metadata = JSON.parse(redis.sets[0].value) as {
      capabilityGrantId: string;
      capabilitySnapshotId: string;
      invokingNodeId: string;
      allowedNodeIds: string[];
    };
    expect(metadata.capabilityGrantId).toBe(DURABLE_GRANT_ID);
    expect(metadata.capabilitySnapshotId).toBe(DURABLE_SNAPSHOT_ID);
    expect(metadata.invokingNodeId).toBe('agent-node');
    expect(metadata.allowedNodeIds).toEqual(['node-a', 'node-b']);
    expect(materialize).toHaveBeenCalledWith({
      runId: 'run-grant',
      organizationId: 'org-grant',
      invokingNodeId: 'agent-node',
      allowedNodeIds: ['node-a', 'node-b'],
    });

    const firstValidation = await service.validateToken(token);
    const secondValidation = await service.validateToken(token);
    expect(firstValidation?.extra).toEqual({
      runId: 'run-grant',
      organizationId: 'org-grant',
      capabilityGrantId: metadata.capabilityGrantId,
      capabilitySnapshotId: metadata.capabilitySnapshotId,
      invokingNodeId: 'agent-node',
      allowedNodeIds: ['node-a', 'node-b'],
    });
    expect(secondValidation?.extra?.capabilityGrantId).toBe(metadata.capabilityGrantId);
  });

  it('derives a stable grant UUID for a legacy token without rewriting its Redis record', async () => {
    const redis = new MockRedis();
    const token = 'mcp_sk_legacy';
    redis.seed(`mcp:session:${token}`, {
      runId: 'run-legacy',
      organizationId: null,
      agentId: 'agent-legacy',
      allowedNodeIds: ['node-b', ' node-a ', 'node-b'],
      expiresAt: 4_102_444_800,
    });
    const service = createService(redis);

    const firstValidation = await service.validateToken(token);
    const secondValidation = await service.validateToken(token);

    expect(firstValidation?.extra?.capabilityGrantId).toMatch(UUID_V5_PATTERN);
    expect(firstValidation?.extra?.capabilityGrantId).toBe('72c18df6-8a06-5917-8775-bd9eaaa9a08d');
    expect(secondValidation?.extra?.capabilityGrantId).toBe(
      firstValidation?.extra?.capabilityGrantId,
    );
    expect(firstValidation?.extra?.allowedNodeIds).toEqual(['node-a', 'node-b']);
    expect(redis.sets).toHaveLength(0);
  });

  it('binds each recovered legacy grant to all immutable token metadata', async () => {
    const baseMetadata = {
      runId: 'run-legacy',
      organizationId: 'org-legacy',
      agentId: 'agent-legacy',
      allowedNodeIds: ['node-a', 'node-b'],
      expiresAt: 4_102_444_800,
    };
    const variants = [
      { token: 'mcp_sk_legacy-a', metadata: baseMetadata },
      { token: 'mcp_sk_legacy-b', metadata: baseMetadata },
      { token: 'mcp_sk_legacy-a', metadata: { ...baseMetadata, runId: 'run-other' } },
      { token: 'mcp_sk_legacy-a', metadata: { ...baseMetadata, organizationId: 'org-other' } },
      { token: 'mcp_sk_legacy-a', metadata: { ...baseMetadata, agentId: 'agent-other' } },
      {
        token: 'mcp_sk_legacy-a',
        metadata: { ...baseMetadata, allowedNodeIds: ['node-a', 'node-c'] },
      },
    ];
    const grantIds: string[] = [];

    for (const variant of variants) {
      const redis = new MockRedis();
      redis.seed(`mcp:session:${variant.token}`, variant.metadata);
      const authInfo = await createService(redis).validateToken(variant.token);
      grantIds.push(authInfo?.extra?.capabilityGrantId as string);
    }

    expect(new Set(grantIds).size).toBe(variants.length);
  });

  it('queries protocol version 1 before materializing durable token authority', async () => {
    const redis = new MockRedis();
    const queryWorkflow = vi.fn(async () => 1);
    const materialize = vi.fn(async () => durableAuthority());
    const service = createService(redis, queryWorkflow, materialize);

    await service.generateSessionToken(
      'run-protocol',
      null,
      'agent-protocol',
      ['node-a'],
      900,
      'invoking-agent',
    );

    expect(queryWorkflow).toHaveBeenCalledWith({
      workflowId: 'run-protocol',
      queryType: 'getToolInvocationProtocolVersion',
    });
    expect(materialize).toHaveBeenCalledTimes(1);
  });

  it('installs the immutable manifest before writing a durable token', async () => {
    const redis = new MockRedis();
    const executeWorkflowUpdate = vi.fn(async () => {
      expect(redis.sets).toHaveLength(0);
    });
    const service = createService(
      redis,
      vi.fn(async () => 1),
      vi.fn(async () => durableAuthority('run-install', 'org-install', 'invoking-agent')),
      executeWorkflowUpdate,
    );

    await service.generateSessionToken(
      'run-install',
      'org-install',
      'agent-install',
      ['node-a'],
      900,
      'invoking-agent',
    );

    expect(executeWorkflowUpdate).toHaveBeenCalledWith({
      workflowId: 'run-install',
      updateName: 'installToolInvocationManifest',
      updateId: `install-manifest:${DURABLE_GRANT_ID}`,
      args: {
        scope: {
          kind: 'run',
          runId: 'run-install',
          organizationId: 'org-install',
          capabilityGrantId: DURABLE_GRANT_ID,
          invokingNodeId: 'invoking-agent',
        },
        manifest: DURABLE_MANIFEST,
      },
    });
    expect(redis.sets).toHaveLength(1);
  });

  it('does not issue a token when manifest installation fails', async () => {
    const redis = new MockRedis();
    const service = createService(
      redis,
      vi.fn(async () => 1),
      vi.fn(async () => durableAuthority('run-install', null)),
      vi.fn(async () => {
        throw new Error('manifest rejected');
      }),
    );

    await expect(service.generateSessionToken('run-install', null)).rejects.toThrow(
      'manifest rejected',
    );
    expect(redis.sets).toHaveLength(0);
  });

  it('does not mistake a manifest Update registration failure for a legacy workflow', async () => {
    const redis = new MockRedis();
    const service = createService(
      redis,
      vi.fn(async () => 1),
      vi.fn(async () => durableAuthority('run-install', null)),
      vi.fn(async () => {
        throw new QueryNotRegisteredError('Update is not registered', grpcStatus.INVALID_ARGUMENT);
      }),
    );

    await expect(service.generateSessionToken('run-install', null)).rejects.toThrow(
      'Update is not registered',
    );
    expect(redis.sets).toHaveLength(0);
  });

  it('issues only a bounded legacy token when the workflow query is not registered', async () => {
    const redis = new MockRedis();
    const materialize = vi.fn(async () => durableAuthority());
    const service = createService(
      redis,
      vi.fn(async () => {
        throw new QueryNotRegisteredError('query is not registered', grpcStatus.INVALID_ARGUMENT);
      }),
      materialize,
    );

    await service.generateSessionToken('legacy-run', null, 'legacy-agent', ['node-a'], 20_000);

    expect(materialize).not.toHaveBeenCalled();
    expect(redis.sets[0].ttl).toBe(10_800);
    const metadata = JSON.parse(redis.sets[0].value) as Record<string, unknown>;
    expect(metadata.capabilityGrantId).toMatch(UUID_V4_PATTERN);
    expect(metadata).not.toHaveProperty('capabilitySnapshotId');
  });

  it.each([
    ['unsupported protocol', async () => 2, 'Unsupported tool invocation protocol version: 2'],
    [
      'Temporal transport error',
      async () => {
        throw new Error('Temporal unavailable');
      },
      'Temporal unavailable',
    ],
  ])('propagates %s without storing a token', async (_name, queryWorkflow, message) => {
    const redis = new MockRedis();
    const service = createService(redis, queryWorkflow);

    await expect(service.generateSessionToken('run-error', null)).rejects.toThrow(message);
    expect(redis.sets).toHaveLength(0);
  });
});

function createService(
  redis: MockRedis,
  queryWorkflow: (input: { workflowId: string; queryType: string }) => Promise<number> = async () =>
    1,
  materialize: (input: unknown) => Promise<ReturnType<typeof durableAuthority>> = async () =>
    durableAuthority(),
  executeWorkflowUpdate: (input: unknown) => Promise<unknown> = async () => undefined,
): McpAuthService {
  return new McpAuthService(
    redis as never,
    { queryWorkflow, executeWorkflowUpdate } as never,
    { materialize } as never,
  );
}

function durableAuthority(
  runId = 'run-grant',
  organizationId: string | null = 'org-grant',
  invokingNodeId?: string,
) {
  return {
    grant: { id: DURABLE_GRANT_ID },
    snapshot: {
      id: DURABLE_SNAPSHOT_ID,
      scope: {
        kind: 'run' as const,
        runId,
        organizationId,
        capabilityGrantId: DURABLE_GRANT_ID,
        ...(invokingNodeId !== undefined && { invokingNodeId }),
      },
    },
    manifest: DURABLE_MANIFEST,
  };
}
