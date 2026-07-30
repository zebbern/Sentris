import { TERMINAL_STATUSES, type ExecutionStatus } from '@sentris/shared';

import { buildBackendApiUrl } from './backend-url';

export type ReportableTerminalStatus = Extract<
  ExecutionStatus,
  'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TERMINATED' | 'TIMED_OUT'
>;

export interface RunFinalizationCallback {
  runId: string;
  organizationId: string | null | undefined;
  status: ReportableTerminalStatus;
  completedAt?: string;
}

interface RunFinalizerEnv extends Record<string, string | undefined> {
  SENTRIS_API_BASE_URL?: string;
  API_BASE_URL?: string;
  BACKEND_URL?: string;
  INTERNAL_SERVICE_TOKEN?: string;
}

interface RunFinalizerOptions {
  env?: RunFinalizerEnv;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const TERMINAL_STATUS_SET = new Set<string>(TERMINAL_STATUSES);

export async function notifyBackendRunFinalized(
  input: RunFinalizationCallback,
  options: RunFinalizerOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const internalToken = env.INTERNAL_SERVICE_TOKEN?.trim();
  if (!internalToken) {
    throw new Error('INTERNAL_SERVICE_TOKEN is required for run finalization callbacks');
  }

  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new Error('organizationId is required for run finalization callbacks');
  }
  if (!TERMINAL_STATUS_SET.has(input.status)) {
    throw new Error(`Run finalization requires a terminal status, received ${input.status}`);
  }

  const url = buildBackendApiUrl(`internal/runs/${encodeURIComponent(input.runId)}/finalize`, env);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
      'X-Organization-Id': organizationId,
    },
    body: JSON.stringify({
      status: input.status,
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Backend rejected run finalization callback with HTTP ${response.status}`);
  }
}
