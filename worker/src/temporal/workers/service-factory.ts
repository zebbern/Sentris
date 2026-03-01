/**
 * Factory functions for creating worker infrastructure services.
 *
 * Each factory reads its configuration from `process.env` and returns
 * the fully-initialised service instance.  Keeping these out of the
 * main worker file keeps `main()` a short orchestration sequence.
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'minio';
import { ConfigurationError } from '@sentris/component-sdk';
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
  const pool = new Pool({ connectionString });
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
  const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
  const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
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
}

export function createKafkaAdapters(storage: FileStorageAdapter): KafkaAdapters {
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

  const trace = new KafkaTraceAdapter({
    brokers: kafkaBrokers,
    topic: topicResolver.getEventsTopic(),
    clientId: process.env.EVENT_KAFKA_CLIENT_ID ?? 'sentris-worker-events',
  });

  const agentTrace = new KafkaAgentTracePublisher({
    brokers: kafkaBrokers,
    topic: topicResolver.getAgentTraceTopic(),
    clientId: process.env.AGENT_TRACE_KAFKA_CLIENT_ID ?? 'sentris-worker-agent-trace',
  });

  const nodeIO = new KafkaNodeIOAdapter(
    {
      brokers: kafkaBrokers,
      topic: topicResolver.getNodeIOTopic(),
      clientId: process.env.NODE_IO_KAFKA_CLIENT_ID ?? 'sentris-worker-node-io',
    },
    storage,
  );

  let logs: KafkaLogAdapter;
  try {
    logs = new KafkaLogAdapter({
      brokers: kafkaBrokers,
      topic: topicResolver.getLogsTopic(),
      clientId: process.env.LOG_KAFKA_CLIENT_ID ?? 'sentris-worker',
    });
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
      terminalRedis = new Redis(terminalRedisUrl);
      const maxEntries = Number(process.env.TERMINAL_REDIS_MAXLEN ?? '5000');
      terminalStream = new RedisTerminalStreamAdapter(terminalRedis, { maxEntries });
      console.log(`✅ Terminal Redis streaming enabled (${terminalRedisUrl})`);
    } catch (error: unknown) {
      console.error('⚠️ Failed to initialize terminal Redis streaming', error);
    }
  } else {
    console.warn('⚠️ TERMINAL_REDIS_URL not set; terminal streaming disabled');
  }

  return { trace, agentTrace, nodeIO, logs, terminalStream, terminalRedis };
}
