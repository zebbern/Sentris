import { randomBytes } from 'node:crypto';
import { connect, createServer, type Server, type Socket } from 'node:net';
import Redis from 'ioredis';

import { createMcpRuntimeRedisClient } from '../../mcp-runtime-redis';

export interface RedisConnectionLossFixture {
  readonly redis: Redis;
  makeUnavailable(): void;
  restore(): void;
  close(): Promise<void>;
}

export interface RedisIntegrationFixture {
  readonly keyPrefix: string;
  readonly redis: Redis;
  cleanup(): Promise<void>;
  close(): Promise<void>;
  listKeys(): Promise<string[]>;
  createUnavailableClient(): Promise<Redis>;
  createConnectionLossClient(commandTimeoutMs?: number): Promise<RedisConnectionLossFixture>;
}

export async function createRedisIntegrationFixture(): Promise<RedisIntegrationFixture> {
  const redisUrl = process.env.MCP_RUNTIME_TEST_REDIS_URL;
  if (!redisUrl) {
    throw new Error('MCP_RUNTIME_TEST_REDIS_URL is required for MCP runtime Redis tests');
  }

  const keyPrefix = `sentris:test:mcp-runtime:${randomBytes(18).toString('hex')}`;
  const redis = createClient(redisUrl);
  try {
    await redis.connect();
    await redis.ping();
    const serverInfo = await redis.info('server');
    const version = /^redis_version:([^\r\n]+)$/m.exec(serverInfo)?.[1];
    if (!version?.startsWith('7.4.')) {
      throw new Error(
        `Expected Redis 7.4.x for MCP runtime integration tests, received ${version ?? 'unknown'}`,
      );
    }
  } catch (error: unknown) {
    redis.disconnect();
    throw new Error('Configured MCP runtime Redis integration fixture is unavailable', {
      cause: error,
    });
  }

  let closed = false;
  const listKeys = () => listExactPrefixKeys(redis, keyPrefix);
  const cleanup = async () => {
    const keys = await listKeys();
    for (let offset = 0; offset < keys.length; offset += 100) {
      await redis.del(...keys.slice(offset, offset + 100));
    }
  };

  return {
    keyPrefix,
    redis,
    cleanup,
    listKeys,
    async createUnavailableClient() {
      const unavailable = createClient(redisUrl, false);
      await unavailable.connect();
      await unavailable.ping();
      unavailable.disconnect(false);
      return unavailable;
    },
    async createConnectionLossClient(commandTimeoutMs = 250) {
      const proxy = await createTcpAvailabilityProxy(redisUrl);
      const reconnectingRedis = createMcpRuntimeRedisClient(proxy.redisUrl, commandTimeoutMs);
      reconnectingRedis.on('error', () => undefined);
      try {
        await reconnectingRedis.connect();
        await reconnectingRedis.ping();
      } catch (error: unknown) {
        reconnectingRedis.disconnect();
        await proxy.close();
        throw error;
      }

      let connectionClosed = false;
      return {
        redis: reconnectingRedis,
        makeUnavailable: proxy.makeUnavailable,
        restore: proxy.restore,
        async close() {
          if (connectionClosed) return;
          connectionClosed = true;
          reconnectingRedis.disconnect();
          await proxy.close();
        },
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await cleanup();
        await redis.quit();
      } catch (error: unknown) {
        redis.disconnect();
        throw error;
      }
    },
  };
}

interface TcpAvailabilityProxy {
  readonly redisUrl: string;
  makeUnavailable(): void;
  restore(): void;
  close(): Promise<void>;
}

async function createTcpAvailabilityProxy(redisUrl: string): Promise<TcpAvailabilityProxy> {
  const upstreamUrl = new URL(redisUrl);
  const upstreamPort = Number(
    upstreamUrl.port || (upstreamUrl.protocol === 'rediss:' ? 6380 : 6379),
  );
  const activeSockets = new Set<Socket>();
  let available = true;

  const server = createServer((downstream) => {
    if (!available) {
      downstream.destroy();
      return;
    }

    const upstream = connect({ host: upstreamUrl.hostname, port: upstreamPort });
    activeSockets.add(downstream);
    activeSockets.add(upstream);

    const closePair = () => {
      activeSockets.delete(downstream);
      activeSockets.delete(upstream);
      downstream.destroy();
      upstream.destroy();
    };
    downstream.on('error', closePair);
    downstream.on('close', closePair);
    upstream.on('error', closePair);
    upstream.on('close', closePair);
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  });
  await listenOnLoopback(server);

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Redis integration proxy did not bind a TCP address');
  }
  const proxyUrl = new URL(redisUrl);
  proxyUrl.hostname = '127.0.0.1';
  proxyUrl.port = String(address.port);

  let closed = false;
  return {
    redisUrl: proxyUrl.toString(),
    makeUnavailable() {
      available = false;
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
    },
    restore() {
      available = true;
    },
    async close() {
      if (closed) return;
      closed = true;
      available = false;
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function listenOnLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function createClient(redisUrl: string, enableOfflineQueue = true): Redis {
  const redis = new Redis(redisUrl, {
    enableOfflineQueue,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  return redis;
}

async function listExactPrefixKeys(redis: Redis, keyPrefix: string): Promise<string[]> {
  const keys = new Set<string>();
  let cursor = '0';
  do {
    const [nextCursor, page] = await redis.scan(cursor, 'MATCH', `${keyPrefix}:*`, 'COUNT', 200);
    cursor = nextCursor;
    for (const key of page) {
      if (!key.startsWith(`${keyPrefix}:`)) {
        throw new Error(`Redis fixture refused to inspect an out-of-prefix key: ${key}`);
      }
      keys.add(key);
    }
  } while (cursor !== '0');

  if ((await redis.exists(keyPrefix)) === 1) keys.add(keyPrefix);
  return [...keys].sort();
}
