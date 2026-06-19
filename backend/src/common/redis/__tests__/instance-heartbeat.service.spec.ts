import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { InstanceHeartbeatService, type InstanceInfo } from '../instance-heartbeat.service';

/** Minimal Redis mock for heartbeat service tests */
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

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => this.kv.get(k) ?? null);
  }

  async scan(
    cursor: string,
    _match: string,
    pattern: string,
    _count: string,
    _countVal: number,
  ): Promise<[string, string[]]> {
    // Return all matching keys in a single iteration
    const prefix = pattern.replace('*', '');
    const matchingKeys = [...this.kv.keys()].filter((k) => k.startsWith(prefix));
    return ['0', matchingKeys];
  }

  async quit(): Promise<void> {}

  /** Test helper — get stored TTL for a key */
  getTtl(key: string): number | undefined {
    return this.ttls.get(key);
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

  override async exists(): Promise<number> {
    throw new Error('Redis connection refused');
  }

  override async mget(): Promise<(string | null)[]> {
    throw new Error('Redis connection refused');
  }

  override async scan(): Promise<[string, string[]]> {
    throw new Error('Redis connection refused');
  }
}

describe('InstanceHeartbeatService', () => {
  let service: InstanceHeartbeatService;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    service = new InstanceHeartbeatService(redis as any);
  });

  afterEach(async () => {
    // Clean up interval if onModuleInit was called
    await service.onModuleDestroy();
  });

  describe('register', () => {
    it('stores heartbeat data with TTL', async () => {
      await service.register();

      const key = `sentris:instances:${service.instanceId}`;
      const raw = await redis.get(key);
      expect(raw).toBeTruthy();

      const data = JSON.parse(raw!) as InstanceInfo;
      expect(data.instanceId).toBe(service.instanceId);
      expect(data.hostname).toBe(service.instanceId);
      expect(data.pid).toBe(process.pid);
      expect(data.startedAt).toBeTruthy();
      expect(data.lastHeartbeat).toBeTruthy();

      // TTL should be 30 seconds
      expect(redis.getTtl(key)).toBe(30);
    });

    it('updates lastHeartbeat on each call', async () => {
      await service.register();
      const key = `sentris:instances:${service.instanceId}`;
      const first = JSON.parse((await redis.get(key))!) as InstanceInfo;

      // Wait a tiny bit to get a different timestamp
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.register();
      const second = JSON.parse((await redis.get(key))!) as InstanceInfo;

      expect(second.startedAt).toBe(first.startedAt); // same start time
      // lastHeartbeat should be the same or later
      expect(new Date(second.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
        new Date(first.lastHeartbeat).getTime(),
      );
    });
  });

  describe('listAliveInstances', () => {
    it('returns all alive instances', async () => {
      // Simulate two instances by writing directly to Redis
      const instance1: InstanceInfo = {
        instanceId: 'host-1',
        hostname: 'host-1',
        pid: 1001,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      const instance2: InstanceInfo = {
        instanceId: 'host-2',
        hostname: 'host-2',
        pid: 1002,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      await redis.set('sentris:instances:host-1', JSON.stringify(instance1), 'EX', 30);
      await redis.set('sentris:instances:host-2', JSON.stringify(instance2), 'EX', 30);

      const instances = await service.listAliveInstances();
      expect(instances).toHaveLength(2);
      expect(instances.map((i) => i.instanceId).sort()).toEqual(['host-1', 'host-2']);
    });

    it('returns empty array when no instances exist', async () => {
      const instances = await service.listAliveInstances();
      expect(instances).toEqual([]);
    });

    it('skips entries with invalid JSON', async () => {
      await redis.set('sentris:instances:host-1', 'not-json', 'EX', 30);
      await redis.set(
        'sentris:instances:host-2',
        JSON.stringify({
          instanceId: 'host-2',
          hostname: 'host-2',
          pid: 1002,
          startedAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        }),
        'EX',
        30,
      );

      const instances = await service.listAliveInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0].instanceId).toBe('host-2');
    });
  });

  describe('isInstanceAlive', () => {
    it('returns true when the instance key exists', async () => {
      await redis.set(
        'sentris:instances:host-1',
        JSON.stringify({ instanceId: 'host-1' }),
        'EX',
        30,
      );

      expect(await service.isInstanceAlive('host-1')).toBe(true);
    });

    it('returns false when the instance key is missing', async () => {
      expect(await service.isInstanceAlive('host-dead')).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('publishes heartbeat immediately', async () => {
      await service.onModuleInit();

      const key = `sentris:instances:${service.instanceId}`;
      const raw = await redis.get(key);
      expect(raw).toBeTruthy();
    });
  });

  describe('onModuleDestroy', () => {
    it('removes the instance key on shutdown', async () => {
      await service.register();
      const key = `sentris:instances:${service.instanceId}`;
      expect(await redis.exists(key)).toBe(1);

      await service.onModuleDestroy();
      expect(await redis.exists(key)).toBe(0);
    });
  });

  describe('null redis (disabled)', () => {
    let nullService: InstanceHeartbeatService;

    beforeEach(() => {
      nullService = new InstanceHeartbeatService(null);
    });

    afterEach(async () => {
      await nullService.onModuleDestroy();
    });

    it('register is a no-op', async () => {
      await nullService.register(); // should not throw
    });

    it('listAliveInstances returns empty', async () => {
      const instances = await nullService.listAliveInstances();
      expect(instances).toEqual([]);
    });

    it('isInstanceAlive returns true (graceful degradation)', async () => {
      expect(await nullService.isInstanceAlive('any-host')).toBe(true);
    });

    it('onModuleInit does not throw', async () => {
      await nullService.onModuleInit();
    });

    it('onModuleDestroy does not throw', async () => {
      await nullService.onModuleDestroy();
    });
  });

  describe('Redis errors', () => {
    let errorService: InstanceHeartbeatService;

    beforeEach(() => {
      errorService = new InstanceHeartbeatService(new ErrorRedis() as any);
    });

    afterEach(async () => {
      try {
        await errorService.onModuleDestroy();
      } catch {
        // ignore
      }
    });

    it('register does not throw', async () => {
      await errorService.register(); // should not throw
    });

    it('listAliveInstances returns empty on error', async () => {
      const instances = await errorService.listAliveInstances();
      expect(instances).toEqual([]);
    });

    it('isInstanceAlive returns true on error (assumes alive)', async () => {
      expect(await errorService.isInstanceAlive('host-1')).toBe(true);
    });
  });

  describe('instanceId', () => {
    it('includes SENTRIS_INSTANCE when available', () => {
      const origHostname = process.env.HOSTNAME;
      const origInstance = process.env.SENTRIS_INSTANCE;
      try {
        process.env.HOSTNAME = 'web-server';
        process.env.SENTRIS_INSTANCE = '3';
        const svc = new InstanceHeartbeatService(null);
        expect(svc.instanceId).toBe('web-server-3');
      } finally {
        if (origHostname === undefined) delete process.env.HOSTNAME;
        else process.env.HOSTNAME = origHostname;
        if (origInstance === undefined) delete process.env.SENTRIS_INSTANCE;
        else process.env.SENTRIS_INSTANCE = origInstance;
      }
    });

    it('uses pm_id when SENTRIS_INSTANCE is not set', () => {
      const origHostname = process.env.HOSTNAME;
      const origInstance = process.env.SENTRIS_INSTANCE;
      const origPmId = process.env.pm_id;
      try {
        process.env.HOSTNAME = 'web-server';
        delete process.env.SENTRIS_INSTANCE;
        process.env.pm_id = '5';
        const svc = new InstanceHeartbeatService(null);
        expect(svc.instanceId).toBe('web-server-5');
      } finally {
        if (origHostname === undefined) delete process.env.HOSTNAME;
        else process.env.HOSTNAME = origHostname;
        if (origInstance === undefined) delete process.env.SENTRIS_INSTANCE;
        else process.env.SENTRIS_INSTANCE = origInstance;
        if (origPmId === undefined) delete process.env.pm_id;
        else process.env.pm_id = origPmId;
      }
    });

    it('falls back to PID when no instance env is set', () => {
      const origHostname = process.env.HOSTNAME;
      const origInstance = process.env.SENTRIS_INSTANCE;
      const origPmId = process.env.pm_id;
      try {
        process.env.HOSTNAME = 'custom-host';
        delete process.env.SENTRIS_INSTANCE;
        delete process.env.pm_id;
        const svc = new InstanceHeartbeatService(null);
        expect(svc.instanceId).toBe(`custom-host-${process.pid}`);
      } finally {
        if (origHostname === undefined) delete process.env.HOSTNAME;
        else process.env.HOSTNAME = origHostname;
        if (origInstance === undefined) delete process.env.SENTRIS_INSTANCE;
        else process.env.SENTRIS_INSTANCE = origInstance;
        if (origPmId === undefined) delete process.env.pm_id;
        else process.env.pm_id = origPmId;
      }
    });

    it('falls back to os.hostname() when HOSTNAME env is not set', () => {
      const origHostname = process.env.HOSTNAME;
      const origInstance = process.env.SENTRIS_INSTANCE;
      const origPmId = process.env.pm_id;
      try {
        delete process.env.HOSTNAME;
        delete process.env.SENTRIS_INSTANCE;
        delete process.env.pm_id;
        const svc = new InstanceHeartbeatService(null);
        expect(svc.instanceId).toBeTruthy();
        expect(typeof svc.instanceId).toBe('string');
        // Should contain a hyphen separating host from discriminator
        expect(svc.instanceId).toContain('-');
      } finally {
        if (origHostname === undefined) delete process.env.HOSTNAME;
        else process.env.HOSTNAME = origHostname;
        if (origInstance === undefined) delete process.env.SENTRIS_INSTANCE;
        else process.env.SENTRIS_INSTANCE = origInstance;
        if (origPmId === undefined) delete process.env.pm_id;
        else process.env.pm_id = origPmId;
      }
    });
  });
});
