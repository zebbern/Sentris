import { describe, expect, it, vi } from 'bun:test';
import { InternalMcpController } from '../internal-mcp.controller';
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
    const service = new McpAuthService(redis as never);

    const before = Math.floor(Date.now() / 1000);
    await service.generateSessionToken('run-ttl', 'org-ttl', 'agent-ttl', ['tool-a'], requested);
    const after = Math.floor(Date.now() / 1000);

    expect(redis.sets).toHaveLength(1);
    expect(redis.sets[0].ttl).toBe(expected);
    const metadata = JSON.parse(redis.sets[0].value) as { expiresAt: number };
    expect(metadata.expiresAt).toBeGreaterThanOrEqual(before + expected);
    expect(metadata.expiresAt).toBeLessThanOrEqual(after + expected);
  });

  it('stores one grant UUID and a normalized immutable node scope for every new token', async () => {
    const redis = new MockRedis();
    const service = new McpAuthService(redis as never);

    const token = await service.generateSessionToken('run-grant', 'org-grant', 'agent-grant', [
      ' node-b ',
      '',
      'node-a',
      'node-b',
      '   ',
    ]);

    expect(redis.sets).toHaveLength(1);
    const metadata = JSON.parse(redis.sets[0].value) as {
      capabilityGrantId: string;
      allowedNodeIds: string[];
    };
    expect(metadata.capabilityGrantId).toMatch(UUID_V4_PATTERN);
    expect(metadata.allowedNodeIds).toEqual(['node-a', 'node-b']);

    const firstValidation = await service.validateToken(token);
    const secondValidation = await service.validateToken(token);
    expect(firstValidation?.extra).toEqual({
      runId: 'run-grant',
      organizationId: 'org-grant',
      capabilityGrantId: metadata.capabilityGrantId,
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
    const service = new McpAuthService(redis as never);

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
      const authInfo = await new McpAuthService(redis as never).validateToken(variant.token);
      grantIds.push(authInfo?.extra?.capabilityGrantId as string);
    }

    expect(new Set(grantIds).size).toBe(variants.length);
  });
});

describe('InternalMcpController', () => {
  it('passes requested token TTL to the auth service', async () => {
    const generateSessionToken = vi.fn(async () => 'gateway-token');
    const controller = new InternalMcpController(
      {} as never,
      {} as never,
      {} as never,
      { generateSessionToken } as never,
    );

    await expect(
      controller.generateToken({
        runId: 'run-controller-ttl',
        organizationId: 'org-controller-ttl',
        agentId: 'agent-controller-ttl',
        allowedNodeIds: ['tool-a'],
        ttlSeconds: 900,
      }),
    ).resolves.toEqual({ token: 'gateway-token' });
    expect(generateSessionToken).toHaveBeenCalledWith(
      'run-controller-ttl',
      'org-controller-ttl',
      'agent-controller-ttl',
      ['tool-a'],
      900,
    );
  });
});
