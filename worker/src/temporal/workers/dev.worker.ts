import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
import { Worker, NativeConnection } from '@temporalio/worker';
import { status as grpcStatus } from '@grpc/grpc-js';
import Long from 'long';
import { isGrpcServiceError } from '@temporalio/client';
import { config } from 'dotenv';
import {
  runComponentActivity,
  setRunMetadataActivity,
  finalizeRunActivity,
  initializeComponentActivityServices,
} from '../activities/run-component.activity';
import {
  createHumanInputRequestActivity,
  cancelHumanInputRequestActivity,
  initializeHumanInputActivity,
  expireHumanInputRequestActivity,
} from '../activities/human-input.activity';
import { prepareRunPayloadActivity } from '../activities/run-dispatcher.activity';
import { recordTraceEventActivity, initializeTraceActivity } from '../activities/trace.activity';
import {
  registerComponentToolActivity,
  registerLocalMcpActivity,
  registerRemoteMcpActivity,
  cleanupRunResourcesActivity,
  prepareAndRegisterToolActivity,
  areAllToolsReadyActivity,
} from '../activities/mcp.activity';
import {
  discoverMcpToolsActivity,
  discoverMcpGroupToolsActivity,
  cacheDiscoveryResultActivity,
} from '../activities/mcp-discovery.activity';
import { executeWebhookParsingScriptActivity } from '../activities/webhook-parsing.activity';
import { logHeartbeat } from '../../utils/debug-logger';
import { validateWorkerEnv } from '../../config/env.validate';
import { startHealthServer, type HealthServerHandle } from '../../health/health-server';
import {
  createDatabasePool,
  createMinioClient,
  createServiceAdapters,
  createKafkaAdapters,
} from './service-factory';
import { createBundlerOptions } from './worker-config';

// Load environment variables from instance-specific env if set, otherwise fall back
// to the worker's default `.env`.
const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const instanceNum = process.env.SENTRIS_INSTANCE;
const instanceEnvPath = instanceNum
  ? join(workerRoot, '..', '.instances', `instance-${instanceNum}`, 'worker.env')
  : undefined;

config({ path: instanceEnvPath ?? join(workerRoot, '.env') });
validateWorkerEnv(process.env);

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'sentris-default';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'sentris-dev';
  const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), '../workflows');

  console.log(`🔌 Connecting to Temporal at ${address}...`);
  console.log(`📋 Worker Configuration:`);
  console.log(`   - Address: ${address}`);
  console.log(`   - Namespace: ${namespace}`);
  console.log(`   - Task Queue: ${taskQueue}`);
  console.log(`   - Workflows Path: ${workflowsPath}`);
  console.log(`   - Node ENV: ${process.env.NODE_ENV}`);

  // Create connection first
  console.log(`🔗 Establishing connection to Temporal...`);
  const connection = await NativeConnection.connect({ address });
  console.log(`✅ Connected to Temporal at ${address}`);
  await ensureTemporalNamespace(connection, namespace);

  // Initialize infrastructure services
  const { pool, db } = createDatabasePool();
  const minio = createMinioClient();
  const adapters = createServiceAdapters(minio, db);
  const kafka = createKafkaAdapters(adapters.storage);

  // Initialize global services for activities
  initializeComponentActivityServices({
    storage: adapters.storage,
    trace: kafka.trace,
    nodeIO: kafka.nodeIO,
    logs: kafka.logs,
    secrets: adapters.secrets,
    artifacts: adapters.artifacts.factory(),
    terminalStream: kafka.terminalStream,
    agentTracePublisher: kafka.agentTrace,
  });

  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3211';
  initializeHumanInputActivity({ database: db, trace: kafka.trace, baseUrl: backendUrl });
  initializeTraceActivity({ trace: kafka.trace });
  console.log(`✅ Service adapters initialized`);

  // Start the HTTP health server
  const healthServer: HealthServerHandle = await startHealthServer({
    temporalConnection: connection,
    terminalRedis: kafka.terminalRedis,
  });

  // Create worker
  const activities = {
    runComponentActivity,
    setRunMetadataActivity,
    finalizeRunActivity,
    prepareRunPayloadActivity,
    createHumanInputRequestActivity,
    cancelHumanInputRequestActivity,
    expireHumanInputRequestActivity,
    recordTraceEventActivity,
    registerComponentToolActivity,
    registerLocalMcpActivity,
    registerRemoteMcpActivity,
    cleanupRunResourcesActivity,
    prepareAndRegisterToolActivity,
    areAllToolsReadyActivity,
    discoverMcpToolsActivity,
    discoverMcpGroupToolsActivity,
    cacheDiscoveryResultActivity,
    executeWebhookParsingScriptActivity,
  };

  console.log(`🏗️ Creating Temporal worker...`);
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities,
    bundlerOptions: createBundlerOptions(),
    maxConcurrentWorkflowTaskExecutions: 10,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentLocalActivityExecutions: 10,
    stickyQueueScheduleToStartTimeout: '10m',
  });

  console.log(
    `🚛 Temporal worker ready (namespace=${namespace}, taskQueue=${taskQueue}, workflowsPath=${workflowsPath})`,
  );

  // Set up periodic heartbeat logging (file-based only)
  const heartbeatInterval = setInterval(() => {
    logHeartbeat(taskQueue);
  }, 15000);

  // Register graceful shutdown handlers
  // PM2 sends SIGINT on restart; container orchestrators send SIGTERM.
  const handleShutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    worker.shutdown();
  };
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  console.log(`🚀 Starting worker.run() - this will block and listen for tasks...`);
  try {
    await worker.run();
  } finally {
    console.log('🧹 Cleaning up resources...');
    clearInterval(heartbeatInterval);
    await pool.end().catch((e: unknown) => console.error('Failed to close DB pool', e));
    await connection
      .close()
      .catch((e: unknown) => console.error('Failed to close Temporal connection', e));
    if (kafka.terminalRedis) {
      await kafka.terminalRedis
        .quit()
        .catch((e: unknown) => console.error('Failed to close terminal Redis', e));
    }
    await healthServer
      .close()
      .catch((e: unknown) => console.error('Failed to close health server', e));
    console.log('✅ Worker shutdown complete');
  }
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('💥 Temporal worker failed to start:', {
    error: err.message,
    stack: err.stack,
    code: 'code' in err ? (err as { code: unknown }).code : undefined,
    details: 'details' in err ? (err as { details: unknown }).details : undefined,
  });
  process.exit(1);
});

async function ensureTemporalNamespace(connection: NativeConnection, namespace: string) {
  try {
    await connection.workflowService.describeNamespace({ namespace });
    console.log(`✅ Temporal namespace "${namespace}" is ready`);
    return;
  } catch (error: unknown) {
    if (!(isGrpcServiceError(error) && error.code === grpcStatus.NOT_FOUND)) {
      throw error;
    }
  }

  console.warn(`⚠️ Temporal namespace "${namespace}" not found; attempting to create it`);

  try {
    const defaultRetentionDays = 7;
    await connection.workflowService.registerNamespace({
      namespace,
      workflowExecutionRetentionPeriod: {
        seconds: Long.fromNumber(defaultRetentionDays * 24 * 60 * 60),
        nanos: 0,
      },
    });
    console.log(`✅ Temporal namespace "${namespace}" created`);
  } catch (error: unknown) {
    if (isGrpcServiceError(error) && error.code === grpcStatus.ALREADY_EXISTS) {
      console.log(`✅ Temporal namespace "${namespace}" already exists`);
      return;
    }
    throw error;
  }
}
