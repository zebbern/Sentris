import { describe, it, expect, beforeEach } from 'bun:test';
import { SessionRegistryService } from '../session-registry.service';

/** Minimal Redis mock for session registry tests */
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

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.kv.has(key)) return 0;
    this.ttls.set(key, seconds);
    return 1;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace('*', '');
    return [...this.kv.keys()].filter((k) => k.startsWith(prefix));
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => this.kv.get(k) ?? null);
  }

  async quit(): Promise<void> {}

  /** Test helper — get stored TTL for a key */
  getTtl(key: string): number | undefined {
    return this.ttls.get(key);
  }
}

describe('SessionRegistryService', () => {
  let service: SessionRegistryService;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    service = new SessionRegistryService(redis as any);
  });

  describe('register', () => {
    it('stores session data with TTL', async () => {
      await service.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
        runId: 'run-1',
      });

      const raw = await redis.get('mcp:sessions:session-1');
      expect(raw).toBeTruthy();

      const data = JSON.parse(raw!);
      expect(data.userId).toBe('user-1');
      expect(data.organizationId).toBe('org-1');
      expect(data.sessionType).toBe('mcp-gateway');
      expect(data.runId).toBe('run-1');
      expect(data.instanceId).toBeTruthy();
      expect(data.createdAt).toBeTruthy();

      // Verify TTL was set (2 hours = 7200s)
      expect(redis.getTtl('mcp:sessions:session-1')).toBe(7200);
    });

    it('handles null userId and organizationId', async () => {
      await service.register('session-2', {
        userId: null,
        organizationId: null,
        sessionType: 'studio-mcp',
      });

      const data = await service.getSession('session-2');
      expect(data).toBeTruthy();
      expect(data!.userId).toBeNull();
      expect(data!.organizationId).toBeNull();
      expect(data!.sessionType).toBe('studio-mcp');
    });
  });

  describe('deregister', () => {
    it('removes session from registry', async () => {
      await service.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
      });

      await service.deregister('session-1');

      const data = await service.getSession('session-1');
      expect(data).toBeNull();
    });

    it('does not throw for non-existent session', async () => {
      // Should not throw
      await service.deregister('non-existent');
    });
  });

  describe('refresh', () => {
    it('resets TTL on existing session', async () => {
      await service.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
      });

      await service.refresh('session-1', 3600);
      expect(redis.getTtl('mcp:sessions:session-1')).toBe(3600);
    });

    it('uses default TTL when none specified', async () => {
      await service.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
      });

      await service.refresh('session-1');
      expect(redis.getTtl('mcp:sessions:session-1')).toBe(7200);
    });
  });

  describe('getSession', () => {
    it('returns session data with sessionId', async () => {
      await service.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
        runId: 'run-1',
      });

      const session = await service.getSession('session-1');
      expect(session).toBeTruthy();
      expect(session!.sessionId).toBe('session-1');
      expect(session!.userId).toBe('user-1');
      expect(session!.runId).toBe('run-1');
    });

    it('returns null for missing session', async () => {
      const session = await service.getSession('non-existent');
      expect(session).toBeNull();
    });
  });

  describe('listActiveSessions', () => {
    it('returns all registered sessions', async () => {
      await service.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
        runId: 'run-1',
      });
      await service.register('session-2', {
        userId: 'user-2',
        organizationId: 'org-2',
        sessionType: 'studio-mcp',
      });

      const result = await service.listActiveSessions();
      expect(result.count).toBe(2);
      expect(result.sessions).toHaveLength(2);

      const sessionIds = result.sessions.map((s) => s.sessionId).sort();
      expect(sessionIds).toEqual(['session-1', 'session-2']);
    });

    it('returns empty when no sessions exist', async () => {
      const result = await service.listActiveSessions();
      expect(result.count).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });
  });

  describe('null redis (disabled)', () => {
    let disabledService: SessionRegistryService;

    beforeEach(() => {
      disabledService = new SessionRegistryService(null);
    });

    it('register is a no-op', async () => {
      await disabledService.register('session-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
      });
      // Should not throw
    });

    it('deregister is a no-op', async () => {
      await disabledService.deregister('session-1');
    });

    it('getSession returns null', async () => {
      const result = await disabledService.getSession('session-1');
      expect(result).toBeNull();
    });

    it('listActiveSessions returns empty', async () => {
      const result = await disabledService.listActiveSessions();
      expect(result.count).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });

    it('refresh is a no-op', async () => {
      await disabledService.refresh('session-1');
    });
  });

  describe('Redis errors', () => {
    /**
     * Redis mock that rejects every command — verifies the service
     * degrades gracefully instead of throwing.
     */
    class ThrowingRedis {
      async set(): Promise<never> {
        throw new Error('Redis connection refused');
      }
      async get(): Promise<never> {
        throw new Error('Redis connection refused');
      }
      async del(): Promise<never> {
        throw new Error('Redis connection refused');
      }
      async expire(): Promise<never> {
        throw new Error('Redis connection refused');
      }
      async keys(): Promise<never> {
        throw new Error('Redis connection refused');
      }
      async mget(): Promise<never> {
        throw new Error('Redis connection refused');
      }
      async quit(): Promise<void> {}
    }

    let errorService: SessionRegistryService;

    beforeEach(() => {
      errorService = new SessionRegistryService(new ThrowingRedis() as any);
    });

    it('register() does not throw', async () => {
      await errorService.register('session-err', {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionType: 'mcp-gateway',
        runId: 'run-1',
      });
      // Should complete without throwing
    });

    it('getSession() does not throw and returns null', async () => {
      const result = await errorService.getSession('session-err');
      expect(result).toBeNull();
    });

    it('listActiveSessions() does not throw and returns empty', async () => {
      const result = await errorService.listActiveSessions();
      expect(result.count).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });

    it('deregister() does not throw', async () => {
      await errorService.deregister('session-err');
    });

    it('refresh() does not throw', async () => {
      await errorService.refresh('session-err');
    });
  });

  describe('instanceId', () => {
    it('includes HOSTNAME and discriminator', () => {
      const originalHostname = process.env.HOSTNAME;
      const originalInstance = process.env.SENTRIS_INSTANCE;
      const originalPmId = process.env.pm_id;
      try {
        process.env.HOSTNAME = 'test-container-id';
        process.env.SENTRIS_INSTANCE = '2';
        const svc = new SessionRegistryService(redis as any);
        expect(svc.instanceId).toBe('test-container-id-2');
      } finally {
        if (originalHostname !== undefined) process.env.HOSTNAME = originalHostname;
        else delete process.env.HOSTNAME;
        if (originalInstance !== undefined) process.env.SENTRIS_INSTANCE = originalInstance;
        else delete process.env.SENTRIS_INSTANCE;
        if (originalPmId !== undefined) process.env.pm_id = originalPmId;
        else delete process.env.pm_id;
      }
    });

    it('falls back to os.hostname() with PID', () => {
      const originalHostname = process.env.HOSTNAME;
      const originalInstance = process.env.SENTRIS_INSTANCE;
      const originalPmId = process.env.pm_id;
      try {
        delete process.env.HOSTNAME;
        delete process.env.SENTRIS_INSTANCE;
        delete process.env.pm_id;
        const svc = new SessionRegistryService(redis as any);
        expect(svc.instanceId).toBeTruthy();
        expect(typeof svc.instanceId).toBe('string');
        expect(svc.instanceId).toContain('-');
      } finally {
        if (originalHostname !== undefined) process.env.HOSTNAME = originalHostname;
        else delete process.env.HOSTNAME;
        if (originalInstance !== undefined) process.env.SENTRIS_INSTANCE = originalInstance;
        else delete process.env.SENTRIS_INSTANCE;
        if (originalPmId !== undefined) process.env.pm_id = originalPmId;
        else delete process.env.pm_id;
      }
    });
  });
});
