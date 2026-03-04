import { describe, it, expect, beforeEach } from 'bun:test';
import { createHash } from 'crypto';
import { EtagCacheService } from '../etag-cache.service';

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

/** Reproduce the SHA-256 URL hash used by EtagCacheService */
function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

// ── Tests ───────────────────────────────────────────────────────────

describe('EtagCacheService', () => {
  let service: EtagCacheService;
  let redis: MockRedis;

  const TEST_URL = 'https://api.github.com/repos/owner/repo/contents/templates';
  const TEST_ETAG = 'W/"abc123"';
  const TEST_DATA = [
    { name: 'template1.json', sha: 'sha-1' },
    { name: 'template2.json', sha: 'sha-2' },
  ];

  beforeEach(() => {
    redis = new MockRedis();
    service = new EtagCacheService(redis as any);
  });

  describe('set + get round-trip', () => {
    it('stores and retrieves an etag response', async () => {
      await service.set(TEST_URL, TEST_ETAG, TEST_DATA);

      const result = await service.get(TEST_URL);
      expect(result).toBeTruthy();
      expect(result!.etag).toBe(TEST_ETAG);
      expect(result!.data).toEqual(TEST_DATA);
    });

    it('handles string data', async () => {
      await service.set(TEST_URL, TEST_ETAG, 'raw-content');

      const result = await service.get(TEST_URL);
      expect(result).toBeTruthy();
      expect(result!.data).toBe('raw-content');
    });

    it('handles complex nested data', async () => {
      const complexData = {
        files: [{ name: 'a.json', content: { key: 'value' } }],
        metadata: { count: 1 },
      };
      await service.set(TEST_URL, TEST_ETAG, complexData);

      const result = await service.get(TEST_URL);
      expect(result).toBeTruthy();
      expect(result!.data).toEqual(complexData);
    });
  });

  describe('get', () => {
    it('returns null for missing URL', async () => {
      const result = await service.get('https://api.github.com/repos/nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the cached response', async () => {
      await service.set(TEST_URL, TEST_ETAG, TEST_DATA);
      expect(await service.get(TEST_URL)).toBeTruthy();

      await service.delete(TEST_URL);
      expect(await service.get(TEST_URL)).toBeNull();
    });

    it('does not throw for non-existent URL', async () => {
      await service.delete('https://api.github.com/repos/nonexistent');
    });
  });

  describe('TTL', () => {
    it('sets TTL to 2100 seconds (35 minutes)', async () => {
      await service.set(TEST_URL, TEST_ETAG, TEST_DATA);

      const expectedKey = `sentris:etag-cache:${hashUrl(TEST_URL)}`;
      expect(redis.getTtl(expectedKey)).toBe(2100);
    });
  });

  describe('URL key hashing (SHA-256)', () => {
    it('uses SHA-256 hash of the URL as the Redis key', async () => {
      await service.set(TEST_URL, TEST_ETAG, TEST_DATA);

      const expectedHash = hashUrl(TEST_URL);
      const expectedKey = `sentris:etag-cache:${expectedHash}`;
      expect(redis.has(expectedKey)).toBe(true);
    });

    it('produces the same key for the same URL', async () => {
      await service.set(TEST_URL, 'etag-1', 'data-1');
      await service.set(TEST_URL, 'etag-2', 'data-2');

      // Should overwrite (same key)
      const result = await service.get(TEST_URL);
      expect(result!.etag).toBe('etag-2');
    });

    it('produces different keys for different URLs', async () => {
      const url1 = 'https://api.github.com/repos/owner/repo1';
      const url2 = 'https://api.github.com/repos/owner/repo2';

      await service.set(url1, 'etag-1', 'data-1');
      await service.set(url2, 'etag-2', 'data-2');

      const key1 = `sentris:etag-cache:${hashUrl(url1)}`;
      const key2 = `sentris:etag-cache:${hashUrl(url2)}`;
      expect(key1).not.toBe(key2);
      expect(redis.has(key1)).toBe(true);
      expect(redis.has(key2)).toBe(true);
    });

    it('handles URLs with special characters and query params', async () => {
      const specialUrl =
        'https://api.github.com/repos/owner/repo/contents/path?ref=main&per_page=100';
      await service.set(specialUrl, TEST_ETAG, TEST_DATA);

      const result = await service.get(specialUrl);
      expect(result).toBeTruthy();
      expect(result!.etag).toBe(TEST_ETAG);
    });
  });

  describe('null Redis (disabled)', () => {
    let nullService: EtagCacheService;

    beforeEach(() => {
      nullService = new EtagCacheService(null);
    });

    it('get returns null', async () => {
      const result = await nullService.get(TEST_URL);
      expect(result).toBeNull();
    });

    it('set is a no-op (does not throw)', async () => {
      await nullService.set(TEST_URL, TEST_ETAG, TEST_DATA);
    });

    it('delete is a no-op (does not throw)', async () => {
      await nullService.delete(TEST_URL);
    });
  });

  describe('Redis errors', () => {
    let errorService: EtagCacheService;

    beforeEach(() => {
      errorService = new EtagCacheService(new ErrorRedis() as any);
    });

    it('get does not throw and returns null', async () => {
      const result = await errorService.get(TEST_URL);
      expect(result).toBeNull();
    });

    it('set does not throw', async () => {
      await errorService.set(TEST_URL, TEST_ETAG, TEST_DATA);
    });

    it('delete does not throw', async () => {
      await errorService.delete(TEST_URL);
    });
  });
});
