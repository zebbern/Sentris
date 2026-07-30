/**
 * Self-hosted release journey:
 * target -> zero-input scoped Docker run -> assets/findings -> triage -> rescan -> delta
 * -> live Docker cancellation -> cleanup.
 *
 * The httpx components intentionally exercise the supported DIND data/control
 * path and public scanner egress. One keeps the same target while changing only
 * an output filter; the other changes target surface. This proves both
 * not-observed and not-scanned semantics without conflating component coverage.
 * Asset and finding polling proves the required Kafka/outbox projections rather
 * than treating workflow completion as enough.
 */

import { afterAll, expect } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  createWorkflowFull,
  deleteWorkflowById,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
} from '../helpers/e2e-harness';
import {
  isExpectedFindingProjectionReady,
  type FindingProjectionReadinessMode,
} from '../helpers/finding-projection-readiness';
import { terminalOutputContains, type EncodedTerminalChunk } from '../helpers/terminal-output';

const POLL_INTERVAL_MS = 1_000;
const PROJECTION_TIMEOUT_MS = 90_000;
const FINDINGS_RECONCILIATION_PAUSED =
  process.env.FINDINGS_RECONCILIATION_SCHEDULE_ENABLED === 'false';
const INITIAL_FINDING_READINESS_MODE: FindingProjectionReadinessMode =
  FINDINGS_RECONCILIATION_PAUSED ? 'storage-verification-paused' : 'verified-storage';
const TRIAGED_FINDING_READINESS_MODE: FindingProjectionReadinessMode =
  FINDINGS_RECONCILIATION_PAUSED ? 'storage-and-triage-reconciliation-paused' : 'verified-storage';

interface JourneyFinding {
  id: string;
  name?: string;
  asset_key?: string;
  scope_id?: string;
  triage?: { status?: string; projectionVersion?: number } | null;
}

interface JourneyTraceEvent {
  nodeId?: string;
  type?: string;
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T;
  return { response, body };
}

async function pollFor<T>(
  description: string,
  fetchValue: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = PROJECTION_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await fetchValue();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `${description} was not ready within ${timeoutMs}ms: ${JSON.stringify(lastValue)}`,
  );
}

function makeWorkflow(
  name: string,
  options: {
    observationStatusCodes: string;
    changedSurfaceTarget: string;
  },
) {
  return {
    name,
    description: 'Self-hosted release journey using a zero-runtime-input Docker scanner',
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: { params: { runtimeInputs: [] }, inputOverrides: {} },
        },
      },
      {
        id: 'httpx-observation',
        type: 'sentris.httpx.scan',
        position: { x: 260, y: 0 },
        data: {
          label: 'Probe stable target surface',
          config: {
            params: {
              threads: 1,
              followRedirects: true,
              preferHttps: true,
              statusCodes: options.observationStatusCodes,
            },
            inputOverrides: { targets: ['https://example.com'] },
          },
        },
      },
      {
        id: 'httpx-changed-surface',
        type: 'sentris.httpx.scan',
        position: { x: 260, y: 180 },
        data: {
          label: 'Probe changing target surface',
          config: {
            params: {
              threads: 1,
              followRedirects: true,
              preferHttps: true,
              statusCodes: '200',
            },
            inputOverrides: { targets: [options.changedSurfaceTarget] },
          },
        },
      },
      {
        id: 'sink',
        type: 'core.analytics.sink',
        position: { x: 520, y: 0 },
        data: {
          label: 'Index findings',
          config: {
            params: {
              dataInputs: [{ id: 'results', label: 'Results', sourceTag: 'httpx' }],
              assetKeyField: 'auto',
              failOnError: true,
            },
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [
      { id: 'start-httpx-observation', source: 'start', target: 'httpx-observation' },
      {
        id: 'start-httpx-changed-surface',
        source: 'start',
        target: 'httpx-changed-surface',
      },
      { id: 'httpx-sink', source: 'httpx-changed-surface', target: 'sink' },
      {
        id: 'httpx-results',
        source: 'httpx-changed-surface',
        target: 'sink',
        sourceHandle: 'results',
        targetHandle: 'results',
      },
    ],
  };
}

function makeCancellationWorkflow(name: string) {
  return {
    name,
    description: 'Self-hosted release cancellation and Docker cleanup proof',
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: { params: { runtimeInputs: [] }, inputOverrides: {} },
        },
      },
      {
        id: 'terminal-demo',
        type: 'sentris.security.terminal-demo',
        position: { x: 260, y: 0 },
        data: {
          label: 'Cancellable Docker process',
          config: {
            params: {
              message: 'Self-hosted release cancellation proof',
              durationSeconds: 20,
            },
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [{ id: 'start-terminal', source: 'start', target: 'terminal-demo' }],
  };
}

async function startScopedRun(workflowId: string, scopeId: string): Promise<string> {
  const { response, body } = await jsonRequest<{ runId?: string }>(`/workflows/${workflowId}/run`, {
    method: 'POST',
    body: JSON.stringify({ inputs: {}, scopeId }),
  });
  expect(response.status).toBe(201);
  expect(body.runId).toBeTruthy();
  return body.runId!;
}

e2eDescribe('Self-hosted target-to-triage release journey', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let scopeId: string | undefined;
  let workflowId: string | undefined;
  let cancellationWorkflowId: string | undefined;

  afterAll(async () => {
    if (cancellationWorkflowId) {
      await deleteWorkflowById(cancellationWorkflowId).catch(() => undefined);
    }
    if (workflowId) {
      await deleteWorkflowById(workflowId).catch(() => undefined);
    }
    if (scopeId) {
      await fetch(`${API_BASE}/scopes/${scopeId}`, {
        method: 'DELETE',
        headers: HEADERS,
      }).catch(() => undefined);
    }
  });

  e2eTest(
    'completes discovery, triage, rescan, delta, and cancellation cleanup',
    { timeout: 360_000 },
    async () => {
      const scope = await jsonRequest<{ id?: string }>('/scopes', {
        method: 'POST',
        body: JSON.stringify({
          name: `release-target-${suffix}`,
          description: 'Disposable self-hosted release-gate target',
          domains: ['example.com', 'example.org'],
          repos: [],
          ipRanges: [],
          runtimeValues: {},
        }),
      });
      expect(scope.response.status).toBe(201);
      scopeId = scope.body.id;
      expect(scopeId).toBeTruthy();

      const workflow = await createWorkflowFull(
        makeWorkflow(`release-critical-journey-${suffix}`, {
          observationStatusCodes: '200',
          changedSurfaceTarget: 'https://example.org',
        }),
      );
      workflowId = workflow.id;

      const baselineRunId = await startScopedRun(workflowId!, scopeId!);
      expect((await pollRunStatus(baselineRunId, 180_000)).status).toBe('COMPLETED');

      const baselineTrace = await pollFor(
        'baseline telemetry ingestion',
        async () =>
          (
            await jsonRequest<{ events?: JourneyTraceEvent[] }>(
              `/workflows/runs/${encodeURIComponent(baselineRunId)}/trace`,
            )
          ).body,
        (trace) =>
          trace.events?.some(
            (event) => event.nodeId === 'httpx-observation' && event.type === 'STARTED',
          ) === true &&
          trace.events?.some(
            (event) => event.nodeId === 'httpx-observation' && event.type === 'COMPLETED',
          ) === true &&
          trace.events?.some(
            (event) => event.nodeId === 'httpx-changed-surface' && event.type === 'COMPLETED',
          ) === true,
      );
      expect(baselineTrace.events?.length).toBeGreaterThan(0);

      const runHistory = await jsonRequest<{ runs?: { id: string; scopeId?: string | null }[] }>(
        `/workflows/runs?scopeId=${encodeURIComponent(scopeId!)}&limit=1`,
      );
      expect(runHistory.response.ok).toBe(true);
      expect(runHistory.body.runs?.[0]).toMatchObject({
        id: baselineRunId,
        scopeId,
      });

      const baselineAssets = await pollFor(
        'baseline asset projection',
        async () =>
          (
            await jsonRequest<{ assetValue: string; lastSeenRunId?: string | null }[]>(
              `/scopes/${scopeId}/assets`,
            )
          ).body,
        (assets) =>
          assets.some(
            (asset) =>
              asset.lastSeenRunId === baselineRunId &&
              asset.assetValue.toLowerCase().includes('example.com'),
          ),
      );
      expect(baselineAssets.length).toBeGreaterThan(0);

      const findings = await pollFor(
        'scope finding projection',
        async () =>
          (
            await jsonRequest<{
              items?: JourneyFinding[];
              availability?: string;
              degradedReasons?: string[];
            }>(`/findings?scopeId=${encodeURIComponent(scopeId!)}&pageSize=100`)
          ).body,
        (result) =>
          isExpectedFindingProjectionReady(
            result,
            INITIAL_FINDING_READINESS_MODE,
            (finding) => finding.scope_id === scopeId,
          ),
      );
      const finding = findings.items!.find((item) => item.scope_id === scopeId)!;

      const triage = await jsonRequest<{ status?: string; projectionVersion?: number }>(
        `/findings/${encodeURIComponent(finding.id)}/triage`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'triaged',
            notes: 'Validated by the self-hosted release journey',
          }),
        },
      );
      expect(triage.response.ok).toBe(true);
      expect(triage.body.status).toBe('triaged');
      expect(triage.body.projectionVersion).toBeGreaterThan(0);

      await pollFor(
        'triage projection',
        async () =>
          (
            await jsonRequest<{
              items?: JourneyFinding[];
              availability?: string;
              degradedReasons?: string[];
            }>(
              `/findings?scopeId=${encodeURIComponent(scopeId!)}&triageStatus=triaged&pageSize=100`,
            )
          ).body,
        (result) =>
          isExpectedFindingProjectionReady(
            result,
            TRIAGED_FINDING_READINESS_MODE,
            (item) =>
              item.id === finding.id &&
              item.triage?.status === 'triaged' &&
              item.triage.projectionVersion === triage.body.projectionVersion,
          ),
      );

      const update = await jsonRequest(`/workflows/${workflowId}`, {
        method: 'PUT',
        body: JSON.stringify(
          makeWorkflow(workflow.name, {
            observationStatusCodes: '418',
            changedSurfaceTarget: 'https://example.net',
          }),
        ),
      });
      expect(update.response.ok).toBe(true);

      const currentRunId = await startScopedRun(workflowId!, scopeId!);
      expect((await pollRunStatus(currentRunId, 180_000)).status).toBe('COMPLETED');

      await pollFor(
        'current asset projection',
        async () =>
          (
            await jsonRequest<{ assetValue: string; lastSeenRunId?: string | null }[]>(
              `/scopes/${scopeId}/assets`,
            )
          ).body,
        (assets) => assets.some((asset) => asset.lastSeenRunId === currentRunId),
      );

      const comparison = await jsonRequest<{
        summary?: { observed: number; notObserved: number; notScanned: number };
        items?: { assetValue: string; observationStatus: string; change: string }[];
      }>(
        `/scopes/${scopeId}/assets/compare?baselineRunId=${encodeURIComponent(
          baselineRunId,
        )}&currentRunId=${encodeURIComponent(currentRunId)}`,
      );
      expect(comparison.response.ok).toBe(true);
      expect(comparison.body.items?.some((item) => item.observationStatus === 'observed')).toBe(
        true,
      );
      expect(
        comparison.body.items?.some(
          (item) =>
            item.assetValue.toLowerCase().includes('example.com') &&
            item.observationStatus === 'not-observed' &&
            item.change === 'missing',
        ),
      ).toBe(true);
      expect(
        comparison.body.items?.some(
          (item) =>
            item.assetValue.toLowerCase().includes('example.org') &&
            item.observationStatus === 'not-scanned' &&
            item.change === 'missing',
        ),
      ).toBe(true);
      expect(comparison.body.summary?.notObserved).toBeGreaterThan(0);
      expect(comparison.body.summary?.notScanned).toBeGreaterThan(0);

      const cancellationWorkflow = await createWorkflowFull(
        makeCancellationWorkflow(`release-cancellation-${suffix}`),
      );
      cancellationWorkflowId = cancellationWorkflow.id;
      const cancelledRunId = await startScopedRun(cancellationWorkflow.id, scopeId!);

      const terminal = await pollFor(
        'live terminal output before cancellation',
        async () =>
          (
            await jsonRequest<{
              chunks?: EncodedTerminalChunk[];
            }>(
              `/workflows/runs/${encodeURIComponent(
                cancelledRunId,
              )}/terminal?nodeRef=terminal-demo`,
            )
          ).body,
        (result) => terminalOutputContains(result.chunks, 'terminal-demo', 'Sentris Terminal Demo'),
        60_000,
      );
      expect(terminal.chunks?.length).toBeGreaterThan(0);

      const cancellation = await jsonRequest<{ status?: string; runId?: string }>(
        `/workflows/runs/${encodeURIComponent(cancelledRunId)}/cancel`,
        { method: 'POST' },
      );
      expect(cancellation.response.ok).toBe(true);
      expect(cancellation.body).toMatchObject({
        status: 'cancelled',
        runId: cancelledRunId,
      });
      expect((await pollRunStatus(cancelledRunId, 90_000)).status).toBe('CANCELLED');
    },
  );
});
