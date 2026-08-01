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
import {
  ConfigurationError,
  resolveDockerResourceScope,
  type DockerResourceScope,
} from '@sentris/component-sdk';
import { resolveSentrisTrustProfile, type McpRuntimeAcquireRequest } from '@sentris/shared';
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
import { McpClientFactory } from '../../mcp-runtime/mcp-client-factory';
import {
  McpRuntimeDriverRegistry,
  type McpRuntimeDriver,
} from '../../mcp-runtime/mcp-runtime-driver';
import { BackendMcpRuntimeDefinitionResolver } from '../../mcp-runtime/mcp-runtime-definition.resolver';
import { McpRuntimeInternalClient } from '../../mcp-runtime/mcp-runtime-internal.client';
import {
  startMcpRuntimeInternalServer,
  type McpRuntimeInternalServerHandle,
} from '../../mcp-runtime/mcp-runtime-internal.server';
import { McpRuntimeManager } from '../../mcp-runtime/mcp-runtime-manager';
import {
  startMcpRuntimeReconciler,
  type McpRuntimeReconcilerHandle,
} from '../../mcp-runtime/mcp-runtime-reconciler';
import { McpRuntimeRouter } from '../../mcp-runtime/mcp-runtime-router';
import { DockerRuntimeDriver } from '../../mcp-runtime/drivers/docker-runtime.driver';
import { HostStdioRuntimeDriver } from '../../mcp-runtime/drivers/host-stdio-runtime.driver';
import { RemoteHttpRuntimeDriver } from '../../mcp-runtime/drivers/remote-http-runtime.driver';
import { resolveWorkerRuntimeTimeouts } from './runtime-timeouts';

// ── MCP runtime lease composition seam ────────────────────────────────

export type McpRuntimeRedisClientFactory = (redisUrl: string, commandTimeoutMs: number) => Redis;

export interface McpRuntimeLeaseServiceFactoryOptions {
  redisClientFactory?: McpRuntimeRedisClientFactory;
}

export interface McpRuntimeLeaseServices {
  leaseRepository: McpRuntimeLeaseRepository;
  processIdentity: McpRuntimeAcquireRequest['candidateOwner'];
  resourceScope: DockerResourceScope;
  checkReadiness: () => Promise<void>;
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
  const configuredRedisUrl = process.env.MCP_RUNTIME_REDIS_URL ?? process.env.TERMINAL_REDIS_URL;
  if (!configuredRedisUrl) {
    throw new ConfigurationError(
      'MCP runtime Redis requires MCP_RUNTIME_REDIS_URL or TERMINAL_REDIS_URL',
      { configKey: 'MCP_RUNTIME_REDIS_URL' },
    );
  }
  if (!process.env.MCP_RUNTIME_OWNER_ID) {
    throw new ConfigurationError(
      'MCP_RUNTIME_OWNER_ID is required to create MCP runtime lease services',
      { configKey: 'MCP_RUNTIME_OWNER_ID' },
    );
  }
  if (!process.env.MCP_RUNTIME_OWNER_URL) {
    throw new ConfigurationError(
      'MCP_RUNTIME_OWNER_URL is required to create MCP runtime lease services',
      { configKey: 'MCP_RUNTIME_OWNER_URL' },
    );
  }
  const config = mcpRuntimeEnvSchema.parse(process.env);
  const redisUrl = mcpRuntimeRedisUrlSchema.parse(configuredRedisUrl);
  const resourceScope = resolveDockerResourceScope();

  const processIdentity = createMcpRuntimeProcessIdentity({
    ownerId: config.MCP_RUNTIME_OWNER_ID!,
    ownerAddress: config.MCP_RUNTIME_OWNER_URL!,
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
      keyPrefix: createMcpRuntimeLeaseKeyPrefix(resourceScope),
      startingTtlMs: config.MCP_RUNTIME_STARTING_TTL_MS,
      readyTtlMs: config.MCP_RUNTIME_LEASE_TTL_MS,
    });
    let closePromise: Promise<void> | undefined;

    return {
      leaseRepository,
      processIdentity,
      resourceScope,
      checkReadiness: async () => {
        const response = await redis.ping();
        if (response !== 'PONG') {
          throw new Error('MCP runtime Redis ping returned an unexpected response');
        }
      },
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

export interface McpRuntimeServicesFactoryOptions {
  onHealthChange?: (message: string | undefined) => void;
}

export interface McpRuntimeServices {
  router: McpRuntimeRouter;
  checkReadiness(): Promise<void>;
  beginShutdown(): void;
  close(): Promise<void>;
}

/**
 * Builds the complete process-owned MCP runtime control plane. No runtime
 * connection or secret-bearing definition exists before this factory starts,
 * and every resource it creates is closed through the returned owner handle.
 */
export async function createMcpRuntimeServices(
  options: McpRuntimeServicesFactoryOptions = {},
): Promise<McpRuntimeServices> {
  const config = mcpRuntimeEnvSchema.parse(process.env);
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError('INTERNAL_SERVICE_TOKEN is required for MCP runtimes', {
      configKey: 'INTERNAL_SERVICE_TOKEN',
    });
  }

  const leaseServices = await createMcpRuntimeLeaseServices();
  const clientFactory = new McpClientFactory();
  const drivers: McpRuntimeDriver[] = [
    new RemoteHttpRuntimeDriver(clientFactory),
    new DockerRuntimeDriver(clientFactory, {
      maxInventory: config.MCP_RUNTIME_RECONCILE_MAX_RESOURCES,
      resourceScope: leaseServices.resourceScope,
    }),
  ];
  if (resolveSentrisTrustProfile(process.env) === 'trusted-local') {
    drivers.push(new HostStdioRuntimeDriver(clientFactory));
  }
  const driverRegistry = new McpRuntimeDriverRegistry(drivers);
  const manager = new McpRuntimeManager({
    processIdentity: leaseServices.processIdentity,
    repository: leaseServices.leaseRepository,
    definitionResolver: new BackendMcpRuntimeDefinitionResolver({
      internalToken,
      timeoutMs: config.MCP_RUNTIME_CONNECT_TIMEOUT_MS,
    }),
    drivers: driverRegistry,
    connectTimeoutMs: config.MCP_RUNTIME_CONNECT_TIMEOUT_MS,
    discoveryIdleTimeoutMs: config.MCP_RUNTIME_DISCOVERY_IDLE_TIMEOUT_MS,
    discoveryTotalTimeoutMs: config.MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS,
    startingObserveTimeoutMs: config.MCP_RUNTIME_STARTING_OBSERVE_TIMEOUT_MS,
    startingPollIntervalMs: config.MCP_RUNTIME_STARTING_POLL_INTERVAL_MS,
    renewalIntervalMs: config.MCP_RUNTIME_RENEWAL_INTERVAL_MS,
    holderIdleTimeoutMs: config.MCP_RUNTIME_LEASE_TTL_MS,
    drainTimeoutMs: config.MCP_RUNTIME_DRAIN_TIMEOUT_MS,
  });

  let reconciler: McpRuntimeReconcilerHandle | undefined;
  let internalServer: McpRuntimeInternalServerHandle | undefined;
  let reconciliationError: string | undefined;
  try {
    reconciler = await startMcpRuntimeReconciler({
      drivers: driverRegistry,
      leaseRepository: leaseServices.leaseRepository,
      maxResources: config.MCP_RUNTIME_RECONCILE_MAX_RESOURCES,
      intervalMs: config.MCP_RUNTIME_RECONCILE_INTERVAL_MS,
      onHealthChange: (message) => {
        reconciliationError = message;
        options.onHealthChange?.(message);
      },
    });
    internalServer = await startMcpRuntimeInternalServer({
      manager,
      token: internalToken,
      host: config.MCP_RUNTIME_LISTEN_HOST,
      port: config.MCP_RUNTIME_LISTEN_PORT,
      requestTimeoutMs: config.MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    manager.beginShutdown();
    await closeMcpRuntimeParts(manager, internalServer, reconciler, leaseServices.close).catch(
      () => undefined,
    );
    throw error;
  }

  const router = new McpRuntimeRouter(
    manager,
    new McpRuntimeInternalClient({
      token: internalToken,
      requestTimeoutMs: config.MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS,
    }),
  );
  let closeFlight: Promise<void> | undefined;
  return {
    router,
    checkReadiness: async () => {
      if (reconciliationError) throw new Error(reconciliationError);
      manager.checkReadiness();
      await Promise.all([leaseServices.checkReadiness(), internalServer!.checkReadiness()]);
    },
    beginShutdown: () => manager.beginShutdown(),
    close: () => {
      closeFlight ??= closeMcpRuntimeParts(
        manager,
        internalServer,
        reconciler,
        leaseServices.close,
      );
      return closeFlight;
    },
  };
}

export async function closeMcpRuntimeParts(
  manager: McpRuntimeManager,
  internalServer: McpRuntimeInternalServerHandle | undefined,
  reconciler: McpRuntimeReconcilerHandle | undefined,
  closeLeaseServices: () => Promise<void>,
): Promise<void> {
  manager.beginShutdown();
  const ownershipOutcomes = await Promise.allSettled([
    internalServer?.close(),
    manager.close(),
    reconciler?.close(),
  ]);
  const leaseOutcome = await settledOutcome(closeLeaseServices());
  const failures = [...ownershipOutcomes, leaseOutcome]
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to close MCP runtime services');
  }
}

async function settledOutcome<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise };
  } catch (reason: unknown) {
    return { status: 'rejected', reason };
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
