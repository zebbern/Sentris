import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type Redis from 'ioredis';
import type { McpRuntimeKey } from '@sentris/shared';

import { createDatabasePool, createMcpRuntimeLeaseServices } from '../service-factory';

const MCP_RUNTIME_ENV_KEYS = [
  'MCP_RUNTIME_REDIS_URL',
  'MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS',
  'MCP_RUNTIME_STARTING_TTL_MS',
  'MCP_RUNTIME_LEASE_TTL_MS',
  'MCP_RUNTIME_RENEWAL_INTERVAL_MS',
  'MCP_RUNTIME_OWNER_ID',
  'MCP_RUNTIME_OWNER_URL',
  'TERMINAL_REDIS_URL',
  'SENTRIS_DEPLOYMENT_ID',
  'SENTRIS_INSTANCE',
  'TEMPORAL_NAMESPACE',
  'TEMPORAL_TASK_QUEUE',
] as const;

const RUNTIME_KEY: McpRuntimeKey = {
  sourceId: 'source-1',
  transport: 'http',
  configFingerprint: 'a'.repeat(64),
  organizationId: 'org-1',
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: null,
  credentialGeneration: null,
};

let previousMcpRuntimeEnv: Record<(typeof MCP_RUNTIME_ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  previousMcpRuntimeEnv = Object.fromEntries(
    MCP_RUNTIME_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as typeof previousMcpRuntimeEnv;
  for (const key of MCP_RUNTIME_ENV_KEYS) Reflect.deleteProperty(process.env, key);
});

afterEach(() => {
  for (const key of MCP_RUNTIME_ENV_KEYS) {
    const value = previousMcpRuntimeEnv[key];
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
});

class FakeMcpRuntimeRedisClient {
  connectCalls = 0;
  pingCalls = 0;
  quitCalls = 0;
  disconnectCalls = 0;
  lastGetKey: string | undefined;

  constructor(private readonly failure?: 'connect' | 'ping') {}

  defineCommand(): void {}

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.failure === 'connect') throw new Error('Redis connect failed');
  }

  async ping(): Promise<string> {
    this.pingCalls += 1;
    if (this.failure === 'ping') throw new Error('Redis ping failed');
    return 'PONG';
  }

  async get(key: string): Promise<null> {
    this.lastGetKey = key;
    return null;
  }

  async quit(): Promise<string> {
    this.quitCalls += 1;
    return 'OK';
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

function configureMcpRuntimeOwner(): void {
  process.env.MCP_RUNTIME_OWNER_ID = 'worker-instance-7';
  process.env.MCP_RUNTIME_OWNER_URL = 'https://worker-7.internal:9200';
}

describe('worker service factory', () => {
  it('keeps the worker alive when an idle PostgreSQL client reports an error', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://sentris:sentris@postgres:5432/sentris';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = createDatabasePool();
    const idleClientError = Object.assign(
      new Error('Connection terminated unexpectedly for postgresql://sentris:secret@postgres'),
      {
        code: '57P01',
        client: {
          connectionParameters: {
            password: 'secret',
          },
        },
      },
    );
    const idleClient = {
      connectionParameters: {
        password: 'secret',
      },
    };

    try {
      expect(() => pool.emit('error', idleClientError, idleClient)).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith(
        'PostgreSQL idle client error; the pool will replace the failed connection (code=57P01)',
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret');
    } finally {
      await pool.end();
      consoleError.mockRestore();
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it('requires runtime Redis and explicit owner configuration only when the seam is invoked', async () => {
    const client = new FakeMcpRuntimeRedisClient();
    const redisClientFactory = () => client as unknown as Redis;

    await expect(createMcpRuntimeLeaseServices({ redisClientFactory })).rejects.toThrow(
      'MCP runtime Redis requires MCP_RUNTIME_REDIS_URL or TERMINAL_REDIS_URL',
    );

    process.env.TERMINAL_REDIS_URL = 'redis://terminal:6379';
    await expect(createMcpRuntimeLeaseServices({ redisClientFactory })).rejects.toThrow(
      'MCP_RUNTIME_OWNER_ID is required to create MCP runtime lease services',
    );

    process.env.MCP_RUNTIME_OWNER_ID = 'worker-instance-7';
    await expect(createMcpRuntimeLeaseServices({ redisClientFactory })).rejects.toThrow(
      'MCP_RUNTIME_OWNER_URL is required to create MCP runtime lease services',
    );

    expect(client.connectCalls).toBe(0);
  });

  it('prefers the dedicated runtime Redis URL and creates one connected process identity', async () => {
    configureMcpRuntimeOwner();
    process.env.MCP_RUNTIME_REDIS_URL = 'rediss://runtime-redis:6380/2';
    process.env.TERMINAL_REDIS_URL = 'redis://terminal-redis:6379';
    process.env.MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS = '3456';
    const client = new FakeMcpRuntimeRedisClient();
    const factoryCalls: { redisUrl: string; commandTimeoutMs: number }[] = [];

    const services = await createMcpRuntimeLeaseServices({
      redisClientFactory: (redisUrl, commandTimeoutMs) => {
        factoryCalls.push({ redisUrl, commandTimeoutMs });
        return client as unknown as Redis;
      },
    });

    expect(factoryCalls).toEqual([
      { redisUrl: 'rediss://runtime-redis:6380/2', commandTimeoutMs: 3_456 },
    ]);
    expect(client.connectCalls).toBe(1);
    expect(client.pingCalls).toBe(1);
    expect(services.processIdentity.ownerId).toBe('worker-instance-7');
    expect(services.processIdentity.ownerAddress).toBe('https://worker-7.internal:9200');
    expect(services.processIdentity.ownerEpoch).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    await expect(services.leaseRepository.read(RUNTIME_KEY)).resolves.toBeNull();
    expect(client.lastGetKey?.startsWith('mcp:runtime:scope:')).toBe(true);
    expect(client.lastGetKey).toContain(':lease:{');

    await services.close();
  });

  it('falls back to terminal Redis with the bounded command-timeout default', async () => {
    configureMcpRuntimeOwner();
    process.env.TERMINAL_REDIS_URL = 'redis://terminal-redis:6379';
    const client = new FakeMcpRuntimeRedisClient();
    const factoryCalls: { redisUrl: string; commandTimeoutMs: number }[] = [];

    const services = await createMcpRuntimeLeaseServices({
      redisClientFactory: (redisUrl, commandTimeoutMs) => {
        factoryCalls.push({ redisUrl, commandTimeoutMs });
        return client as unknown as Redis;
      },
    });

    expect(factoryCalls).toEqual([
      { redisUrl: 'redis://terminal-redis:6379', commandTimeoutMs: 5_000 },
    ]);
    await services.close();
  });

  it('isolates lease keys across local instances while replicas share one scope', async () => {
    configureMcpRuntimeOwner();
    process.env.MCP_RUNTIME_REDIS_URL = 'redis://runtime-redis:6379';
    process.env.SENTRIS_DEPLOYMENT_ID = 'deployment-a';
    process.env.TEMPORAL_NAMESPACE = 'sentris-dev';
    process.env.TEMPORAL_TASK_QUEUE = 'sentris-default';

    const keyForInstance = async (instanceId: string): Promise<string> => {
      process.env.SENTRIS_INSTANCE = instanceId;
      const client = new FakeMcpRuntimeRedisClient();
      const services = await createMcpRuntimeLeaseServices({
        redisClientFactory: () => client as unknown as Redis,
      });
      await services.leaseRepository.read(RUNTIME_KEY);
      await services.close();
      if (!client.lastGetKey) throw new Error('Expected a scoped MCP runtime Redis key');
      return client.lastGetKey;
    };

    const instanceFive = await keyForInstance('5');
    const instanceFiveReplica = await keyForInstance('5');
    const instanceSix = await keyForInstance('6');

    expect(instanceFiveReplica).toBe(instanceFive);
    expect(instanceSix).not.toBe(instanceFive);
  });

  it('fails closed and disconnects when the dedicated client cannot connect or respond', async () => {
    configureMcpRuntimeOwner();
    process.env.MCP_RUNTIME_REDIS_URL = 'redis://runtime-redis:6379';
    const connectFailure = new FakeMcpRuntimeRedisClient('connect');

    await expect(
      createMcpRuntimeLeaseServices({
        redisClientFactory: () => connectFailure as unknown as Redis,
      }),
    ).rejects.toThrow('Redis connect failed');
    expect(connectFailure.disconnectCalls).toBe(1);
    expect(connectFailure.pingCalls).toBe(0);

    const pingFailure = new FakeMcpRuntimeRedisClient('ping');
    await expect(
      createMcpRuntimeLeaseServices({
        redisClientFactory: () => pingFailure as unknown as Redis,
      }),
    ).rejects.toThrow('Redis ping failed');
    expect(pingFailure.disconnectCalls).toBe(1);
    expect(pingFailure.pingCalls).toBe(1);
  });

  it('owns one idempotent close operation for the dedicated Redis client', async () => {
    configureMcpRuntimeOwner();
    process.env.MCP_RUNTIME_REDIS_URL = 'redis://runtime-redis:6379';
    const client = new FakeMcpRuntimeRedisClient();
    const services = await createMcpRuntimeLeaseServices({
      redisClientFactory: () => client as unknown as Redis,
    });

    const firstClose = services.close();
    const secondClose = services.close();

    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(client.quitCalls).toBe(1);
    expect(client.disconnectCalls).toBe(1);
  });
});
