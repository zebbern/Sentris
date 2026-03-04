import { describe, it, expect, beforeEach } from 'bun:test';
import {
  FlowContextCacheService,
  type CachedFlowContext,
} from '../flow-context-cache.service';

// ── MockRedis ───────────────────────────────────────────────────────

class MockRedis {
  private kv = new Map<string, string>();
  private ttls = new Map<string, number>();

  async set(key: string, value: string, mode?: string, ttl?: number): Promise<string> {
    this.kv.set(key, value);
    if (mode === 'EX' && ttl) {
      this.ttls.set(key, ttl);
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    const existed = this.kv.has(key);
    this.kv.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<void> {}

  /** Test helper — get stored TTL for a key */
  getTtl(key: string): number | undefined {
    return this.ttls.get(key);
  }

  /** Test helper — check if key exists */
  has(key: string): boolean {
    return this.kv.has(key);
  }
}

/** Error-throwing Redis mock */
class ErrorRedis extends MockRedis {
  override async set(): Promise<string> {
    throw new Error('Redis connection refused');
  }

  override async get(): Promise<string | null> {
    throw new Error('Redis connection refused');
  }

  override async del(): Promise<number> {
    throw new Error('Redis connection refused');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeSampleFlowContext(): CachedFlowContext {
  return {
    workflowId: 'wf-1',
    workflowVersionId: 'wfv-1',
    workflowVersion: 3,
    targetsBySource: new Map([
      [
        'node-a:output',
        [
          { targetRef: 'node-b', sourceHandle: 'output', inputKey: 'input1' },
          { targetRef: 'node-c', sourceHandle: 'output', inputKey: 'data' },
        ],
      ],
      [
        'node-b:result',
        [{ targetRef: 'node-d', sourceHandle: 'result', inputKey: 'payload' }],
      ],
    ]),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('FlowContextCacheService', () => {
  let service: FlowContextCacheService;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    service = new FlowContextCacheService(redis as any);
  });

  describe('set + get round-trip', () => {
    it('stores and retrieves a FlowContext with all fields intact', async () => {
      const ctx = makeSampleFlowContext();
      await service.set('run-1', ctx);

      const result = await service.get('run-1');
      expect(result).toBeTruthy();
      expect(result!.workflowId).toBe('wf-1');
      expect(result!.workflowVersionId).toBe('wfv-1');
      expect(result!.workflowVersion).toBe(3);
    });

    it('correctly deserializes targetsBySource Map from JSON', async () => {
      const ctx = makeSampleFlowContext();
      await service.set('run-1', ctx);

      const result = await service.get('run-1');
      expect(result).toBeTruthy();

      // Verify it returns a Map (not a plain object)
      expect(result!.targetsBySource).toBeInstanceOf(Map);
      expect(result!.targetsBySource.size).toBe(2);

      // Verify the map entries have correct data
      const targetsA = result!.targetsBySource.get('node-a:output');
      expect(targetsA).toBeTruthy();
      expect(targetsA).toHaveLength(2);
      expect(targetsA![0]).toEqual({
        targetRef: 'node-b',
        sourceHandle: 'output',
        inputKey: 'input1',
      });
      expect(targetsA![1]).toEqual({
        targetRef: 'node-c',
        sourceHandle: 'output',
        inputKey: 'data',
      });

      const targetsB = result!.targetsBySource.get('node-b:result');
      expect(targetsB).toBeTruthy();
      expect(targetsB).toHaveLength(1);
      expect(targetsB![0]).toEqual({
        targetRef: 'node-d',
        sourceHandle: 'result',
        inputKey: 'payload',
      });
    });

    it('handles empty targetsBySource Map', async () => {
      const ctx: CachedFlowContext = {
        workflowId: 'wf-empty',
        workflowVersionId: 'wfv-empty',
        workflowVersion: 1,
        targetsBySource: new Map(),
      };
      await service.set('run-empty', ctx);

      const result = await service.get('run-empty');
      expect(result).toBeTruthy();
      expect(result!.targetsBySource).toBeInstanceOf(Map);
      expect(result!.targetsBySource.size).toBe(0);
    });
  });

  describe('get', () => {
    it('returns null for missing key', async () => {
      const result = await service.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the key so get returns null', async () => {
      const ctx = makeSampleFlowContext();
      await service.set('run-1', ctx);

      // Verify it exists
      expect(await service.get('run-1')).toBeTruthy();

      // Delete
      await service.delete('run-1');

      // Verify it's gone
      expect(await service.get('run-1')).toBeNull();
    });

    it('does not throw when deleting a non-existent key', async () => {
      await service.delete('non-existent');
      // No error
    });
  });

  describe('TTL', () => {
    it('sets TTL to 600 seconds (10 minutes)', async () => {
      const ctx = makeSampleFlowContext();
      await service.set('run-ttl', ctx);

      const key = 'sentris:flow-context:run-ttl';
      expect(redis.getTtl(key)).toBe(600);
    });
  });

  describe('null Redis (disabled)', () => {
    let nullService: FlowContextCacheService;

    beforeEach(() => {
      nullService = new FlowContextCacheService(null);
    });

    it('get returns null', async () => {
      const result = await nullService.get('run-1');
      expect(result).toBeNull();
    });

    it('set is a no-op (does not throw)', async () => {
      await nullService.set('run-1', makeSampleFlowContext());
      // Should complete without throwing
    });

    it('delete is a no-op (does not throw)', async () => {
      await nullService.delete('run-1');
    });
  });

  describe('Redis errors', () => {
    let errorService: FlowContextCacheService;

    beforeEach(() => {
      errorService = new FlowContextCacheService(new ErrorRedis() as any);
    });

    it('get does not throw and returns null', async () => {
      const result = await errorService.get('run-1');
      expect(result).toBeNull();
    });

    it('set does not throw', async () => {
      await errorService.set('run-1', makeSampleFlowContext());
      // Completes without throwing
    });

    it('delete does not throw', async () => {
      await errorService.delete('run-1');
    });
  });

  describe('key format', () => {
    it('uses the correct Redis key pattern', async () => {
      const ctx = makeSampleFlowContext();
      await service.set('run-abc-123', ctx);

      const key = 'sentris:flow-context:run-abc-123';
      expect(redis.has(key)).toBe(true);
    });
  });
});
