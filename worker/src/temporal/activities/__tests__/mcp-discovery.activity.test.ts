import { afterEach, beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';

const redisSetex = vi.fn(async (_key: string, _ttlSeconds: number, _value: string) => 'OK');
const redisGet = vi.fn(async (_key: string): Promise<string | null> => null);

class MockRedis {
  setex = redisSetex;
  get = redisGet;
}

mock.module('ioredis', () => ({
  default: MockRedis,
}));

const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;
let cacheDiscoveryResultActivity: typeof import('../mcp-discovery.activity').cacheDiscoveryResultActivity;

describe('MCP discovery activity diagnostics', () => {
  beforeAll(async () => {
    ({ cacheDiscoveryResultActivity } = await import('../mcp-discovery.activity'));
  });

  beforeEach(() => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDebugWorkflow === undefined) {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;
    } else {
      process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
    }
  });

  test('cacheDiscoveryResultActivity does not mirror successful cache diagnostics to console.log by default', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await cacheDiscoveryResultActivity({
        cacheToken: 'cache-token-1',
        workflowId: 'workflow-1',
        tools: [{ name: 'http_request', description: 'Makes HTTP requests' }],
      });

      expect(redisSetex).toHaveBeenCalledTimes(1);
      const [key, ttlSeconds, rawValue] = redisSetex.mock.calls[0];
      expect(key).toBe('mcp-discovery:cache-token-1');
      expect(ttlSeconds).toBe(300);
      expect(JSON.parse(rawValue as string)).toMatchObject({
        status: 'completed',
        workflowId: 'workflow-1',
        toolCount: 1,
      });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
