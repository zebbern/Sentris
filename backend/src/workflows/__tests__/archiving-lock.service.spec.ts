import { describe, it, expect, beforeEach } from 'bun:test';
import { ArchivingLockService } from '../archiving-lock.service';

// ── MockRedis ───────────────────────────────────────────────────────

class MockRedis {
  private kv = new Map<string, string>();
  private ttls = new Map<string, number>();

  async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: number,
    flag?: string,
  ): Promise<string | null> {
    if (flag === 'NX' && this.kv.has(key)) return null;
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

  /**
   * Minimal Lua eval supporting the compare-and-delete script.
   * Simulates: if GET(KEYS[1]) == ARGV[1] then DEL(KEYS[1]) else 0
   */
  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    value: string,
  ): Promise<number> {
    if (this.kv.get(key) === value) {
      this.kv.delete(key);
      this.ttls.delete(key);
      return 1;
    }
    return 0;
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
  override async set(): Promise<string | null> {
    throw new Error('Redis connection refused');
  }

  override async get(): Promise<string | null> {
    throw new Error('Redis connection refused');
  }

  override async del(): Promise<number> {
    throw new Error('Redis connection refused');
  }

  override async eval(): Promise<number> {
    throw new Error('Redis connection refused');
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ArchivingLockService', () => {
  let service: ArchivingLockService;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    service = new ArchivingLockService(redis as any);
  });

  describe('tryAcquire', () => {
    it('returns true on first call (SETNX succeeds)', async () => {
      const acquired = await service.tryAcquire('run-1');
      expect(acquired).toBe(true);
    });

    it('returns false on second call with same runId (already locked)', async () => {
      await service.tryAcquire('run-1');
      const second = await service.tryAcquire('run-1');
      expect(second).toBe(false);
    });

    it('allows acquiring locks for different runIds', async () => {
      expect(await service.tryAcquire('run-1')).toBe(true);
      expect(await service.tryAcquire('run-2')).toBe(true);
    });

    it('sets TTL to 900 seconds (15 minutes)', async () => {
      await service.tryAcquire('run-ttl');
      const key = 'sentris:archiving:run-ttl';
      expect(redis.getTtl(key)).toBe(900);
    });

    it('sets the Redis key with instanceId as value', async () => {
      await service.tryAcquire('run-1');
      const key = 'sentris:archiving:run-1';
      const value = await redis.get(key);
      expect(value).toBeTruthy();
      // Value should be the instanceId string (not just '1')
      expect(typeof value).toBe('string');
      expect(value!.length).toBeGreaterThan(1);
    });
  });

  describe('release', () => {
    it('deletes the Redis key so tryAcquire succeeds again', async () => {
      await service.tryAcquire('run-1');
      expect(await service.tryAcquire('run-1')).toBe(false); // locked

      await service.release('run-1');
      expect(await service.tryAcquire('run-1')).toBe(true); // re-acquirable
    });

    it('does not throw when releasing a non-existent lock', async () => {
      await service.release('non-existent');
      // No error
    });

    it('clears both Redis and local lock', async () => {
      await service.tryAcquire('run-1');
      await service.release('run-1');

      // Both Redis key and local Set should be cleared
      expect(redis.has('sentris:archiving:run-1')).toBe(false);
      expect(await service.tryAcquire('run-1')).toBe(true);
    });
  });

  describe('cross-instance locking (simulated)', () => {
    it('Instance B cannot acquire a lock held by Instance A', async () => {
      const serviceA = new ArchivingLockService(redis as any);
      const serviceB = new ArchivingLockService(redis as any);

      expect(await serviceA.tryAcquire('run-shared')).toBe(true);
      // Instance B sees the Redis key set by Instance A
      expect(await serviceB.tryAcquire('run-shared')).toBe(false);
    });

    it('Instance B cannot release a lock held by Instance A (compare-and-delete)', async () => {
      // Simulate Instance A by writing a lock with a different instanceId directly
      await redis.set('sentris:archiving:run-shared', 'other-instance-99', 'EX', 900, 'NX');

      // Instance B (service) tries to release — should fail because instanceId differs
      await service.release('run-shared');

      // Redis key should still exist (B's compare-and-delete didn't match)
      expect(redis.has('sentris:archiving:run-shared')).toBe(true);
    });

    it('Instance B can acquire after Instance A releases', async () => {
      const serviceA = new ArchivingLockService(redis as any);
      const serviceB = new ArchivingLockService(redis as any);

      await serviceA.tryAcquire('run-shared');
      await serviceA.release('run-shared');

      expect(await serviceB.tryAcquire('run-shared')).toBe(true);
    });
  });

  describe('null Redis fallback (local Set)', () => {
    let nullService: ArchivingLockService;

    beforeEach(() => {
      nullService = new ArchivingLockService(null);
    });

    it('tryAcquire returns true on first call', async () => {
      expect(await nullService.tryAcquire('run-1')).toBe(true);
    });

    it('tryAcquire returns false on second call (local guard)', async () => {
      await nullService.tryAcquire('run-1');
      expect(await nullService.tryAcquire('run-1')).toBe(false);
    });

    it('release allows re-acquisition', async () => {
      await nullService.tryAcquire('run-1');
      await nullService.release('run-1');
      expect(await nullService.tryAcquire('run-1')).toBe(true);
    });
  });

  describe('Redis errors', () => {
    let errorService: ArchivingLockService;

    beforeEach(() => {
      errorService = new ArchivingLockService(new ErrorRedis() as any);
    });

    it('tryAcquire falls back to local Set and returns true', async () => {
      const acquired = await errorService.tryAcquire('run-1');
      expect(acquired).toBe(true);
    });

    it('tryAcquire returns false on second call (local guard still works)', async () => {
      await errorService.tryAcquire('run-1');
      expect(await errorService.tryAcquire('run-1')).toBe(false);
    });

    it('release does not throw', async () => {
      await errorService.tryAcquire('run-1');
      await errorService.release('run-1');
      // No error thrown
    });
  });
});
