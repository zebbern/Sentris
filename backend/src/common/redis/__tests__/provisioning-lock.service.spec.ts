import { describe, it, expect, beforeEach } from 'bun:test';
import { ProvisioningLockService } from '../provisioning-lock.service';

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

  async exists(key: string): Promise<number> {
    return this.kv.has(key) ? 1 : 0;
  }

  /**
   * Simplified eval mock for the compare-and-delete Lua script.
   * Matches the pattern: if GET(key) == argv then DEL(key) else 0.
   */
  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    expectedValue: string,
  ): Promise<number> {
    const current = this.kv.get(key);
    if (current === expectedValue) {
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

  /** Test helper — get stored value for a key */
  getValue(key: string): string | undefined {
    return this.kv.get(key);
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

  override async exists(): Promise<number> {
    throw new Error('Redis connection refused');
  }

  override async eval(): Promise<number> {
    throw new Error('Redis connection refused');
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ProvisioningLockService', () => {
  let service: ProvisioningLockService;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    service = new ProvisioningLockService(redis as any);
  });

  describe('tryAcquire', () => {
    it('returns true when no lock exists', async () => {
      const acquired = await service.tryAcquire('org-1');
      expect(acquired).toBe(true);
    });

    it('returns false when another instance holds the lock', async () => {
      const serviceA = new ProvisioningLockService(redis as any);
      const serviceB = new ProvisioningLockService(redis as any);

      expect(await serviceA.tryAcquire('org-1')).toBe(true);
      expect(await serviceB.tryAcquire('org-1')).toBe(false);
    });

    it('stores the instanceId as the lock value', async () => {
      await service.tryAcquire('org-1');
      const lockKey = 'sentris:provisioning:lock:org-1';
      const value = redis.getValue(lockKey);
      expect(value).toBeTruthy();
      // instanceId contains hostname-pid-uuid pattern
      expect(value).toContain('-');
    });

    it('sets lock TTL to 300 seconds (5 minutes)', async () => {
      await service.tryAcquire('org-1');
      const lockKey = 'sentris:provisioning:lock:org-1';
      expect(redis.getTtl(lockKey)).toBe(300);
    });

    it('allows acquiring locks for different orgIds', async () => {
      expect(await service.tryAcquire('org-1')).toBe(true);
      expect(await service.tryAcquire('org-2')).toBe(true);
    });
  });

  describe('release (compare-and-delete)', () => {
    it('deletes the lock when the value matches this instance', async () => {
      await service.tryAcquire('org-1');
      await service.release('org-1');

      expect(redis.has('sentris:provisioning:lock:org-1')).toBe(false);
    });

    it('does NOT delete the lock if value does not match (different instance)', async () => {
      const serviceA = new ProvisioningLockService(redis as any);
      const serviceB = new ProvisioningLockService(redis as any);

      // Instance A acquires the lock
      await serviceA.tryAcquire('org-1');
      const lockKey = 'sentris:provisioning:lock:org-1';
      expect(redis.has(lockKey)).toBe(true);

      // Instance B tries to release Instance A's lock — should NOT work
      await serviceB.release('org-1');
      expect(redis.has(lockKey)).toBe(true); // Lock still held by A
    });

    it('does not throw for non-existent lock', async () => {
      await service.release('org-nonexistent');
      // No error
    });

    it('allows re-acquisition after release', async () => {
      await service.tryAcquire('org-1');
      await service.release('org-1');
      expect(await service.tryAcquire('org-1')).toBe(true);
    });
  });

  describe('isProvisioned', () => {
    it('returns true when completion marker exists', async () => {
      await service.markProvisioned('org-1');
      expect(await service.isProvisioned('org-1')).toBe(true);
    });

    it('returns false when no completion marker exists', async () => {
      expect(await service.isProvisioned('org-1')).toBe(false);
    });
  });

  describe('markProvisioned', () => {
    it('sets the completion marker with correct TTL (24 hours)', async () => {
      await service.markProvisioned('org-1');

      const doneKey = 'sentris:provisioning:done:org-1';
      expect(redis.has(doneKey)).toBe(true);
      expect(redis.getTtl(doneKey)).toBe(86_400);
    });

    it('sets the value to "1"', async () => {
      await service.markProvisioned('org-1');
      const doneKey = 'sentris:provisioning:done:org-1';
      expect(redis.getValue(doneKey)).toBe('1');
    });
  });

  describe('cross-instance provisioning (simulated)', () => {
    it('Instance B sees isProvisioned=true after Instance A marks it', async () => {
      const serviceA = new ProvisioningLockService(redis as any);
      const serviceB = new ProvisioningLockService(redis as any);

      await serviceA.markProvisioned('org-shared');
      expect(await serviceB.isProvisioned('org-shared')).toBe(true);
    });

    it('Instance A acquires lock, Instance B cannot', async () => {
      const serviceA = new ProvisioningLockService(redis as any);
      const serviceB = new ProvisioningLockService(redis as any);

      expect(await serviceA.tryAcquire('org-shared')).toBe(true);
      expect(await serviceB.tryAcquire('org-shared')).toBe(false);
    });
  });

  describe('null Redis fallback', () => {
    let nullService: ProvisioningLockService;

    beforeEach(() => {
      nullService = new ProvisioningLockService(null);
    });

    it('tryAcquire returns true (allows local provisioning)', async () => {
      expect(await nullService.tryAcquire('org-1')).toBe(true);
    });

    it('isProvisioned returns false (caller should check local cache)', async () => {
      expect(await nullService.isProvisioned('org-1')).toBe(false);
    });

    it('markProvisioned is a no-op (does not throw)', async () => {
      await nullService.markProvisioned('org-1');
    });

    it('release is a no-op (does not throw)', async () => {
      await nullService.release('org-1');
    });
  });

  describe('Redis errors', () => {
    let errorService: ProvisioningLockService;

    beforeEach(() => {
      errorService = new ProvisioningLockService(new ErrorRedis() as any);
    });

    it('tryAcquire returns true on error (allows local fallback)', async () => {
      expect(await errorService.tryAcquire('org-1')).toBe(true);
    });

    it('isProvisioned returns false on error', async () => {
      expect(await errorService.isProvisioned('org-1')).toBe(false);
    });

    it('markProvisioned does not throw', async () => {
      await errorService.markProvisioned('org-1');
    });

    it('release does not throw', async () => {
      await errorService.release('org-1');
    });
  });

  describe('instanceId', () => {
    it('generates a unique instanceId per service instance', () => {
      const serviceA = new ProvisioningLockService(redis as any);
      const serviceB = new ProvisioningLockService(redis as any);
      expect(serviceA['instanceId']).not.toBe(serviceB['instanceId']);
    });
  });
});
