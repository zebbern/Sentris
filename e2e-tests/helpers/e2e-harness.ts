/**
 * Shared E2E Test Harness
 *
 * Extracts common boilerplate used across all E2E test files:
 * - API_BASE / HEADERS constants
 * - Service availability checks (sync + async)
 * - Skip-aware describe/test wrappers
 * - Workflow CRUD helpers
 * - Secret management helpers
 * - Webhook helpers
 * - Run polling
 */

import { describe, test } from 'bun:test';

import { getApiBaseUrl } from './api-base';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_BASE = getApiBaseUrl();

export const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

// ---------------------------------------------------------------------------
// E2E gate flags
// ---------------------------------------------------------------------------

export const runE2E = process.env.RUN_E2E === 'true';
export const runCloudE2E = process.env.RUN_CLOUD_E2E === 'true';

// ---------------------------------------------------------------------------
// Service availability
// ---------------------------------------------------------------------------

/** Synchronous health check (runs at module load, before tests are defined). */
export function servicesAvailableSync(): boolean {
  if (!runE2E) return false;
  try {
    const result = Bun.spawnSync(
      [
        'curl', '-sf', '--max-time', '1',
        '-H', `x-internal-token: ${HEADERS['x-internal-token']}`,
        `${API_BASE}/health`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Async health check for use in beforeAll hooks. */
export async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) return false;
  try {
    const healthRes = await fetch(`${API_BASE}/health`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(2000),
    });
    return healthRes.ok;
  } catch {
    return false;
  }
}

// Evaluate once at module load so every importer shares the same value.
const _servicesOk = servicesAvailableSync();

/** Whether E2E is enabled AND the backend is reachable. */
export function isE2EReady(): boolean {
  return runE2E && _servicesOk;
}

// ---------------------------------------------------------------------------
// Skip-aware test wrappers
// ---------------------------------------------------------------------------

/**
 * `describe` that auto-skips when E2E is disabled or services are down.
 * For cloud tests pass `{ cloud: true }` to also require RUN_CLOUD_E2E.
 */
export function e2eDescribe(
  name: string,
  fn: () => void,
  opts?: { cloud?: boolean },
): void {
  const enabled = opts?.cloud
    ? runE2E && runCloudE2E && _servicesOk
    : runE2E && _servicesOk;
  (enabled ? describe : describe.skip)(name, fn);
}

/**
 * `test` that auto-skips when E2E is disabled or services are down.
 * Supports an optional options object (e.g. `{ timeout: 120000 }`).
 */
export function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>,
): void {
  if (isE2EReady()) {
    if (typeof optionsOrFn === 'function') {
      test(name, optionsOrFn);
    } else if (fn) {
      (test as any)(name, optionsOrFn, fn);
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

// ---------------------------------------------------------------------------
// Workflow helpers
// ---------------------------------------------------------------------------

/** Create a workflow, returns its ID. */
export async function createWorkflow(workflow: any): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflow),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workflow creation failed: ${res.status} ${text}`);
  }
  const { id } = await res.json();
  return id;
}

/** Create a workflow, returns the full response body. */
export async function createWorkflowFull(workflow: any): Promise<any> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflow),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workflow creation failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** List all workflows. */
export async function listWorkflows(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/workflows`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list workflows: ${res.status} ${text}`);
  }
  return res.json();
}

/** Get a workflow by ID. */
export async function getWorkflow(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/workflows/${id}`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get workflow ${id}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Fetch a workflow, returning the raw Response (for asserting 404s etc.). */
export async function getWorkflowRaw(id: string): Promise<Response> {
  return fetch(`${API_BASE}/workflows/${id}`, { headers: HEADERS });
}

/** Rename a workflow via PATCH /workflows/:id/metadata. */
export async function renameWorkflow(
  id: string,
  newName: string,
  description?: string | null,
): Promise<any> {
  const body: Record<string, unknown> = { name: newName };
  if (description !== undefined) body.description = description;
  const res = await fetch(`${API_BASE}/workflows/${id}/metadata`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to rename workflow ${id}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Delete a workflow. Returns the response status code. */
export async function deleteWorkflowById(id: string): Promise<number> {
  const res = await fetch(`${API_BASE}/workflows/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  return res.status;
}

/** Run a workflow, returns the runId. */
export async function runWorkflow(
  workflowId: string,
  inputs: Record<string, unknown> = {},
): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workflow run failed: ${res.status} ${text}`);
  }
  const { runId } = await res.json();
  return runId;
}

/** Poll until a run reaches a terminal status. */
export async function pollRunStatus(
  runId: string,
  timeoutMs = 180000,
): Promise<{ status: string }> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, {
      headers: HEADERS,
    });
    const s = await res.json();
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED'].includes(s.status)) {
      return s;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Workflow run ${runId} did not complete within ${timeoutMs}ms`);
}

/** Fetch trace events for a run. */
export async function getTraceEvents(runId: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, {
    headers: HEADERS,
  });
  if (!res.ok) return [];
  const trace = await res.json();
  return trace?.events ?? [];
}

// ---------------------------------------------------------------------------
// Secret helpers
// ---------------------------------------------------------------------------

export async function listSecrets(): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${API_BASE}/secrets`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list secrets: ${res.status} ${text}`);
  }
  return res.json();
}

export async function createOrRotateSecret(
  name: string,
  value: string,
): Promise<string> {
  const secrets = await listSecrets();
  const existing = secrets.find((s) => s.name === name);
  if (!existing) {
    const res = await fetch(`${API_BASE}/secrets`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name, value }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create secret: ${res.status} ${text}`);
    }
    const secret = await res.json();
    return secret.id as string;
  }

  const res = await fetch(`${API_BASE}/secrets/${existing.id}/rotate`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to rotate secret: ${res.status} ${text}`);
  }
  return existing.id;
}

/** Create a secret, returning the full response body. */
export async function createSecret(
  name: string,
  value: string,
  opts?: { description?: string; tags?: string[] },
): Promise<any> {
  const res = await fetch(`${API_BASE}/secrets`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ name, value, ...opts }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create secret: ${res.status} ${text}`);
  }
  return res.json();
}

/** Get a secret by ID (metadata only). */
export async function getSecret(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/secrets/${id}`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get secret: ${res.status} ${text}`);
  }
  return res.json();
}

/** Get the decrypted value of a secret. */
export async function getSecretValue(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/secrets/${id}/value`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get secret value: ${res.status} ${text}`);
  }
  return res.json();
}

/** Update secret metadata (name, description, tags). */
export async function updateSecret(
  id: string,
  patch: { name?: string; description?: string | null; tags?: string[] | null },
): Promise<any> {
  const res = await fetch(`${API_BASE}/secrets/${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update secret: ${res.status} ${text}`);
  }
  return res.json();
}

/** Rotate a secret's value. */
export async function rotateSecret(id: string, newValue: string): Promise<any> {
  const res = await fetch(`${API_BASE}/secrets/${id}/rotate`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ value: newValue }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to rotate secret: ${res.status} ${text}`);
  }
  return res.json();
}

/** Delete a secret. Returns the response status code. */
export async function deleteSecret(id: string): Promise<number> {
  const res = await fetch(`${API_BASE}/secrets/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  return res.status;
}

/** Attempt to fetch a secret, returning the raw Response (for asserting 404s etc.). */
export async function fetchSecretRaw(id: string): Promise<Response> {
  return fetch(`${API_BASE}/secrets/${id}`, { headers: HEADERS });
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

export async function createWebhook(config: any): Promise<any> {
  const res = await fetch(`${API_BASE}/webhooks/configurations`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`Webhook creation failed: ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// API Key helpers
// ---------------------------------------------------------------------------

export interface CreateApiKeyConfig {
  name: string;
  description?: string;
  permissions: {
    workflows: { run: boolean; list: boolean; read: boolean; create?: boolean; update?: boolean; delete?: boolean };
    runs: { read: boolean; cancel: boolean };
    audit: { read: boolean };
    artifacts?: { read?: boolean; delete?: boolean };
    schedules?: { list?: boolean; read?: boolean; create?: boolean; update?: boolean; delete?: boolean };
    secrets?: { list?: boolean; read?: boolean; create?: boolean; update?: boolean; delete?: boolean };
    'human-inputs'?: { read?: boolean; resolve?: boolean };
  };
  expiresAt?: string;
  rateLimit?: number;
}

export async function createApiKey(config: CreateApiKeyConfig): Promise<any> {
  const res = await fetch(`${API_BASE}/api-keys`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API key creation failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function listApiKeys(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/api-keys`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list API keys: ${res.status} ${text}`);
  }
  return res.json();
}

export async function getApiKey(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api-keys/${id}`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get API key: ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateApiKey(id: string, patch: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API_BASE}/api-keys/${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update API key: ${res.status} ${text}`);
  }
  return res.json();
}

export async function revokeApiKey(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api-keys/${id}/revoke`, {
    method: 'POST',
    headers: HEADERS,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to revoke API key: ${res.status} ${text}`);
  }
  return res.json();
}

export async function deleteApiKey(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/api-keys/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete API key: ${res.status} ${text}`);
  }
  return res.json();
}

export async function deleteApiKeyRaw(id: string): Promise<Response> {
  return fetch(`${API_BASE}/api-keys/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
}

export async function getApiKeyRaw(id: string): Promise<Response> {
  return fetch(`${API_BASE}/api-keys/${id}`, { headers: HEADERS });
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

/** Create a schedule, returns the full schedule object. */
export async function createSchedule(config: {
  workflowId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  description?: string | null;
  overlapPolicy?: 'skip' | 'buffer' | 'allow';
  catchupWindowSeconds?: number;
  inputPayload?: { runtimeInputs?: Record<string, unknown>; nodeOverrides?: Record<string, unknown> };
}): Promise<any> {
  const res = await fetch(`${API_BASE}/schedules`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Schedule creation failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** List all schedules, optionally filtered by workflowId or status. */
export async function listSchedules(query?: {
  workflowId?: string;
  status?: string;
}): Promise<any[]> {
  const params = new URLSearchParams();
  if (query?.workflowId) params.set('workflowId', query.workflowId);
  if (query?.status) params.set('status', query.status);
  const qs = params.toString();
  const url = qs ? `${API_BASE}/schedules?${qs}` : `${API_BASE}/schedules`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list schedules: ${res.status} ${text}`);
  }
  const body = await res.json();
  return body.schedules ?? body;
}

/** Get a single schedule by ID. */
export async function getSchedule(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/schedules/${id}`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get schedule ${id}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Update (PATCH) a schedule, returns the updated schedule. */
export async function updateSchedule(
  id: string,
  patch: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${API_BASE}/schedules/${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update schedule ${id}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Delete a schedule. */
export async function deleteSchedule(id: string): Promise<Response> {
  const res = await fetch(`${API_BASE}/schedules/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  return res;
}

/** Pause a schedule; returns the updated schedule. */
export async function pauseSchedule(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/schedules/${id}/pause`, {
    method: 'POST',
    headers: HEADERS,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to pause schedule ${id}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Resume a schedule; returns the updated schedule. */
export async function resumeSchedule(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/schedules/${id}/resume`, {
    method: 'POST',
    headers: HEADERS,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resume schedule ${id}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Trigger a schedule manually; returns { success: true }. */
export async function triggerSchedule(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/schedules/${id}/trigger`, {
    method: 'POST',
    headers: HEADERS,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to trigger schedule ${id}: ${res.status} ${text}`);
  }
  return res.json();
}
