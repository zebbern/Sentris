/**
 * Factory functions for creating worker infrastructure services.
 *
 * Each factory reads its configuration from `process.env` and returns
 * the fully-initialised service instance.  Keeping these out of the
 * main worker file keeps `main()` a short orchestration sequence.
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { Kafka, logLevel as KafkaLogLevel } from 'kafkajs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'minio';
import { ConfigurationError, resolveDockerResourceScope } from '@sentris/component-sdk';
import type { McpRuntimeAcquireRequest } from '@sentris/shared';
import { getTopicResolver } from '../../common/kafka-topic-resolver';
import * as schema from '../../adapters/schema';
import {
  ArtifactAdapter,
  FileStorageAdapter,
  SecretsAdapter,
  RedisTerminalStreamAdapter,
  KafkaLogAdapter,
  KafkaTraceAdapter,
  KafkaAgentTracePublisher,
  KafkaNodeIOAdapter,
} from '../../adapters';
import { createKafkaReadiness } from '../../health/kafka-readiness';
import type { KafkaReadiness } from '../../health/readiness-checks';
import { PostgresDurableKafkaFallback } from '../../common/durable-kafka-fallback';
import { mcpRuntimeEnvSchema, mcpRuntimeRedisUrlSchema } from '../../config/env.schema';
import {
  createMcpRuntimeLeaseKeyPrefix,
  createMcpRuntimeProcessIdentity,
} from '../../mcp-runtime/mcp-runtime-identity';
import { McpRuntimeLeaseRepository } from '../../mcp-runtime/mcp-runtime-lease.repository';
import { createMcpRuntimeRedisClient } from '../../mcp-runtime/mcp-runtime-redis';
import { resolveWorkerRuntimeTimeouts } from './runtime-timeouts';

// ── MCP runtime lease composition seam ────────────────────────────────

export type McpRuntimeRedisClientFactory = (redisUrl: string, commandTimeoutMs: number) => Redis;

export interface McpRuntimeLeaseServiceFactoryOptions {
  redisClientFactory?: McpRuntimeRedisClientFactory;
}

export interface McpRuntimeLeaseServices {
  leaseRepository: McpRuntimeLeaseRepository;
  processIdentity: McpRuntimeAcquireRequest['candidateOwner'];
  close: () => Promise<void>;
}

/**
 * Task 3 -> Task 4 migration seam. Task 4 must call this once during worker
 * boot and close the returned ownership handle during shutdown. It remains
 * deliberately uninstantiated here so importing this module cannot create a
 * module-global Redis connection.
 */
export async function createMcpRuntimeLeaseServices(
  options: McpRuntimeLeaseServiceFactoryOptions = {},
): Promise<McpRuntimeLeaseServices> {
  const config = mcpRuntimeEnvSchema.parse(process.env);
  const configuredRedisUrl = config.MCP_RUNTIME_REDIS_URL ?? process.env.TERMINAL_REDIS_URL;
  if (!configuredRedisUrl) {
    throw new ConfigurationError(
      'MCP runtime Redis requires MCP_RUNTIME_REDIS_URL or TERMINAL_REDIS_URL',
      { configKey: 'MCP_RUNTIME_REDIS_URL' },
    );
  }
  const redisUrl = mcpRuntimeRedisUrlSchema.parse(configuredRedisUrl);
  if (!config.MCP_RUNTIME_OWNER_ID) {
    throw new ConfigurationError(
      'MCP_RUNTIME_OWNER_ID is required to create MCP runtime lease services',
      { configKey: 'MCP_RUNTIME_OWNER_ID' },
    );
  }
  if (!config.MCP_RUNTIME_OWNER_URL) {
    throw new ConfigurationError(
      'MCP_RUNTIME_OWNER_URL is required to create MCP runtime lease services',
      { configKey: 'MCP_RUNTIME_OWNER_URL' },
    );
  }

  const processIdentity = createMcpRuntimeProcessIdentity({
    ownerId: config.MCP_RUNTIME_OWNER_ID,
    ownerAddress: config.MCP_RUNTIME_OWNER_URL,
  });
  const redisClientFactory = options.redisClientFactory ?? createMcpRuntimeRedisClient;
  const redis = redisClientFactory(redisUrl, config.MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS);

  try {
    await redis.connect();
    const pingResponse = await redis.ping();
    if (pingResponse !== 'PONG') {
      throw new Error('MCP runtime Redis ping returned an unexpected response');
    }

    const leaseRepository = new McpRuntimeLeaseRepository(redis, {
      keyPrefix: createMcpRuntimeLeaseKeyPrefix(resolveDockerResourceScope()),
      startingTtlMs: config.MCP_RUNTIME_STARTING_TTL_MS,
      readyTtlMs: config.MCP_RUNTIME_LEASE_TTL_MS,
    });
    let closePromise: Promise<void> | undefined;

    return {
      leaseRepository,
      processIdentity,
      close: () => {
        closePromise ??= (async () => {
          try {
            await redis.quit();
          } finally {
            redis.disconnect(false);
          }
        })();
        return closePromise;
      },
    };
  } catch (error: unknown) {
    redis.disconnect(false);
    throw error;
  }
}

// ── Database ────────────────────────────────────────────────────────────

export interface DatabaseServices {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

export function createDatabasePool(): DatabaseServices {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ConfigurationError('DATABASE_URL is not set', {
      configKey: 'DATABASE_URL',
    });
  }
  const timeouts = resolveWorkerRuntimeTimeouts();
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: timeouts.databaseConnectionTimeoutMs,
    query_timeout: timeouts.databaseQueryTimeoutMs,
    statement_timeout: timeouts.databaseQueryTimeoutMs,
  });
  pool.on('error', (error) => {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    console.error(
      `PostgreSQL idle client error; the pool will replace the failed connection${
        code ? ` (code=${code})` : ''
      }`,
    );
  });
  const db = drizzle(pool, { schema });
  console.log(`✅ Connected to database`);
  return { pool, db };
}

// ── MinIO ───────────────────────────────────────────────────────────────

export interface MinioServices {
  client: Client;
  bucketName: string;
}

export function createMinioClient(): MinioServices {
  const endPoint = process.env.MINIO_ENDPOINT ?? 'localhost';
  const port = parseInt(process.env.MINIO_PORT ?? '9000', 10);
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY environment variables are required');
  }
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  const bucketName = process.env.MINIO_BUCKET_NAME ?? 'sentris-files';

  const client = new Client({ endPoint, port, useSSL, accessKey, secretKey });
  console.log(`✅ Connected to MinIO at ${endPoint}:${port}`);
  return { client, bucketName };
}

// ── Service adapters ────────────────────────────────────────────────────

export interface ServiceAdapters {
  storage: FileStorageAdapter;
  artifacts: ArtifactAdapter;
  secrets: SecretsAdapter;
}

export function createServiceAdapters(
  minio: MinioServices,
  db: DatabaseServices['db'],
): ServiceAdapters {
  const storage = new FileStorageAdapter(minio.client, db, minio.bucketName);
  const artifacts = new ArtifactAdapter(minio.client, db, minio.bucketName);
  const secrets = new SecretsAdapter(db);
  return { storage, artifacts, secrets };
}

// ── Kafka + terminal Redis ──────────────────────────────────────────────

export interface KafkaAdapters {
  trace: KafkaTraceAdapter;
  agentTrace: KafkaAgentTracePublisher;
  nodeIO: KafkaNodeIOAdapter;
  logs: KafkaLogAdapter;
  terminalStream?: RedisTerminalStreamAdapter;
  terminalRedis?: Redis;
  readiness: Required<KafkaReadiness>;
}

export function createKafkaAdapters(
  storage: FileStorageAdapter,
  databasePool: Pool,
  onFallbackFailure?: (message: string) => void,
): KafkaAdapters {
  const kafkaBrokerEnv = process.env.LOG_KAFKA_BROKERS;
  const kafkaBrokers = kafkaBrokerEnv
    ? kafkaBrokerEnv
        .split(',')
        .map((broker) => broker.trim())
        .filter(Boolean)
    : [];

  if (kafkaBrokers.length === 0) {
    throw new ConfigurationError('LOG_KAFKA_BROKERS must be configured for workflow logging', {
      configKey: 'LOG_KAFKA_BROKERS',
    });
  }

  const topicResolver = getTopicResolver();
  const instanceMsg = topicResolver.isInstanceIsolated()
    ? ` (instance ${topicResolver.getInstanceId()})`
    : '';
  const readiness = createKafkaReadiness(
    new Kafka({
      clientId: `${
        process.env.LOG_KAFKA_CLIENT_ID ?? topicResolver.resolveClientId('sentris-worker')
      }-readiness`,
      brokers: kafkaBrokers,
      logLevel: KafkaLogLevel.NOTHING,
    }).admin(),
  );
  const durableFallback = new PostgresDurableKafkaFallback(databasePool, onFallbackFailure);

  const trace = new KafkaTraceAdapter(
    {
      brokers: kafkaBrokers,
      topic: topicResolver.getEventsTopic(),
      clientId:
        process.env.EVENT_KAFKA_CLIENT_ID ?? topicResolver.resolveClientId('sentris-worker-events'),
    },
    console,
    durableFallback,
  );

  const agentTrace = new KafkaAgentTracePublisher(
    {
      brokers: kafkaBrokers,
      topic: topicResolver.getAgentTraceTopic(),
      clientId:
        process.env.AGENT_TRACE_KAFKA_CLIENT_ID ??
        topicResolver.resolveClientId('sentris-worker-agent-trace'),
    },
    console,
    durableFallback,
  );

  const nodeIO = new KafkaNodeIOAdapter(
    {
      brokers: kafkaBrokers,
      topic: topicResolver.getNodeIOTopic(),
      clientId:
        process.env.NODE_IO_KAFKA_CLIENT_ID ??
        topicResolver.resolveClientId('sentris-worker-node-io'),
    },
    storage,
    console,
    durableFallback,
  );

  let logs: KafkaLogAdapter;
  try {
    logs = new KafkaLogAdapter(
      {
        brokers: kafkaBrokers,
        topic: topicResolver.getLogsTopic(),
        clientId:
          process.env.LOG_KAFKA_CLIENT_ID ?? topicResolver.resolveClientId('sentris-worker'),
      },
      durableFallback,
    );
    console.log(`✅ Kafka logging enabled (${kafkaBrokers.join(', ')})${instanceMsg}`);
  } catch (error: unknown) {
    console.error('❌ Failed to initialize Kafka logging', error);
    throw error;
  }

  // Terminal Redis streaming (optional)
  let terminalStream: RedisTerminalStreamAdapter | undefined;
  let terminalRedis: Redis | undefined;
  const terminalRedisUrl = process.env.TERMINAL_REDIS_URL;
  if (terminalRedisUrl) {
    try {
      const timeouts = resolveWorkerRuntimeTimeouts();
      terminalRedis = new Redis(terminalRedisUrl, {
        commandTimeout: timeouts.terminalRedisCommandTimeoutMs,
      });
      const maxEntries = Number(process.env.TERMINAL_REDIS_MAXLEN ?? '5000');
      terminalStream = new RedisTerminalStreamAdapter(terminalRedis, { maxEntries });
      console.log(`✅ Terminal Redis streaming enabled (${terminalRedisUrl})`);
    } catch (error: unknown) {
      console.error('⚠️ Failed to initialize terminal Redis streaming', error);
    }
  } else {
    console.warn('⚠️ TERMINAL_REDIS_URL not set; terminal streaming disabled');
  }

  return { trace, agentTrace, nodeIO, logs, terminalStream, terminalRedis, readiness };
}
