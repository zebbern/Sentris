import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomBytes, webcrypto } from 'node:crypto';
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
import {
  markRunStartedActivity,
  prepareRunPayloadActivity,
} from '../activities/run-dispatcher.activity';
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
  discoverSavedMcpRuntimeActivity,
  previewSavedMcpRuntimeActivity,
  cacheDiscoveryResultActivity,
  initializeMcpRuntimeDiscoveryActivities,
} from '../activities/mcp-discovery.activity';
import { executeWebhookParsingScriptActivity } from '../activities/webhook-parsing.activity';
import {
  dispatchToolInvocationActivity,
  dispatchMcpOperationActivity,
  initializeMcpInvocationActivities,
  prepareMcpOperationActivity,
  prepareToolInvocationActivity,
  reconcileMcpOperationActivity,
  reconcileRunToolInvocationsActivity,
  reconcileToolInvocationActivity,
} from '../activities/mcp-invocation.activity';
import { logHeartbeat } from '../../utils/debug-logger';
import { validateWorkerEnv } from '../../config/env.validate';
import {
  createCachedReadinessEvaluator,
  startHealthServer,
  type HealthServerHandle,
} from '../../health/health-server';
import {
  createWorkerReadinessChecks,
  type WorkerReadinessState,
} from '../../health/readiness-checks';
import { resolveBackendApiBaseUrl } from '../../common/backend-url';
import {
  createDockerOrphanResourceClient,
  createTemporalRunActivityResolver,
  reconcileOrphanedRunResources,
  startOrphanReconciler,
  type OrphanReconcilerHandle,
  type ReconciliationReport,
} from '../../utils/orphan-reconciler';
import {
  createDatabasePool,
  createMinioClient,
  createServiceAdapters,
  createKafkaAdapters,
  createMcpRuntimeServices,
} from './service-factory';
import { createBundlerOptions } from './worker-config';
import { resolveSentrisTrustProfile } from '@sentris/shared';
import { notifyBackendRunFinalized } from '../../common/run-finalizer';
import {
  initializeMcpDockerProxy,
  startMcpDockerProxy,
} from '../../components/core/mcp-docker-proxy';
import { drainAllRequiredPublications } from '../utils/required-publication-tracker';
import {
  initializeOperatorActivities,
  operatorAwaitRunActivity,
  operatorCancelTurnActivity,
  operatorCompleteTurnActivity,
  operatorCreateRunFollowUpActivity,
  operatorExecuteActionActivity,
  operatorFailTurnActivity,
  operatorLoadPlanActivity,
  operatorModelStepActivity,
  operatorObserveRunActivity,
  operatorPrepareActionActivity,
  operatorSettleMcpActionActivity,
  operatorSetTurnStatusActivity,
} from '../activities/operator.activity';
import {
  workflowAgentCheckpointActivity,
  workflowAgentDispatchToolActivity,
  workflowAgentFailActivity,
  workflowAgentFinalizeActivity,
  workflowAgentModelStepActivity,
  workflowAgentPrepareToolActivity,
  workflowAgentReconcileToolActivity,
  workflowAgentSetupActivity,
} from '../activities/workflow-agent.activity';

// Load environment variables from instance-specific env if set, otherwise fall back
// to the worker's default `.env`.
const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const instanceNum = process.env.SENTRIS_INSTANCE;
const instanceEnvPath = instanceNum
  ? join(workerRoot, '..', '.instances', `instance-${instanceNum}`, 'worker.env')
  : undefined;

config({ path: instanceEnvPath ?? join(workerRoot, '.env') });
const workerConfig = validateWorkerEnv(process.env);

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
  const workerState: WorkerReadinessState = { acceptingTasks: false };
  const cleanupSteps: { name: string; close: () => void | Promise<void> }[] = [];

  try {
    console.log(`🔌 Connecting to Temporal at ${address}...`);
    console.log(`📋 Worker Configuration:`);
    console.log(`   - Address: ${address}`);
    console.log(`   - Namespace: ${namespace}`);
    console.log(`   - Task Queue: ${taskQueue}`);
    console.log(`   - Workflows Path: ${workflowsPath}`);
    console.log(`   - Node ENV: ${process.env.NODE_ENV}`);
    console.log(`   - Trust Profile: ${resolveSentrisTrustProfile(process.env)}`);

    // Create connection first
    console.log(`🔗 Establishing connection to Temporal...`);
    const connection = await NativeConnection.connect({ address });
    cleanupSteps.push({ name: 'Temporal connection', close: () => connection.close() });
    console.log(`✅ Connected to Temporal at ${address}`);
    await ensureTemporalNamespace(connection, namespace);

    // Initialize infrastructure services
    const { pool, db } = createDatabasePool();
    cleanupSteps.push({ name: 'database pool', close: () => pool.end() });
    const minio = createMinioClient();
    const adapters = createServiceAdapters(minio, db);
    const onRequiredTelemetryFailure = (message: string) => {
      workerState.telemetryError = message;
      console.error(`❌ Required telemetry durability failed: ${message}`);
    };
    const kafka = createKafkaAdapters(adapters.storage, pool, onRequiredTelemetryFailure);
    cleanupSteps.push({
      name: 'Kafka and terminal clients',
      close: async () => {
        const producerShutdowns = await Promise.allSettled([
          kafka.trace.close(),
          kafka.agentTrace.close(),
          kafka.nodeIO.close(),
          kafka.logs.close(),
        ]);
        for (const [index, result] of producerShutdowns.entries()) {
          if (result.status === 'rejected') {
            const producer = ['trace', 'agent-trace', 'node-io', 'log'][index] ?? 'unknown';
            console.error(`Failed to close Kafka ${producer} producer`, result.reason);
          }
        }
        if (kafka.terminalRedis) await kafka.terminalRedis.quit();
        await kafka.readiness.close();
      },
    });
    cleanupSteps.push({ name: 'required publications', close: drainAllRequiredPublications });

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
      runFinalizer: notifyBackendRunFinalized,
      onRequiredTelemetryFailure,
    });
    initializeOperatorActivities({ secrets: adapters.secrets });

    initializeHumanInputActivity({
      database: db,
      trace: kafka.trace,
      publicBaseUrl: workerConfig.SENTRIS_PUBLIC_API_BASE_URL,
    });
    initializeTraceActivity({ trace: kafka.trace });
    console.log(`✅ Service adapters initialized`);

    const orphanResourceClient = createDockerOrphanResourceClient({
      exchangeRoot: workerConfig.SENTRIS_DOCKER_SHARED_IO_ROOT,
      commandTimeoutMs: workerConfig.WORKER_ORPHAN_DOCKER_TIMEOUT_MS,
      maxInventoryResources: workerConfig.WORKER_ORPHAN_MAX_INVENTORY,
    });
    const isRunActive = createTemporalRunActivityResolver(connection, namespace);
    const reconcileOrphans = async (): Promise<ReconciliationReport> => {
      const report = await reconcileOrphanedRunResources({
        client: orphanResourceClient,
        isRunActive,
        minAgeMs: workerConfig.WORKER_ORPHAN_MIN_AGE_MS,
        maxResources: workerConfig.WORKER_ORPHAN_MAX_RESOURCES,
        runStateTimeoutMs: workerConfig.WORKER_ORPHAN_RUN_STATE_TIMEOUT_MS,
      });
      const removed =
        report.removed.containers + report.removed.volumes + report.removed.exchangeDirectories;
      console.log(
        `🧹 Orphan reconciliation examined=${report.examined} removed=${removed} ` +
          `active=${report.preservedActive} young=${report.preservedYoung} ` +
          `remaining=${report.remainingEligible}`,
      );
      return report;
    };
    const orphanReconciler: OrphanReconcilerHandle = await startOrphanReconciler({
      reconcile: reconcileOrphans,
      intervalMs: workerConfig.WORKER_ORPHAN_INTERVAL_MS,
      onHealthChange: (message) => {
        workerState.maintenanceError = message;
        if (message) {
          console.error(`❌ Periodic orphan reconciliation failed: ${message}`);
        }
      },
    });
    cleanupSteps.push({ name: 'orphan reconciler', close: () => orphanReconciler.close() });

    const mcpRuntime = await createMcpRuntimeServices({
      onHealthChange: (message) => {
        workerState.mcpRuntimeError = message;
        if (message) console.error(`❌ MCP runtime reconciliation failed: ${message}`);
      },
    });
    cleanupSteps.push({ name: 'MCP runtime services', close: () => mcpRuntime.close() });
    initializeMcpRuntimeDiscoveryActivities(mcpRuntime.router);
    initializeMcpInvocationActivities(mcpRuntime.router);
    console.log(
      `✅ MCP runtime owner ready (${workerConfig.MCP_RUNTIME_OWNER_ID} at ${workerConfig.MCP_RUNTIME_OWNER_URL})`,
    );

    // Create worker
    const activities = {
      runComponentActivity,
      setRunMetadataActivity,
      finalizeRunActivity,
      prepareRunPayloadActivity,
      markRunStartedActivity,
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
      discoverSavedMcpRuntimeActivity,
      previewSavedMcpRuntimeActivity,
      cacheDiscoveryResultActivity,
      executeWebhookParsingScriptActivity,
      prepareToolInvocationActivity,
      dispatchToolInvocationActivity,
      reconcileToolInvocationActivity,
      prepareMcpOperationActivity,
      dispatchMcpOperationActivity,
      reconcileMcpOperationActivity,
      reconcileRunToolInvocationsActivity,
      operatorSetTurnStatusActivity,
      operatorLoadPlanActivity,
      operatorCancelTurnActivity,
      operatorAwaitRunActivity,
      operatorModelStepActivity,
      operatorPrepareActionActivity,
      operatorExecuteActionActivity,
      operatorSettleMcpActionActivity,
      operatorObserveRunActivity,
      operatorCompleteTurnActivity,
      operatorCreateRunFollowUpActivity,
      operatorFailTurnActivity,
      workflowAgentSetupActivity,
      workflowAgentModelStepActivity,
      workflowAgentPrepareToolActivity,
      workflowAgentDispatchToolActivity,
      workflowAgentReconcileToolActivity,
      workflowAgentCheckpointActivity,
      workflowAgentFinalizeActivity,
      workflowAgentFailActivity,
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
    cleanupSteps.push({ name: 'Temporal worker', close: () => worker.shutdown() });

    console.log(
      `🚛 Temporal worker ready (namespace=${namespace}, taskQueue=${taskQueue}, workflowsPath=${workflowsPath})`,
    );

    const mcpDockerProxy = await startMcpDockerProxy({
      port: workerConfig.MCP_DOCKER_PROXY_PORT,
      publicBaseUrl:
        workerConfig.MCP_DOCKER_PROXY_PUBLIC_BASE_URL ??
        `http://127.0.0.1:${workerConfig.MCP_DOCKER_PROXY_PORT}`,
      authToken: workerConfig.MCP_DOCKER_PROXY_TOKEN ?? randomBytes(32).toString('base64url'),
    });
    cleanupSteps.push({ name: 'Docker MCP proxy', close: () => mcpDockerProxy.close() });
    initializeMcpDockerProxy(mcpDockerProxy);
    console.log(
      `🔀 Docker MCP proxy ready (port=${mcpDockerProxy.port}, publicBase=${workerConfig.MCP_DOCKER_PROXY_PUBLIC_BASE_URL ?? 'local'})`,
    );

    const backendReadinessConfigured = Boolean(
      process.env.BACKEND_URL ||
      process.env.SENTRIS_API_BASE_URL ||
      process.env.API_BASE_URL ||
      process.env.INTERNAL_SERVICE_TOKEN,
    );
    const readiness = createCachedReadinessEvaluator(
      createWorkerReadinessChecks({
        temporalConnection: connection,
        databasePool: pool,
        minio,
        redis: kafka.terminalRedis,
        kafka: kafka.readiness,
        mcpRuntime: { check: () => mcpRuntime.checkReadiness() },
        backend: backendReadinessConfigured
          ? {
              apiBaseUrl: resolveBackendApiBaseUrl(),
              internalToken: process.env.INTERNAL_SERVICE_TOKEN,
            }
          : undefined,
        workerState,
      }),
    );
    const healthServer: HealthServerHandle = await startHealthServer({ readiness });
    cleanupSteps.push({ name: 'health server', close: () => healthServer.close() });

    // Set up periodic heartbeat logging (file-based only)
    const heartbeatInterval = setInterval(() => {
      logHeartbeat(taskQueue);
    }, 15000);
    cleanupSteps.push({ name: 'heartbeat', close: () => clearInterval(heartbeatInterval) });

    // Register graceful shutdown handlers
    // PM2 sends SIGINT on restart; container orchestrators send SIGTERM.
    let shutdownRequested = false;
    const handleShutdown = (signal: string) => {
      if (shutdownRequested) return;
      shutdownRequested = true;
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      workerState.acceptingTasks = false;
      mcpRuntime.beginShutdown();
      worker.shutdown();
    };
    const onSigterm = () => handleShutdown('SIGTERM');
    const onSigint = () => handleShutdown('SIGINT');
    process.on('SIGTERM', onSigterm);
    process.on('SIGINT', onSigint);
    cleanupSteps.push({
      name: 'signal handlers',
      close: () => {
        process.removeListener('SIGTERM', onSigterm);
        process.removeListener('SIGINT', onSigint);
      },
    });

    console.log(`🚀 Starting worker.run() - this will block and listen for tasks...`);
    const runPromise = worker.run();
    workerState.acceptingTasks = true;
    await runPromise;
  } finally {
    console.log('🧹 Cleaning up resources...');
    workerState.acceptingTasks = false;
    await runCleanupSteps(cleanupSteps);
    console.log('✅ Worker shutdown complete');
  }
}

async function runCleanupSteps(
  cleanupSteps: readonly { name: string; close: () => void | Promise<void> }[],
): Promise<void> {
  for (const step of [...cleanupSteps].reverse()) {
    try {
      await step.close();
    } catch (error: unknown) {
      console.error(`Failed to close ${step.name}`, error);
    }
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
