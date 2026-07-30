import { execFile } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { status as grpcStatus } from '@grpc/grpc-js';
import { isGrpcServiceError } from '@temporalio/client';
import {
  DOCKER_RESOURCE_LABELS,
  managedDockerLabelFilters,
  matchesManagedDockerLabels,
  resolveDockerResourceScope,
  type DockerResourceScope,
} from '@sentris/component-sdk';

export type ManagedRunResourceKind = 'container' | 'volume' | 'exchange-directory';

export interface ManagedRunResource {
  kind: ManagedRunResourceKind;
  id: string;
  runId: string;
  createdAt: Date;
}

export interface OrphanResourceClient {
  listManagedResources(): Promise<ManagedRunResource[]>;
  removeResource(resource: ManagedRunResource): Promise<void>;
}

export type ActiveRunResolver = (runId: string) => Promise<boolean>;

export interface ReconciliationFailure {
  kind: ManagedRunResourceKind;
  id: string;
  message: string;
}

export interface ReconciliationReport {
  examined: number;
  eligible: number;
  preservedActive: number;
  preservedYoung: number;
  remainingEligible: number;
  truncated: boolean;
  removed: {
    containers: number;
    volumes: number;
    exchangeDirectories: number;
  };
  failures: ReconciliationFailure[];
}

export interface ReconcileOrphanResourcesOptions {
  client: OrphanResourceClient;
  isRunActive: ActiveRunResolver;
  minAgeMs: number;
  maxResources: number;
  runStateTimeoutMs?: number;
  now?: () => number;
}

export class OrphanReconciliationError extends Error {
  constructor(
    message: string,
    readonly report: ReconciliationReport,
  ) {
    super(message);
    this.name = 'OrphanReconciliationError';
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const RUN_RESOURCE_SUFFIXES = [
  '-codeql-output',
  '-jazzer-targets',
  '-prowler-aws',
  '-prowler-out',
] as const;

export function canonicalWorkflowRunId(resourceRunId: string): string {
  const workflowRunId = resourceRunId.split(':', 1)[0] ?? resourceRunId;
  const suffix = RUN_RESOURCE_SUFFIXES.find((candidate) => workflowRunId.endsWith(candidate));
  return suffix ? workflowRunId.slice(0, -suffix.length) : workflowRunId;
}

function resourceOrder(left: ManagedRunResource, right: ManagedRunResource): number {
  const kindPriority: Record<ManagedRunResourceKind, number> = {
    container: 0,
    volume: 1,
    'exchange-directory': 2,
  };
  return (
    kindPriority[left.kind] - kindPriority[right.kind] ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function emptyReport(
  examined: number,
  eligible: number,
  preservedYoung: number,
): ReconciliationReport {
  return {
    examined,
    eligible,
    preservedActive: 0,
    preservedYoung,
    remainingEligible: 0,
    truncated: false,
    removed: {
      containers: 0,
      volumes: 0,
      exchangeDirectories: 0,
    },
    failures: [],
  };
}

async function resolveRunActivityWithTimeout(
  runId: string,
  resolver: ActiveRunResolver,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Temporal run-state lookup for ${runId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([resolver(runId), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function reconcileOrphanedRunResources(
  options: ReconcileOrphanResourcesOptions,
): Promise<ReconciliationReport> {
  if (!Number.isFinite(options.minAgeMs) || options.minAgeMs < 0) {
    throw new Error('minAgeMs must be a non-negative finite number');
  }
  if (!Number.isInteger(options.maxResources) || options.maxResources < 1) {
    throw new Error('maxResources must be a positive integer');
  }
  const runStateTimeoutMs = options.runStateTimeoutMs ?? 3_000;
  if (!Number.isFinite(runStateTimeoutMs) || runStateTimeoutMs <= 0) {
    throw new Error('runStateTimeoutMs must be a positive finite number');
  }

  const now = (options.now ?? Date.now)();
  const resources = await options.client.listManagedResources();
  for (const resource of resources) {
    if (!Number.isFinite(resource.createdAt.getTime())) {
      throw new Error(`Managed ${resource.kind} ${resource.id} has an invalid creation time`);
    }
  }

  const oldEnough = resources
    .filter((resource) => now - resource.createdAt.getTime() >= options.minAgeMs)
    .sort(resourceOrder);
  const report = emptyReport(
    resources.length,
    oldEnough.length,
    resources.length - oldEnough.length,
  );

  const activityByRun = new Map<string, boolean>();
  await Promise.all(
    [...new Set(oldEnough.map((resource) => canonicalWorkflowRunId(resource.runId)))].map(
      async (runId) => {
        activityByRun.set(
          runId,
          await resolveRunActivityWithTimeout(runId, options.isRunActive, runStateTimeoutMs),
        );
      },
    ),
  );

  const inactive: ManagedRunResource[] = [];
  for (const resource of oldEnough) {
    if (activityByRun.get(canonicalWorkflowRunId(resource.runId))) {
      report.preservedActive += 1;
    } else {
      inactive.push(resource);
    }
  }

  const selected = inactive.slice(0, options.maxResources);
  report.remainingEligible = inactive.length - selected.length;
  report.truncated = report.remainingEligible > 0;

  for (const resource of selected) {
    try {
      await options.client.removeResource(resource);
      if (resource.kind === 'container') report.removed.containers += 1;
      if (resource.kind === 'volume') report.removed.volumes += 1;
      if (resource.kind === 'exchange-directory') report.removed.exchangeDirectories += 1;
    } catch (error: unknown) {
      report.failures.push({
        kind: resource.kind,
        id: resource.id,
        message: messageFor(error),
      });
    }
  }

  if (report.failures.length > 0) {
    const failedIds = report.failures.map(({ id }) => id).join(', ');
    throw new OrphanReconciliationError(
      `Failed to remove ${report.failures.length} orphan resource(s): ${failedIds}`,
      report,
    );
  }

  return report;
}

export interface OrphanReconcilerOptions {
  reconcile: () => Promise<ReconciliationReport>;
  intervalMs: number;
  onHealthChange?: (message: string | undefined) => void;
}

export interface OrphanReconcilerHandle {
  runNow(): Promise<ReconciliationReport>;
  close(): Promise<void>;
}

export async function startOrphanReconciler(
  options: OrphanReconcilerOptions,
): Promise<OrphanReconcilerHandle> {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error('intervalMs must be a positive finite number');
  }

  let inFlight: Promise<ReconciliationReport> | undefined;
  let closed = false;

  const runNow = (): Promise<ReconciliationReport> => {
    if (closed) return Promise.reject(new Error('Orphan reconciler is closed'));
    if (inFlight) return inFlight;

    inFlight = options
      .reconcile()
      .then((report) => {
        options.onHealthChange?.(undefined);
        return report;
      })
      .catch((error: unknown) => {
        options.onHealthChange?.(messageFor(error));
        throw error;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  await runNow();
  const timer = setInterval(() => {
    void runNow().catch(() => undefined);
  }, options.intervalMs);
  timer.unref();

  return {
    runNow,
    async close() {
      closed = true;
      clearInterval(timer);
      await inFlight?.catch(() => undefined);
    },
  };
}

interface DockerCommandOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export type DockerCommand = (
  args: string[],
  options?: DockerCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface DockerOrphanResourceClientOptions {
  command?: DockerCommand;
  dockerEnv?: NodeJS.ProcessEnv;
  exchangeRoot?: string;
  commandTimeoutMs?: number;
  maxInventoryResources?: number;
  resourceScope?: DockerResourceScope;
}

const SAFE_DOCKER_ID = /^[a-zA-Z0-9_.-]+$/;
const SAFE_RUN_LABEL = /^[^\0\r\n]{1,512}$/;

const defaultDockerCommand: DockerCommand = (args, options) =>
  new Promise((resolveCommand, rejectCommand) => {
    execFile(
      'docker',
      args,
      {
        encoding: 'utf8',
        env: options?.env,
        maxBuffer: 4 * 1024 * 1024,
        timeout: options?.timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectCommand(error);
          return;
        }
        resolveCommand({ stdout, stderr });
      },
    );
  });

function outputLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseCreatedAt(value: unknown, description: string): Date {
  const createdAt = new Date(String(value));
  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error(`${description} has an invalid creation time`);
  }
  return createdAt;
}

function requireSafeIdentifier(value: unknown, description: string): string {
  if (typeof value !== 'string' || !SAFE_DOCKER_ID.test(value)) {
    throw new Error(`${description} has an unsafe identifier`);
  }
  return value;
}

function requireRunLabelValue(value: unknown, description: string): string {
  if (typeof value !== 'string' || !SAFE_RUN_LABEL.test(value)) {
    throw new Error(`${description} is invalid`);
  }
  return value;
}

function requireRunId(labels: unknown, key: string, description: string): string {
  if (!labels || typeof labels !== 'object') {
    throw new Error(`${description} is missing labels`);
  }
  const value = (labels as Record<string, unknown>)[key];
  return requireRunLabelValue(value, `${description} run label`);
}

async function readExchangeResources(
  exchangeRoot: string | undefined,
  resourceScope: DockerResourceScope,
): Promise<ManagedRunResource[]> {
  if (!exchangeRoot) return [];
  const metadataRoot = resolve(exchangeRoot, 'metadata');
  let entries;
  try {
    entries = await readdir(metadataRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const resources: ManagedRunResource[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const resourceId = requireSafeIdentifier(
      entry.name.slice(0, -'.json'.length),
      'Exchange metadata file',
    );
    const raw = await readFile(resolve(metadataRoot, entry.name), 'utf8');
    const metadata = JSON.parse(raw) as Record<string, unknown>;
    if (metadata.managed !== true || metadata.resourceId !== resourceId) {
      throw new Error(`Exchange metadata ${entry.name} is not a managed Sentris resource`);
    }
    if (
      metadata.deploymentId !== resourceScope.deploymentId ||
      metadata.instanceId !== resourceScope.instanceId ||
      metadata.temporalNamespace !== resourceScope.temporalNamespace ||
      metadata.temporalTaskQueue !== resourceScope.temporalTaskQueue
    ) {
      // Legacy unscoped and foreign metadata must remain untouched. The
      // owning worker scope can migrate or reconcile it explicitly.
      continue;
    }
    resources.push({
      kind: 'exchange-directory',
      id: resourceId,
      runId: requireRunLabelValue(metadata.runId, `Exchange metadata ${entry.name} runId`),
      createdAt: parseCreatedAt(metadata.createdAt, `Exchange metadata ${entry.name}`),
    });
  }
  return resources;
}

export function createDockerOrphanResourceClient(
  options: DockerOrphanResourceClientOptions = {},
): OrphanResourceClient {
  const command = options.command ?? defaultDockerCommand;
  const commandOptions: DockerCommandOptions = {
    env: options.dockerEnv ?? process.env,
    timeout: options.commandTimeoutMs ?? 10_000,
  };
  const maxInventoryResources = options.maxInventoryResources ?? 500;
  const resourceScope = options.resourceScope ?? resolveDockerResourceScope();

  const inspect = async (kind: 'container' | 'volume', ids: string[]) => {
    if (ids.length === 0) return [] as Record<string, unknown>[];
    const inspected: Record<string, unknown>[] = [];
    const sortedIds = [...ids].sort((left, right) => left.localeCompare(right));
    for (let offset = 0; offset < sortedIds.length; offset += maxInventoryResources) {
      const page = sortedIds.slice(offset, offset + maxInventoryResources);
      const args = kind === 'container' ? ['inspect', ...page] : ['volume', 'inspect', ...page];
      const { stdout } = await command(args, commandOptions);
      const parsed = JSON.parse(stdout) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Docker ${kind} inspect returned a non-array response`);
      }
      inspected.push(...(parsed as Record<string, unknown>[]));
    }
    return inspected;
  };

  return {
    async listManagedResources() {
      const [{ stdout: containerList }, { stdout: volumeList }, exchange] = await Promise.all([
        command(['ps', '-aq', ...managedDockerLabelFilters(resourceScope)], commandOptions),
        command(
          ['volume', 'ls', '-q', ...managedDockerLabelFilters(resourceScope)],
          commandOptions,
        ),
        readExchangeResources(options.exchangeRoot, resourceScope),
      ]);
      const containerIds = outputLines(containerList);
      const volumeIds = outputLines(volumeList);

      const [containers, volumes] = await Promise.all([
        inspect('container', containerIds),
        inspect('volume', volumeIds),
      ]);
      return [
        ...containers.map((container) => {
          const config = container.Config as Record<string, unknown> | undefined;
          const id = requireSafeIdentifier(container.Id, 'Managed container');
          const runId = requireRunId(
            config?.Labels,
            DOCKER_RESOURCE_LABELS.runId,
            `Managed container ${id}`,
          );
          if (!matchesManagedDockerLabels(config?.Labels, runId, resourceScope)) {
            throw new Error(`Managed container ${id} does not match the worker resource scope`);
          }
          return {
            kind: 'container' as const,
            id,
            runId,
            createdAt: parseCreatedAt(container.Created, `Managed container ${id}`),
          };
        }),
        ...volumes.map((volume) => {
          const id = requireSafeIdentifier(volume.Name, 'Managed volume');
          const runId = requireRunId(
            volume.Labels,
            DOCKER_RESOURCE_LABELS.runId,
            `Managed volume ${id}`,
          );
          if (!matchesManagedDockerLabels(volume.Labels, runId, resourceScope)) {
            throw new Error(`Managed volume ${id} does not match the worker resource scope`);
          }
          return {
            kind: 'volume' as const,
            id,
            runId,
            createdAt: parseCreatedAt(volume.CreatedAt, `Managed volume ${id}`),
          };
        }),
        ...exchange,
      ];
    },
    async removeResource(resource) {
      requireSafeIdentifier(resource.id, `Managed ${resource.kind}`);
      if (resource.kind === 'container') {
        await command(['rm', '-f', resource.id], commandOptions);
        return;
      }
      if (resource.kind === 'volume') {
        await command(['volume', 'rm', resource.id], commandOptions);
        return;
      }
      if (!options.exchangeRoot) {
        throw new Error('Exchange root is not configured');
      }

      const runsRoot = resolve(options.exchangeRoot, 'runs');
      const resourcePath = resolve(runsRoot, resource.id);
      const expectedPrefix = `${runsRoot}${sep}`;
      if (!resourcePath.startsWith(expectedPrefix)) {
        throw new Error(`Exchange resource path escapes configured root: ${resource.id}`);
      }
      await rm(resourcePath, { recursive: true, force: true });
      await rm(resolve(options.exchangeRoot, 'metadata', `${resource.id}.json`), {
        force: true,
      });
    },
  };
}

interface TemporalWorkflowServiceLike {
  describeWorkflowExecution(input: {
    namespace: string;
    execution: { workflowId: string };
  }): Promise<{
    workflowExecutionInfo?: {
      status?: number | string | null;
    } | null;
  }>;
}

interface TemporalConnectionLike {
  workflowService: TemporalWorkflowServiceLike;
}

const TEMPORAL_RUNNING_STATUSES = new Set<number | string>([
  1,
  'RUNNING',
  'WORKFLOW_EXECUTION_STATUS_RUNNING',
]);
const TEMPORAL_TERMINAL_STATUSES = new Set<number | string>([
  2,
  3,
  4,
  5,
  6,
  7,
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
  'WORKFLOW_EXECUTION_STATUS_COMPLETED',
  'WORKFLOW_EXECUTION_STATUS_FAILED',
  'WORKFLOW_EXECUTION_STATUS_CANCELED',
  'WORKFLOW_EXECUTION_STATUS_TERMINATED',
  'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW',
  'WORKFLOW_EXECUTION_STATUS_TIMED_OUT',
]);

export function createTemporalRunActivityResolver(
  connection: TemporalConnectionLike,
  namespace: string,
): ActiveRunResolver {
  return async (runId) => {
    try {
      const response = await connection.workflowService.describeWorkflowExecution({
        namespace,
        execution: { workflowId: runId },
      });
      const status = response.workflowExecutionInfo?.status;
      if (status === undefined || status === null) {
        throw new Error(`Temporal returned no execution status for workflow ${runId}`);
      }
      if (TEMPORAL_RUNNING_STATUSES.has(status)) return true;
      if (TEMPORAL_TERMINAL_STATUSES.has(status)) return false;
      throw new Error(
        `Temporal returned unknown execution status ${String(status)} for workflow ${runId}`,
      );
    } catch (error: unknown) {
      if (isGrpcServiceError(error) && error.code === grpcStatus.NOT_FOUND) {
        return false;
      }
      throw error;
    }
  };
}
