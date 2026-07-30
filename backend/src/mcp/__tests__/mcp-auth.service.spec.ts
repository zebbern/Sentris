import { describe, expect, it, vi } from 'bun:test';
import { InternalMcpController } from '../internal-mcp.controller';
import { McpAuthService } from '../mcp-auth.service';

class MockRedis {
  readonly sets: { key: string; value: string; ttl: number }[] = [];

  async set(key: string, value: string, _mode: string, ttl: number): Promise<'OK'> {
    this.sets.push({ key, value, ttl });
    return 'OK';
  }
}

describe('McpAuthService', () => {
  it.each([
    { requested: undefined, expected: 3600 },
    { requested: 30, expected: 60 },
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
