import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { RedisHealthIndicator } from '../indicators/redis.health-indicator';

function createMockConfigService(redisUrl?: string) {
  return {
    get: vi.fn((key: string) => {
      if (key === 'redis.url') return redisUrl;
      return undefined;
    }),
  };
}

// Mock ioredis before importing the indicator
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      ping: vi.fn().mockResolvedValue('PONG'),
      disconnect: vi.fn(),
      on: vi.fn(),
    })),
  };
});

describe('RedisHealthIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy with "not configured" when REDIS_URL is not set', async () => {
    const configService = createMockConfigService(undefined);
    const indicator = new RedisHealthIndicator(configService as any);

    const result = await indicator.isHealthy();
    expect(result.redis.status).toBe('up');
    expect((result.redis as any).message).toBe('not configured');
  });

  it('returns healthy when Redis PING succeeds', async () => {
    const configService = createMockConfigService('redis://localhost:6379');
    const indicator = new RedisHealthIndicator(configService as any);

    const result = await indicator.isHealthy();
    expect(result.redis.status).toBe('up');
  });

  it('uses the provided key name', async () => {
    const configService = createMockConfigService(undefined);
    const indicator = new RedisHealthIndicator(configService as any);

    const result = await indicator.isHealthy('cache');
    expect(result.cache).toBeDefined();
    expect(result.cache.status).toBe('up');
  });
});
