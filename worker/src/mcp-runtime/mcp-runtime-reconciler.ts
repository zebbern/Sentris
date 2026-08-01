import type {
  McpRuntimeDefinition,
  McpRuntimeDriver,
  McpRuntimeResource,
} from './mcp-runtime-driver';
import { McpRuntimeDriverRegistry } from './mcp-runtime-driver';
import type { McpRuntimeLeaseRepository } from './mcp-runtime-lease.repository';

const MAX_RECONCILIATION_RESOURCES = 10_000;
const MIN_RECONCILIATION_INTERVAL_MS = 1_000;
const MAX_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

type McpRuntimeDriverKind = McpRuntimeDefinition['kind'];

export interface McpRuntimeReconciliationFailure {
  phase: 'inventory' | 'authority' | 'reap';
  driverKinds: McpRuntimeDriverKind[];
  resourceKind?: McpRuntimeResource['kind'];
  resourceId?: string;
  message: string;
}

export interface McpRuntimeReconciliationReport {
  driversExamined: number;
  inventoried: number;
  examined: number;
  preserved: number;
  reaped: number;
  remaining: number;
  truncated: boolean;
  failures: McpRuntimeReconciliationFailure[];
}

export interface ReconcileMcpRuntimeResourcesOptions {
  drivers: McpRuntimeDriverRegistry;
  leaseRepository: Pick<McpRuntimeLeaseRepository, 'matchesFenceByHash'>;
  maxResources: number;
}

export class McpRuntimeReconciliationError extends Error {
  constructor(readonly report: McpRuntimeReconciliationReport) {
    const details = report.failures.map((failure) => failure.message).join('; ');
    super(`MCP runtime reconciliation failed: ${details}`);
    this.name = 'McpRuntimeReconciliationError';
  }
}

interface InventoriedResource {
  driver: McpRuntimeDriver;
  resource: McpRuntimeResource;
}

export async function reconcileMcpRuntimeResources(
  options: ReconcileMcpRuntimeResourcesOptions,
): Promise<McpRuntimeReconciliationReport> {
  assertMaxResources(options.maxResources);

  const drivers = options.drivers.all();
  const selected: InventoriedResource[] = [];
  const failures: McpRuntimeReconciliationFailure[] = [];
  let inventoried = 0;

  for (const driver of drivers) {
    try {
      const resources = await driver.inventory();
      inventoried += resources.length;
      for (const resource of resources) {
        if (selected.length >= options.maxResources) break;
        selected.push({ driver, resource });
      }
    } catch (error: unknown) {
      failures.push(driverFailure('inventory', driver, error));
    }
  }

  const report: McpRuntimeReconciliationReport = {
    driversExamined: drivers.length,
    inventoried,
    examined: selected.length,
    preserved: 0,
    reaped: 0,
    remaining: Math.max(0, inventoried - selected.length),
    truncated: inventoried > selected.length,
    failures,
  };

  for (const candidate of selected) {
    const { driver, resource } = candidate;
    let matches: boolean;
    try {
      matches = await options.leaseRepository.matchesFenceByHash(
        resource.runtimeKeyHash,
        resource.fence,
      );
    } catch (error: unknown) {
      report.failures.push(resourceFailure('authority', driver, resource, error));
      continue;
    }

    if (matches) {
      report.preserved += 1;
      continue;
    }

    try {
      matches = await options.leaseRepository.matchesFenceByHash(
        resource.runtimeKeyHash,
        resource.fence,
      );
    } catch (error: unknown) {
      report.failures.push(resourceFailure('authority', driver, resource, error));
      continue;
    }

    if (matches) {
      report.preserved += 1;
      continue;
    }

    try {
      await driver.reap(resource);
      report.reaped += 1;
    } catch (error: unknown) {
      report.failures.push(resourceFailure('reap', driver, resource, error));
    }
  }

  if (report.failures.length > 0) throw new McpRuntimeReconciliationError(report);
  return report;
}

export interface StartMcpRuntimeReconcilerOptions extends ReconcileMcpRuntimeResourcesOptions {
  intervalMs: number;
  onHealthChange?: (message: string | undefined) => void;
}

export interface McpRuntimeReconcilerHandle {
  runNow(): Promise<McpRuntimeReconciliationReport>;
  close(): Promise<void>;
}

export async function startMcpRuntimeReconciler(
  options: StartMcpRuntimeReconcilerOptions,
): Promise<McpRuntimeReconcilerHandle> {
  assertInterval(options.intervalMs);

  let inFlight: Promise<McpRuntimeReconciliationReport> | undefined;
  let closed = false;

  const runNow = (): Promise<McpRuntimeReconciliationReport> => {
    if (closed) return Promise.reject(new Error('MCP runtime reconciler is closed'));
    if (inFlight) return inFlight;

    const pass = reconcileMcpRuntimeResources(options)
      .then((report) => {
        options.onHealthChange?.(undefined);
        return report;
      })
      .catch((error: unknown) => {
        options.onHealthChange?.(messageFor(error));
        throw error;
      })
      .finally(() => {
        if (inFlight === pass) inFlight = undefined;
      });
    inFlight = pass;
    return pass;
  };

  await runNow();
  const timer = setInterval(() => {
    void runNow().catch(() => undefined);
  }, options.intervalMs);
  timer.unref();

  return {
    runNow,
    async close() {
      if (closed) {
        await inFlight?.catch(() => undefined);
        return;
      }
      closed = true;
      clearInterval(timer);
      await inFlight?.catch(() => undefined);
    },
  };
}

function driverFailure(
  phase: 'inventory',
  driver: McpRuntimeDriver,
  error: unknown,
): McpRuntimeReconciliationFailure {
  return {
    phase,
    driverKinds: [...driver.kinds],
    message: messageFor(error),
  };
}

function resourceFailure(
  phase: 'authority' | 'reap',
  driver: McpRuntimeDriver,
  resource: McpRuntimeResource,
  error: unknown,
): McpRuntimeReconciliationFailure {
  return {
    phase,
    driverKinds: [...driver.kinds],
    resourceKind: resource.kind,
    resourceId: resource.resourceId,
    message: messageFor(error),
  };
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertMaxResources(maxResources: number): void {
  if (
    !Number.isInteger(maxResources) ||
    maxResources < 1 ||
    maxResources > MAX_RECONCILIATION_RESOURCES
  ) {
    throw new Error(
      `maxResources must be an integer between 1 and ${MAX_RECONCILIATION_RESOURCES}`,
    );
  }
}

function assertInterval(intervalMs: number): void {
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MIN_RECONCILIATION_INTERVAL_MS ||
    intervalMs > MAX_RECONCILIATION_INTERVAL_MS
  ) {
    throw new Error(
      `intervalMs must be an integer between ${MIN_RECONCILIATION_INTERVAL_MS} and ${MAX_RECONCILIATION_INTERVAL_MS}`,
    );
  }
}
