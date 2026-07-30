/* eslint-disable no-console -- This file is an explicit, operator-invoked release smoke. */
import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { resolve } from 'node:path';

import { Client } from '@opensearch-project/opensearch';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
  type ScriptDatabaseTarget,
} from '@sentris/local-runtime';
import {
  buildAllFindingObservationIndexPattern,
  buildFindingObservationIndexName,
  buildTenantAnalyticsIndexName,
  createFindingObservationId,
} from '@sentris/shared/finding-observation-id';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';

import {
  FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID,
  buildFindingProjectionControlIndexName,
  reconcileFindingStorageIdIntegrity,
} from '../src/analytics/finding-storage-integrity';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_FIELD,
  FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD,
  FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_PROPERTIES,
  FINDINGS_NORMALIZED_SEVERITY_FIELD,
  buildFindingsFinalIngestPipeline,
  buildFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
  getOrganizationFindingsIndexTemplateContentHash,
  hashFindingsIndexTemplateInvariant,
  hashFindingsMappingInvariant,
  hashFindingsPipelineInvariant,
  normalizeFindingsIndexSettings,
} from '../src/analytics/findings-index-template';
import { OPENSEARCH_TENANT_PROVISIONING_TIMEOUT_MS } from '../src/analytics/opensearch-tenant.service';
import { SecurityAnalyticsService } from '../src/analytics/security-analytics.service';
import * as databaseSchema from '../src/database/schema';
import { assertDatabaseMigrationsCurrent } from '../src/database/migration.guard';
import { loadMigrationPlan } from '../src/database/migrations/checked-migrations';
import { PostgresMigrationDatabase } from '../src/database/migrations/postgres-migration-database';
import { FindingProjectionReconciliationLockService } from '../src/findings/finding-projection-reconciliation-lock.service';
import { FindingTriageReconcilerService } from '../src/findings/finding-triage-reconciler.service';
import { FindingTriageRepository } from '../src/findings/finding-triage.repository';

type ScriptEnvironment = Record<string, string | undefined>;

export const FINDINGS_OPENSEARCH_DATABASE_URL_ENV =
  'FINDINGS_OPENSEARCH_SMOKE_DATABASE_URL' as const;
export const FINDINGS_OPENSEARCH_MIN_RELEASE_PIT_HOLD_MS = 125_000;
export const FINDINGS_OPENSEARCH_DEFAULT_PIT_HOLD_MS = FINDINGS_OPENSEARCH_MIN_RELEASE_PIT_HOLD_MS;
export const FINDINGS_OPENSEARCH_WORK_TIMEOUT_MS = 960_000;
export const FINDINGS_OPENSEARCH_WORK_DRAIN_TIMEOUT_MS = 90_000;
export const FINDINGS_OPENSEARCH_CLEANUP_TIMEOUT_MS = 180_000;
export const FINDINGS_OPENSEARCH_CLEANUP_DRAIN_TIMEOUT_MS = 60_000;
export const FINDINGS_OPENSEARCH_CLOSE_TIMEOUT_MS = 30_000;
export const FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS = 1_350_000;
export const FINDINGS_OPENSEARCH_TENANT_SERVER_COMPLETION_BOUND_MS =
  OPENSEARCH_TENANT_PROVISIONING_TIMEOUT_MS + 5_000;
export const FINDINGS_OPENSEARCH_TENANT_REQUEST_TIMEOUT_MS = 88_000;

const FINDINGS_OPENSEARCH_REQUEST_TIMEOUT_MS = 20_000;
const FINDINGS_OPENSEARCH_STATEMENT_TIMEOUT_MS = 12_000;
const FINDINGS_OPENSEARCH_QUERY_TIMEOUT_MS = 15_000;
const FINDINGS_OPENSEARCH_LOCK_TIMEOUT_MS = 3_000;
export const FINDINGS_OPENSEARCH_RECOVERY_TIMEOUT_MS = 55_000;
const FINDINGS_OPENSEARCH_PHASE_TIMEOUTS = {
  verifyTopologyAndBootstrap: 90_000,
  verifyFirstUseAndCorpus: 180_000,
  verifyDriftAndFailureSemantics: 240_000,
  verifyLargeReadModels: 480_000,
  verifyPitAndDiscovery: 300_000,
} as const;

const DESTRUCTIVE_OPT_IN_ENV = 'SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE';
const DISPOSABLE_PROJECT_ENV = 'SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT';

export interface FindingsOpenSearchAcceptanceConfig {
  instance: string;
  composeProjectName: string;
  apiBaseUrl: string;
  internalToken: string;
  openSearchUrl: string;
  redactedOpenSearchUrl: string;
  databaseTarget: ScriptDatabaseTarget;
  pitHoldMs: number;
  releaseMode: boolean;
}

function required(env: ScriptEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be set for the findings OpenSearch acceptance`);
  return value;
}

function normalizeAbsoluteUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function redactOpenSearchTarget(value: string): string {
  const parsed = new URL(value);
  if (parsed.password) parsed.password = '***';
  return parsed.toString();
}

export function resolveFindingsOpenSearchAcceptanceConfig(
  env: ScriptEnvironment = process.env,
): FindingsOpenSearchAcceptanceConfig {
  const instance = env.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error(
      'SENTRIS_INSTANCE must be set explicitly for the findings OpenSearch acceptance',
    );
  }
  if (!/^\d$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }
  if (env.CI !== 'true' && env[DESTRUCTIVE_OPT_IN_ENV] !== 'true') {
    throw new Error(
      `Findings OpenSearch acceptance is destructive; run in CI or set ${DESTRUCTIVE_OPT_IN_ENV}=true`,
    );
  }
  if (env[DISPOSABLE_PROJECT_ENV] !== 'true') {
    throw new Error(`${DISPOSABLE_PROJECT_ENV}=true is required`);
  }

  const composeProjectName = required(env, 'COMPOSE_PROJECT_NAME');
  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/i.test(composeProjectName)) {
    throw new Error('COMPOSE_PROJECT_NAME contains unsupported characters');
  }
  const databaseUrl = required(env, FINDINGS_OPENSEARCH_DATABASE_URL_ENV);
  const databaseTarget = getScriptDatabaseTarget({
    env: { ...env, [FINDINGS_OPENSEARCH_DATABASE_URL_ENV]: databaseUrl },
    overrideEnvVar: FINDINGS_OPENSEARCH_DATABASE_URL_ENV,
  });
  const apiBaseUrl = normalizeAbsoluteUrl(
    required(env, 'FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL'),
    'FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL',
  );
  const openSearchUrl = normalizeAbsoluteUrl(
    required(env, 'FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL'),
    'FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL',
  );
  const internalToken = required(env, 'FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN');
  const releaseMode = env.CI === 'true' || env.SENTRIS_FINDINGS_OPENSEARCH_RELEASE_MODE === 'true';
  const pitHoldRaw =
    env.FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS?.trim() ||
    String(FINDINGS_OPENSEARCH_DEFAULT_PIT_HOLD_MS);
  if (!/^\d+$/.test(pitHoldRaw)) {
    throw new Error('FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS must be a non-negative integer');
  }
  const pitHoldMs = Number(pitHoldRaw);
  if (!Number.isSafeInteger(pitHoldMs)) {
    throw new Error('FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS is outside the supported range');
  }
  if (releaseMode && pitHoldMs < FINDINGS_OPENSEARCH_MIN_RELEASE_PIT_HOLD_MS) {
    throw new Error(
      `Findings OpenSearch release PIT hold must be at least ${FINDINGS_OPENSEARCH_MIN_RELEASE_PIT_HOLD_MS}ms`,
    );
  }

  return {
    instance,
    composeProjectName,
    apiBaseUrl,
    internalToken,
    openSearchUrl,
    redactedOpenSearchUrl: redactOpenSearchTarget(openSearchUrl),
    databaseTarget,
    pitHoldMs,
    releaseMode,
  };
}

export interface FindingsOpenSearchDocumentResource {
  indexName: string;
  documentId: string;
}

export interface FindingsOpenSearchResourceManifest {
  organizationIds: string[];
  indexNames: string[];
  indexTemplateNames: string[];
  documents: FindingsOpenSearchDocumentResource[];
  auditRowIds: string[];
  outboxEventIds: string[];
  triageRowIds: string[];
  scopeIds: string[];
  workflowRunIds: string[];
  workflowIds: string[];
}

function assertExactResourceName(value: string, label: string): void {
  if (!value || value === '_all' || /[*?,[\]]/.test(value)) {
    throw new Error(`${label} must be an exact resource name without a wildcard`);
  }
}

const OPENSEARCH_EXACT_INDEX_TARGET_CHUNK_SIZE = 8;

export function chunkExactOpenSearchIndexNames(indexNames: string[]): string[][] {
  for (const indexName of indexNames) {
    assertExactResourceName(indexName, 'OpenSearch index');
  }
  const chunks: string[][] = [];
  for (
    let offset = 0;
    offset < indexNames.length;
    offset += OPENSEARCH_EXACT_INDEX_TARGET_CHUNK_SIZE
  ) {
    chunks.push(indexNames.slice(offset, offset + OPENSEARCH_EXACT_INDEX_TARGET_CHUNK_SIZE));
  }
  return chunks;
}

export class FindingsOpenSearchResourceLedger {
  private readonly organizationIds = new Set<string>();
  private readonly indexNames = new Set<string>();
  private readonly indexTemplateNames = new Set<string>();
  private readonly documents = new Map<string, FindingsOpenSearchDocumentResource>();
  private readonly auditRowIds = new Set<string>();
  private readonly outboxEventIds = new Set<string>();
  private readonly triageRowIds = new Set<string>();
  private readonly scopeIds = new Set<string>();
  private readonly workflowRunIds = new Set<string>();
  private readonly workflowIds = new Set<string>();

  trackOrganization(value: string): void {
    assertExactResourceName(value, 'Organization ID');
    this.organizationIds.add(value);
    this.trackIndex(buildFindingProjectionControlIndexName(value));
  }

  trackIndex(value: string): void {
    assertExactResourceName(value, 'OpenSearch index');
    this.indexNames.add(value);
  }

  trackIndexTemplate(value: string): void {
    assertExactResourceName(value, 'OpenSearch index template');
    this.indexTemplateNames.add(value);
  }

  trackDocument(indexName: string, documentId: string): void {
    assertExactResourceName(indexName, 'OpenSearch index');
    assertExactResourceName(documentId, 'OpenSearch document ID');
    this.documents.set(`${indexName}\u0000${documentId}`, { indexName, documentId });
  }

  trackTriageRow(value: string): void {
    assertExactResourceName(value, 'Finding triage row ID');
    this.triageRowIds.add(value);
  }

  trackAuditRow(value: string): void {
    assertExactResourceName(value, 'Audit row ID');
    this.auditRowIds.add(value);
  }

  trackOutboxEvent(value: string): void {
    assertExactResourceName(value, 'Outbox event ID');
    this.outboxEventIds.add(value);
  }

  trackScope(value: string): void {
    assertExactResourceName(value, 'Scope ID');
    this.scopeIds.add(value);
  }

  trackWorkflowRun(value: string): void {
    assertExactResourceName(value, 'Workflow run ID');
    this.workflowRunIds.add(value);
  }

  trackWorkflow(value: string): void {
    assertExactResourceName(value, 'Workflow ID');
    this.workflowIds.add(value);
  }

  snapshot(): FindingsOpenSearchResourceManifest {
    return {
      organizationIds: [...this.organizationIds],
      indexNames: [...this.indexNames],
      indexTemplateNames: [...this.indexTemplateNames],
      documents: [...this.documents.values()],
      auditRowIds: [...this.auditRowIds],
      outboxEventIds: [...this.outboxEventIds],
      triageRowIds: [...this.triageRowIds],
      scopeIds: [...this.scopeIds],
      workflowRunIds: [...this.workflowRunIds],
      workflowIds: [...this.workflowIds],
    };
  }
}

export interface FindingsCleanupStatement {
  name: string;
  sql: string;
  params: unknown[];
}

function exactArrayCleanup(
  name: string,
  table: string,
  column: string,
  cast: 'text' | 'uuid' | 'varchar',
  values: string[],
): FindingsCleanupStatement | null {
  if (values.length === 0) return null;
  return {
    name,
    sql: `DELETE FROM ${table} WHERE ${column} = ANY($1::${cast}[])`,
    params: [[...values]],
  };
}

export function buildFindingsCleanupStatements(
  manifest: FindingsOpenSearchResourceManifest,
): FindingsCleanupStatement[] {
  return [
    exactArrayCleanup('audit logs', 'audit_logs', 'id', 'uuid', manifest.auditRowIds),
    exactArrayCleanup('outbox events', 'outbox_events', 'id', 'uuid', manifest.outboxEventIds),
    exactArrayCleanup('finding triage', 'finding_triage', 'id', 'uuid', manifest.triageRowIds),
    exactArrayCleanup('workflow runs', 'workflow_runs', 'run_id', 'text', manifest.workflowRunIds),
    exactArrayCleanup('scopes', 'scopes', 'id', 'uuid', manifest.scopeIds),
    exactArrayCleanup('workflows', 'workflows', 'id', 'uuid', manifest.workflowIds),
    exactArrayCleanup(
      'projection reconciliation',
      'finding_projection_reconciliation',
      'organization_id',
      'varchar',
      manifest.organizationIds,
    ),
  ].filter((statement): statement is FindingsCleanupStatement => statement !== null);
}

const FINDINGS_OPENSEARCH_ROLLBACK_TIMEOUT_MS = 5_000;

async function rollbackPostgresCleanup(
  client: Pick<PoolClient, 'query' | 'release'>,
  markClientReleased: () => void,
  timeoutMs = FINDINGS_OPENSEARCH_ROLLBACK_TIMEOUT_MS,
): Promise<void> {
  let timedOut = false;
  const rollbackQuery = {
    text: 'ROLLBACK',
    query_timeout: timeoutMs,
  };
  const rollbackPromise = client.query(rollbackQuery);
  const timer = setTimeout(() => {
    timedOut = true;
    markClientReleased();
    client.release(true);
  }, timeoutMs);
  try {
    await rollbackPromise;
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `PostgreSQL cleanup rollback exceeded its ${timeoutMs}ms deadline and settled after connection destruction`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) {
    throw new Error(
      `PostgreSQL cleanup rollback exceeded its ${timeoutMs}ms deadline and settled after connection destruction`,
    );
  }
}

export async function executeAbortablePostgresTransaction(
  client: Pick<PoolClient, 'query' | 'release'>,
  statements: FindingsCleanupStatement[],
  signal: AbortSignal,
  rollbackTimeoutMs = FINDINGS_OPENSEARCH_ROLLBACK_TIMEOUT_MS,
): Promise<void> {
  let transactionStarted = false;
  let destroyClient = false;
  let clientReleased = false;
  try {
    signal.throwIfAborted();
    const beginQuery = {
      text: 'BEGIN',
      query_timeout: FINDINGS_OPENSEARCH_QUERY_TIMEOUT_MS,
    };
    await client.query(beginQuery);
    transactionStarted = true;
    signal.throwIfAborted();

    for (const statement of statements) {
      signal.throwIfAborted();
      const cleanupQuery = {
        text: statement.sql,
        values: statement.params,
        query_timeout: FINDINGS_OPENSEARCH_QUERY_TIMEOUT_MS,
      };
      await client.query(cleanupQuery);
      signal.throwIfAborted();
    }

    signal.throwIfAborted();
    const commitQuery = {
      text: 'COMMIT',
      query_timeout: FINDINGS_OPENSEARCH_QUERY_TIMEOUT_MS,
    };
    await client.query(commitQuery);
    transactionStarted = false;
    signal.throwIfAborted();
  } catch (error) {
    if (transactionStarted) {
      try {
        await rollbackPostgresCleanup(
          client,
          () => {
            clientReleased = true;
          },
          rollbackTimeoutMs,
        );
        transactionStarted = false;
      } catch (rollbackError) {
        destroyClient = true;
        throw new AggregateError(
          [error, rollbackError],
          'PostgreSQL cleanup failed and its bounded rollback did not complete',
        );
      }
    }
    throw error;
  } finally {
    if (!clientReleased) client.release(destroyClient);
  }
}

export async function executeConnectedAbortablePostgresTransaction(
  pool: Pick<Pool, 'connect'>,
  statements: FindingsCleanupStatement[],
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const client = await pool.connect();
  try {
    signal.throwIfAborted();
  } catch (error) {
    client.release();
    throw error;
  }
  await executeAbortablePostgresTransaction(client, statements, signal);
}

export interface FindingsOpenSearchAcceptancePlan {
  verifyTopologyAndBootstrap(signal: AbortSignal): Promise<unknown>;
  verifyFirstUseAndCorpus(signal: AbortSignal): Promise<unknown>;
  verifyDriftAndFailureSemantics(signal: AbortSignal): Promise<unknown>;
  verifyLargeReadModels(signal: AbortSignal): Promise<unknown>;
  verifyPitAndDiscovery(signal: AbortSignal): Promise<unknown>;
  cleanup(signal: AbortSignal): Promise<unknown>;
}

type FindingsAcceptancePhaseName = keyof Omit<FindingsOpenSearchAcceptancePlan, 'cleanup'>;

interface FindingsDeadlineScheduler {
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
}

export interface FindingsOpenSearchAcceptanceDeadlineOptions {
  phaseTimeoutMs?: Partial<Record<FindingsAcceptancePhaseName, number>>;
  workTimeoutMs?: number;
  workDrainTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  cleanupDrainTimeoutMs?: number;
  closeTimeoutMs?: number;
  totalTimeoutMs?: number;
  scheduler?: FindingsDeadlineScheduler;
}

export class FindingsAcceptanceDeadlineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FindingsAcceptanceDeadlineError';
  }
}

export class FindingsAcceptanceDrainError extends Error {
  readonly cleanupUnsafe = true;

  constructor(message: string) {
    super(message);
    this.name = 'FindingsAcceptanceDrainError';
  }
}

export interface FindingsReferencedAbortScope {
  signal: AbortSignal;
  dispose(): void;
}

export function createReferencedAbortScope(
  timeoutMs: number,
  label: string,
  parentSignal?: AbortSignal,
): FindingsReferencedAbortScope {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`${label} timeout must be a positive safe integer`);
  }
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? new Error(`${label} parent aborted`));
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const timer = controller.signal.aborted
    ? undefined
    : setTimeout(
        () =>
          controller.abort(
            new FindingsAcceptanceDeadlineError(`${label} exceeded its ${timeoutMs}ms deadline`),
          ),
        timeoutMs,
      );
  return {
    signal: controller.signal,
    dispose() {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

type SettledOperation<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

async function executeCooperativeDeadline<T>(
  label: string,
  timeoutMs: number,
  drainTimeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  scheduler: FindingsDeadlineScheduler,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`${label} timeout must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1) {
    throw new Error(`${label} drain timeout must be a positive safe integer`);
  }

  const controller = new AbortController();
  const deadlineError = new FindingsAcceptanceDeadlineError(
    `${label} exceeded its ${timeoutMs}ms cooperative deadline`,
  );
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? deadlineError);
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const deadlineTimer = scheduler.schedule(() => controller.abort(deadlineError), timeoutMs);
  const operationOutcome: Promise<SettledOperation<T>> = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (value): SettledOperation<T> => ({ status: 'fulfilled', value }),
      (reason): SettledOperation<T> => ({ status: 'rejected', reason }),
    );
  const aborted = new Promise<'aborted'>((resolveAbort) => {
    if (controller.signal.aborted) resolveAbort('aborted');
    else {
      controller.signal.addEventListener('abort', () => resolveAbort('aborted'), { once: true });
    }
  });

  const release = () => {
    scheduler.cancel(deadlineTimer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  };
  const first = await Promise.race([operationOutcome, aborted]);
  if (first !== 'aborted') {
    release();
    if (first.status === 'rejected') throw first.reason;
    return first.value;
  }

  const drainExpired = Symbol('drain-expired');
  const drainTimerPromise = new Promise<typeof drainExpired>((resolveDrain) => {
    const handle = scheduler.schedule(() => resolveDrain(drainExpired), drainTimeoutMs);
    operationOutcome.finally(() => scheduler.cancel(handle)).catch(() => undefined);
  });
  const drained = await Promise.race([operationOutcome, drainTimerPromise]);
  release();
  if (drained === drainExpired) {
    throw new FindingsAcceptanceDrainError(
      `${label} did not settle within ${drainTimeoutMs}ms after abort; exact cleanup was not started because work may still be mutating`,
    );
  }

  const cause = drained.status === 'rejected' ? drained.reason : undefined;
  const reason = controller.signal.reason;
  if (reason instanceof FindingsAcceptanceDeadlineError) {
    throw new FindingsAcceptanceDeadlineError(reason.message, { cause });
  }
  if (reason instanceof Error) {
    throw new FindingsAcceptanceDeadlineError(`${label} was aborted: ${reason.message}`, {
      cause,
    });
  }
  throw new FindingsAcceptanceDeadlineError(`${label} was aborted`, { cause });
}

export async function executeFindingsOpenSearchAcceptancePlan(
  plan: FindingsOpenSearchAcceptancePlan,
  options: FindingsOpenSearchAcceptanceDeadlineOptions = {},
): Promise<void> {
  const scheduler: FindingsDeadlineScheduler = options.scheduler ?? {
    schedule: setTimeout,
    cancel: clearTimeout,
  };
  const workTimeoutMs = options.workTimeoutMs ?? FINDINGS_OPENSEARCH_WORK_TIMEOUT_MS;
  const workDrainTimeoutMs =
    options.workDrainTimeoutMs ?? FINDINGS_OPENSEARCH_WORK_DRAIN_TIMEOUT_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? FINDINGS_OPENSEARCH_CLEANUP_TIMEOUT_MS;
  const cleanupDrainTimeoutMs =
    options.cleanupDrainTimeoutMs ?? FINDINGS_OPENSEARCH_CLEANUP_DRAIN_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? FINDINGS_OPENSEARCH_CLOSE_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS;
  if (
    workTimeoutMs + workDrainTimeoutMs + cleanupTimeoutMs + cleanupDrainTimeoutMs + closeTimeoutMs >
    totalTimeoutMs
  ) {
    throw new Error('Findings acceptance deadlines do not reserve standalone cleanup headroom');
  }
  const totalController = new AbortController();
  const planDeadlineMs = totalTimeoutMs - closeTimeoutMs;
  const totalTimer = scheduler.schedule(
    () =>
      totalController.abort(
        new FindingsAcceptanceDeadlineError(
          `findings acceptance plan exceeded its absolute ${planDeadlineMs}ms deadline`,
        ),
      ),
    planDeadlineMs,
  );
  const phaseTimeouts = {
    ...FINDINGS_OPENSEARCH_PHASE_TIMEOUTS,
    ...options.phaseTimeoutMs,
  };
  const phases = [
    ['topology/bootstrap', 'verifyTopologyAndBootstrap'],
    ['first-use/corpus', 'verifyFirstUseAndCorpus'],
    ['drift/failures', 'verifyDriftAndFailureSemantics'],
    ['large read models', 'verifyLargeReadModels'],
    ['PIT/discovery', 'verifyPitAndDiscovery'],
  ] as const;

  let primaryError: unknown;
  try {
    await executeCooperativeDeadline(
      'findings acceptance work',
      workTimeoutMs,
      workDrainTimeoutMs,
      async (workSignal) => {
        for (const [label, phaseName] of phases) {
          await executeCooperativeDeadline(
            label,
            phaseTimeouts[phaseName],
            workDrainTimeoutMs,
            (phaseSignal) => plan[phaseName](phaseSignal),
            workSignal,
            scheduler,
          );
        }
      },
      totalController.signal,
      scheduler,
    );
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  if (primaryError instanceof FindingsAcceptanceDrainError) {
    cleanupError = new Error(
      'Exact cleanup was intentionally not started because acceptance work did not stop after abort',
    );
  } else {
    try {
      await executeCooperativeDeadline(
        'exact findings cleanup',
        cleanupTimeoutMs,
        cleanupDrainTimeoutMs,
        (cleanupSignal) => plan.cleanup(cleanupSignal),
        totalController.signal,
        scheduler,
      );
    } catch (error) {
      cleanupError = error;
    }
  }

  scheduler.cancel(totalTimer);
  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Findings OpenSearch acceptance and exact cleanup both failed',
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
}

export function assertSupportedOpenSearchVersion(version: string): void {
  if (!/^2\.11(?:\.|$)/.test(version)) {
    throw new Error(`OpenSearch 2.11.x is required; received ${version || 'unknown'}`);
  }
}

export function assertCompleteOpenSearchResponse(
  response: unknown,
  operation: string,
): asserts response is {
  timed_out?: boolean;
  _shards: { total?: number; successful?: number; failed?: number };
  hits: { hits: unknown[] };
} {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    throw new Error(`${operation} returned a malformed response`);
  }
  const body = response as Record<string, unknown>;
  const shards = body._shards;
  const hits = body.hits;
  if (
    typeof shards !== 'object' ||
    shards === null ||
    Array.isArray(shards) ||
    typeof hits !== 'object' ||
    hits === null ||
    Array.isArray(hits) ||
    !Array.isArray((hits as Record<string, unknown>).hits)
  ) {
    throw new Error(`${operation} returned a malformed response`);
  }
  if (body.timed_out === true || Number((shards as Record<string, unknown>).failed ?? 0) > 0) {
    throw new Error(`${operation} returned an incomplete response`);
  }
}

type FindingSchemaClassification = 'canonical' | 'legacy' | 'invalid' | 'rejected';

export interface FindingsCorpusInput {
  organizationId: string;
  workflowId: string;
  runId: string;
  scopeId: string;
  componentId: string;
  nodeRef: string;
}

export interface FindingsCorpusFixture {
  name: string;
  documentId: string;
  document: Record<string, unknown>;
  expectedClassification: FindingSchemaClassification;
}

function canonicalFindingDocument(
  input: FindingsCorpusInput,
  sourceFindingId: string,
  observedAt: string,
  evidence: unknown,
  source: unknown,
): { documentId: string; document: Record<string, unknown> } {
  const documentId = createFindingObservationId({
    organizationId: input.organizationId,
    workflowId: input.workflowId,
    runId: input.runId,
    scopeId: input.scopeId,
    componentId: input.componentId,
    nodeRef: input.nodeRef,
    sourceFindingId,
  });
  return {
    documentId,
    document: {
      contract: 'sentris.finding-observation',
      schema_version: 1,
      finding_id: documentId,
      finding_hash: `hash-${sourceFindingId}`,
      '@timestamp': observedAt,
      observed_at: observedAt,
      scanner: 'sentris-findings-opensearch-acceptance',
      severity: 'high',
      title: `Acceptance finding ${sourceFindingId}`,
      description: `Disposable OpenSearch acceptance fixture ${sourceFindingId}`,
      evidence,
      source,
      asset_key: `asset-${sourceFindingId}`,
      run_id: input.runId,
      workflow_id: input.workflowId,
      workflow_name: 'Findings OpenSearch acceptance',
      component_id: input.componentId,
      sentris: {
        organization_id: input.organizationId,
        workflow_id: input.workflowId,
        workflow_name: 'Findings OpenSearch acceptance',
        run_id: input.runId,
        scope_id: input.scopeId,
        component_id: input.componentId,
        node_ref: input.nodeRef,
        asset_key: `asset-${sourceFindingId}`,
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: documentId,
      },
    },
  };
}

export function buildFindingsCorpusFixtures(input: FindingsCorpusInput): FindingsCorpusFixture[] {
  const utc = '2026-07-29T10:34:56.000Z';
  const definitions: {
    name: string;
    expectedClassification: FindingSchemaClassification;
    evidence: unknown;
    source: unknown;
    timestamp?: string;
    mutate?: (document: Record<string, unknown>) => void;
    forgeDocumentId?: boolean;
  }[] = [
    {
      name: 'canonical-object',
      expectedClassification: 'canonical',
      evidence: { kind: 'object', nested: { exact: true } },
      source: { kind: 'object', scanner: 'acceptance' },
    },
    {
      name: 'canonical-array',
      expectedClassification: 'canonical',
      evidence: ['evidence-array', { nested: true }],
      source: ['source-array', 7],
    },
    {
      name: 'canonical-scalar',
      expectedClassification: 'canonical',
      evidence: 'evidence-scalar',
      source: 42,
    },
    {
      name: 'canonical-null',
      expectedClassification: 'canonical',
      evidence: null,
      source: null,
    },
    {
      name: 'marker-absent-legacy',
      expectedClassification: 'legacy',
      evidence: { legacy: true },
      source: { legacy: true },
      mutate: (document) => {
        delete document.contract;
        delete document.schema_version;
      },
    },
    {
      name: 'malformed-marker',
      expectedClassification: 'invalid',
      evidence: { malformed: true },
      source: { malformed: true },
      mutate: (document) => {
        document.contract = 'sentris.finding-observation.invalid';
      },
    },
    {
      name: 'null-markers',
      expectedClassification: 'invalid',
      evidence: null,
      source: null,
      mutate: (document) => {
        document.contract = null;
        document.schema_version = null;
      },
    },
    {
      name: 'forged-document-id',
      expectedClassification: 'rejected',
      evidence: { forged: true },
      source: { forged: true },
      forgeDocumentId: true,
    },
    {
      name: 'utc-timestamp',
      expectedClassification: 'canonical',
      evidence: { timestamp: 'utc' },
      source: { timestamp: 'utc' },
      timestamp: '2026-07-29T12:34:56.123Z',
    },
    {
      name: 'offset-timestamp',
      expectedClassification: 'invalid',
      evidence: { timestamp: 'offset' },
      source: { timestamp: 'offset' },
      timestamp: '2026-07-29T12:34:56+02:00',
    },
    {
      name: 'missing-required-field',
      expectedClassification: 'invalid',
      evidence: { missing: 'description' },
      source: { missing: 'description' },
      mutate: (document) => {
        delete document.description;
      },
    },
  ];

  return definitions.map((definition) => {
    const built = canonicalFindingDocument(
      input,
      definition.name,
      definition.timestamp ?? utc,
      definition.evidence,
      definition.source,
    );
    definition.mutate?.(built.document);
    const documentId = definition.forgeDocumentId
      ? createFindingObservationId({
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          runId: input.runId,
          scopeId: input.scopeId,
          componentId: input.componentId,
          nodeRef: input.nodeRef,
          sourceFindingId: `${definition.name}-forged-storage-id`,
        })
      : built.documentId;
    return {
      name: definition.name,
      documentId,
      document: built.document,
      expectedClassification: definition.expectedClassification,
    };
  });
}

export interface LargeFindingsFixtureInput {
  organizationId: string;
  workflowId: string;
  scopeId: string;
  scopedRunId: string;
  unscopedRunId: string;
  count: number;
  now: Date;
}

export interface LargeFindingsFixture {
  organizationId: string;
  documentId: string;
  triageRowId: string;
  document: Record<string, unknown>;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  triageStatus: 'fixed' | 'triaged' | 'in_progress' | 'new';
  componentId: 'component-a' | 'component-b' | 'component-c';
  runId: string;
  createdAt: Date;
}

export function buildLargeFindingsFixtures(
  input: LargeFindingsFixtureInput,
): LargeFindingsFixture[] {
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 100_000) {
    throw new Error('Large findings fixture count must be an integer from 1 to 100000');
  }
  const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
  const triageStatuses = ['fixed', 'triaged', 'in_progress', 'new'] as const;
  const componentIds = ['component-a', 'component-b', 'component-c'] as const;

  return Array.from({ length: input.count }, (_, index) => {
    const severity = severities[index % severities.length]!;
    const triageStatus = triageStatuses[index % triageStatuses.length]!;
    const componentId = componentIds[index % componentIds.length]!;
    const runId = index % 2 === 0 ? input.scopedRunId : input.unscopedRunId;
    const createdAt = new Date(input.now.getTime() - index);
    const sourceFindingId = `large-${index.toString().padStart(5, '0')}`;
    const documentId = createFindingObservationId({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      runId,
      scopeId: runId === input.scopedRunId ? input.scopeId : null,
      componentId,
      nodeRef: `node-${index % 7}`,
      sourceFindingId,
    });
    const timestamp = createdAt.toISOString();
    return {
      organizationId: input.organizationId,
      documentId,
      triageRowId: randomUUID(),
      severity,
      triageStatus,
      componentId,
      runId,
      createdAt,
      document: {
        contract: 'sentris.finding-observation',
        schema_version: 1,
        finding_id: documentId,
        finding_hash: `hash-${sourceFindingId}`,
        '@timestamp': timestamp,
        observed_at: timestamp,
        scanner: 'sentris-findings-opensearch-acceptance',
        severity,
        title: `Large acceptance finding ${index}`,
        description: `Disposable large findings fixture ${index}`,
        evidence: { sequence: index },
        source: { suite: 'findings-opensearch-acceptance' },
        asset_key: `asset-${index % 29}`,
        run_id: runId,
        workflow_id: input.workflowId,
        workflow_name: 'Large findings acceptance',
        component_id: componentId,
        sentris: {
          organization_id: input.organizationId,
          workflow_id: input.workflowId,
          workflow_name: 'Large findings acceptance',
          run_id: runId,
          scope_id: runId === input.scopedRunId ? input.scopeId : null,
          component_id: componentId,
          node_ref: `node-${index % 7}`,
          asset_key: `asset-${index % 29}`,
          contract_validated: true,
          contract_source_validated: true,
          contract_document_id: documentId,
        },
      },
    };
  });
}

export async function verifyInjectedOpenSearchFailureSemantics(): Promise<string[]> {
  const cases: { name: string; body: unknown }[] = [
    {
      name: 'timed-out',
      body: {
        timed_out: true,
        _shards: { total: 1, successful: 1, failed: 0 },
        hits: { total: { value: 0 }, hits: [] },
      },
    },
    {
      name: 'partial',
      body: {
        timed_out: false,
        _shards: { total: 2, successful: 1, failed: 1 },
        hits: { total: { value: 0 }, hits: [] },
      },
    },
    {
      name: 'malformed',
      body: {
        timed_out: false,
        _shards: { total: 1, successful: 1, failed: 0 },
      },
    },
    {
      name: 'malformed-total',
      body: {
        timed_out: false,
        _shards: { total: 1, successful: 1, failed: 0 },
        hits: { total: { value: 'not-a-number' }, hits: [] },
      },
    },
    {
      name: 'inexact-total-relation',
      body: {
        timed_out: false,
        _shards: { total: 1, successful: 1, failed: 0 },
        hits: { total: { value: 10_000, relation: 'gte' }, hits: [] },
      },
    },
  ];
  const results: string[] = [];

  for (const testCase of cases) {
    const service = new SecurityAnalyticsService({
      isClientEnabled: () => true,
      getClient: () => ({
        search: async () => ({ body: testCase.body }),
      }),
    } as never);
    Object.defineProperty(service, 'logger', {
      value: { debug() {}, error() {}, log() {}, verbose() {}, warn() {} },
    });
    let status: number | undefined;
    try {
      await service.queryFindings('findings-failure-probe', {
        query: { match_all: {} },
        size: 1,
      });
    } catch (error) {
      status =
        typeof (error as { getStatus?: unknown })?.getStatus === 'function'
          ? (error as { getStatus(): number }).getStatus()
          : undefined;
    }
    if (status !== 503) {
      throw new Error(
        `${testCase.name} OpenSearch response did not surface as service unavailable`,
      );
    }
    results.push(`${testCase.name}:unavailable`);
  }

  const malformedDiscoveryService = new SecurityAnalyticsService({
    isClientEnabled: () => true,
    getClient: () => ({
      search: async () => ({
        body: {
          timed_out: false,
          _shards: { total: 1, successful: 1, failed: 0 },
          aggregations: {
            sentris_observation_organizations: {
              buckets: [
                {
                  key: {
                    index_name: 42,
                    organization_id: 'findings-failure-probe',
                  },
                },
              ],
            },
          },
        },
      }),
    }),
  } as never);
  Object.defineProperty(malformedDiscoveryService, 'logger', {
    value: { debug() {}, error() {}, log() {}, verbose() {}, warn() {} },
  });
  let discoveryStatus: number | undefined;
  try {
    await malformedDiscoveryService.listFindingObservationOrganizationsPage(undefined, 100);
  } catch (error) {
    discoveryStatus =
      typeof (error as { getStatus?: unknown })?.getStatus === 'function'
        ? (error as { getStatus(): number }).getStatus()
        : undefined;
  }
  if (discoveryStatus !== 503) {
    throw new Error('Malformed discovery bucket did not surface as service unavailable');
  }
  results.push('malformed-discovery-bucket:unavailable');
  return results;
}

const GLOBAL_FINDINGS_TEMPLATE_NAME = 'security-findings-template';
const LARGE_FINDINGS_COUNT = 10_001;
const DISCOVERY_ORGANIZATION_COUNT = 105;
const DISCOVERY_LOCK_ID = '\u001esentris:finding-observation-discovery:v1';
const DISCOVERY_STATE_ROW_ID = '\u001esentris:finding-observation-discovery:v1';

type SmokeDatabase = NodePgDatabase<typeof databaseSchema>;

interface FindingsAcceptanceIdentifiers {
  suiteId: string;
  primaryOrganizationId: string;
  corpusOrganizationId: string;
  foreignOrganizationId: string;
  workflowId: string;
  scopeId: string;
  scopedRunId: string;
  unscopedRunId: string;
  actorId: string;
}

interface DiscoveryStateSnapshot {
  exists: boolean;
  row?: {
    organization_id: string;
    cursor: string | null;
    cycle_started_at: Date | null;
    cycle_cutoff: Date | null;
    checked: number;
    repaired: number;
    failed: number;
    last_completed_at: Date | null;
    reconciled_through: Date | null;
    updated_at: Date;
  };
}

export interface FindingsGlobalBootstrapSnapshot {
  pipeline: Record<string, unknown>;
  template: Record<string, unknown>;
}

interface FindingsAcceptanceContext {
  config: FindingsOpenSearchAcceptanceConfig;
  client: Client;
  pool: Pool;
  db: SmokeDatabase;
  analytics: SecurityAnalyticsService;
  repository: FindingTriageRepository;
  reconciler: FindingTriageReconcilerService;
  lockService: FindingProjectionReconciliationLockService;
  ledger: FindingsOpenSearchResourceLedger;
  ids: FindingsAcceptanceIdentifiers;
  corpusFixtures: FindingsCorpusFixture[];
  largeFixtures: LargeFindingsFixture[];
  globalBootstrapSnapshot?: FindingsGlobalBootstrapSnapshot;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  activateSignal(signal: AbortSignal): void;
  runRecoveryOperation(operation: () => Promise<void>): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  log(message: string): void;
}

export interface FindingsOpenSearchAcceptanceDependencies {
  createOpenSearchClient?(config: FindingsOpenSearchAcceptanceConfig): Client;
  createPool?(connectionString: string): Pool;
  fetchImpl?: typeof fetch;
  randomUuid?(): string;
  now?(): Date;
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Findings OpenSearch acceptance assertion failed: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const meta = isRecord(error.meta) ? error.meta : undefined;
  return typeof meta?.statusCode === 'number' ? meta.statusCode : undefined;
}

function exactJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createAbortableOpenSearchClient<TClient extends object>(
  client: TClient,
  getActiveSignal: () => AbortSignal,
): TClient {
  const proxies = new WeakMap<object, object>();
  const wrap = <T extends object>(target: T): T => {
    const existing = proxies.get(target);
    if (existing) return existing as T;
    const proxy = new Proxy(target, {
      get(currentTarget, property, receiver) {
        const value = Reflect.get(currentTarget, property, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            const signal = getActiveSignal();
            signal.throwIfAborted();
            const result = Reflect.apply(value, currentTarget, args) as unknown;
            if (!isRecord(result) || typeof (result as { then?: unknown }).then !== 'function') {
              return result;
            }
            const request = result as unknown as Promise<unknown> & { abort?: () => void };
            const abortRequest = () => {
              try {
                request.abort?.();
              } catch {
                // The request promise still determines the exact transport outcome.
              }
            };
            signal.addEventListener('abort', abortRequest, { once: true });
            return Promise.resolve(request).finally(() => {
              signal.removeEventListener('abort', abortRequest);
            });
          };
        }
        if (typeof value === 'object' && value !== null) return wrap(value);
        return value;
      },
    });
    proxies.set(target, proxy);
    return proxy;
  };
  return wrap(client);
}

export async function sleepWithAbort(
  ms: number,
  signal: AbortSignal,
  sleepImpl?: (ms: number) => Promise<void>,
): Promise<void> {
  signal.throwIfAborted();
  if (sleepImpl) {
    let handleAbort: (() => void) | undefined;
    try {
      await Promise.race([
        sleepImpl(ms),
        new Promise<never>((_resolve, reject) => {
          handleAbort = () => reject(signal.reason);
          signal.addEventListener('abort', handleAbort, { once: true });
        }),
      ]);
    } finally {
      if (handleAbort) signal.removeEventListener('abort', handleAbort);
    }
    return;
  }
  await new Promise<void>((resolveSleep, rejectSleep) => {
    const handleAbort = () => {
      clearTimeout(timer);
      rejectSleep(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolveSleep();
    }, ms);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function createIdentifiers(
  instance: string,
  randomUuid: () => string,
): FindingsAcceptanceIdentifiers {
  const suiteId = randomUuid();
  const prefix = `findings-os-smoke-${instance}-${suiteId}`;
  return {
    suiteId,
    primaryOrganizationId: `${prefix}-primary`,
    corpusOrganizationId: `${prefix}-corpus`,
    foreignOrganizationId: `${prefix}-foreign`,
    workflowId: randomUuid(),
    scopeId: randomUuid(),
    scopedRunId: `${prefix}-run-scoped`,
    unscopedRunId: `${prefix}-run-unscoped`,
    actorId: `${prefix}-actor`,
  };
}

function openSearchClientForService(client: Client) {
  return {
    isClientEnabled: () => true,
    getClient: () => client,
  };
}

interface FindingsApiRequestBounds {
  timeoutMs?: number;
  ambiguousServerCompletionBoundMs?: number;
}

export function calculateServerCompletionBarrierDelay(
  startedAtMs: number,
  nowMs: number,
  serverCompletionBoundMs: number,
): number {
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(serverCompletionBoundMs) ||
    serverCompletionBoundMs < 0
  ) {
    throw new Error('Server completion barrier inputs must be finite and non-negative');
  }
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, serverCompletionBoundMs - elapsedMs);
}

export async function waitForAmbiguousServerCompletion(
  startedAtMs: number,
  serverCompletionBoundMs: number,
  now: () => number = () => performance.now(),
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise<void>((resolveBarrier) => setTimeout(resolveBarrier, delayMs)),
): Promise<void> {
  const remainingMs = calculateServerCompletionBarrierDelay(
    startedAtMs,
    now(),
    serverCompletionBoundMs,
  );
  if (remainingMs === 0) return;
  await wait(remainingMs);
}

async function apiResponse(
  context: FindingsAcceptanceContext,
  organizationId: string,
  path: string,
  init: RequestInit = {},
  bounds: FindingsApiRequestBounds = {},
): Promise<{ response: Response; dispose(): void }> {
  const startedAtMs = performance.now();
  const timeoutMs = bounds.timeoutMs ?? FINDINGS_OPENSEARCH_REQUEST_TIMEOUT_MS;
  const url = new URL(
    path.replace(/^\/+/, ''),
    `${context.config.apiBaseUrl.replace(/\/+$/, '')}/`,
  );
  const { signal: initSignal, ...requestInit } = init;
  const parentSignal = initSignal ? AbortSignal.any([context.signal, initSignal]) : context.signal;
  const abortScope = createReferencedAbortScope(
    timeoutMs,
    `${init.method ?? 'GET'} ${path}`,
    parentSignal,
  );
  try {
    const response = await context.fetchImpl(url, {
      ...requestInit,
      headers: {
        'x-internal-token': context.config.internalToken,
        'x-organization-id': organizationId,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: abortScope.signal,
    });
    return { response, dispose: abortScope.dispose };
  } catch (error) {
    abortScope.dispose();
    if (bounds.ambiguousServerCompletionBoundMs !== undefined) {
      await waitForAmbiguousServerCompletion(startedAtMs, bounds.ambiguousServerCompletionBoundMs);
    }
    throw error;
  }
}

async function apiJson<T>(
  context: FindingsAcceptanceContext,
  organizationId: string,
  path: string,
  init: RequestInit = {},
  expectedStatuses: number[] = [200],
  bounds: FindingsApiRequestBounds = {},
): Promise<T> {
  const boundedResponse = await apiResponse(context, organizationId, path, init, bounds);
  try {
    const { response } = boundedResponse;
    if (!expectedStatuses.includes(response.status)) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `${init.method ?? 'GET'} ${path} returned HTTP ${response.status}${
          detail ? `: ${detail.slice(0, 500)}` : ''
        }`,
      );
    }
    return (await response.json()) as T;
  } finally {
    boundedResponse.dispose();
  }
}

async function ensureSecurityDisabledTenant(
  context: FindingsAcceptanceContext,
  organizationId: string,
  expectedSuccess = true,
): Promise<void> {
  const indexName = buildFindingObservationIndexName(organizationId);
  const templateName = buildOrganizationFindingsIndexTemplateName(organizationId);
  context.ledger.trackOrganization(organizationId);
  context.ledger.trackIndex(indexName);
  context.ledger.trackIndexTemplate(templateName);

  const result = await apiJson<{
    success?: boolean;
    securityEnabled?: boolean;
    message?: string;
  }>(
    context,
    organizationId,
    'analytics/ensure-tenant',
    {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    },
    [200],
    {
      timeoutMs: FINDINGS_OPENSEARCH_TENANT_REQUEST_TIMEOUT_MS,
      ambiguousServerCompletionBoundMs: FINDINGS_OPENSEARCH_TENANT_SERVER_COMPLETION_BOUND_MS,
    },
  );
  invariant(
    result.securityEnabled === false,
    `first-use provisioning unexpectedly reported security enabled for ${organizationId}`,
  );
  invariant(
    result.success === expectedSuccess,
    `first-use provisioning for ${organizationId} returned success=${String(result.success)}; expected ${expectedSuccess} (${result.message ?? 'no message'})`,
  );
}

export async function installAndCaptureGlobalFindingsBootstrap(
  client: Client,
): Promise<FindingsGlobalBootstrapSnapshot> {
  await client.ingest.putPipeline({
    id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
    body: exactJsonClone(buildFindingsFinalIngestPipeline()) as never,
  });
  const globalTemplate = buildFindingsIndexTemplate([buildAllFindingObservationIndexPattern()]);
  await client.indices.putIndexTemplate({
    name: GLOBAL_FINDINGS_TEMPLATE_NAME,
    body: exactJsonClone(globalTemplate) as never,
  });

  const pipelineResponse = (await client.ingest.getPipeline({
    id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
  })) as unknown as { body: Record<string, unknown> };
  const installedPipeline = pipelineResponse.body[FINDINGS_FINAL_INGEST_PIPELINE_ID];
  invariant(
    isRecord(installedPipeline) &&
      hashFindingsPipelineInvariant(installedPipeline) ===
        FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
    'global bootstrap pipeline GET did not match its content-addressed ID',
  );

  const templateResponse = (await client.indices.getIndexTemplate({
    name: GLOBAL_FINDINGS_TEMPLATE_NAME,
  })) as unknown as {
    body: {
      index_templates?: { name?: string; index_template?: Record<string, unknown> }[];
    };
  };
  const installedTemplate = templateResponse.body.index_templates?.find(
    (candidate) => candidate.name === GLOBAL_FINDINGS_TEMPLATE_NAME,
  )?.index_template;
  invariant(
    isRecord(installedTemplate) &&
      hashFindingsIndexTemplateInvariant(installedTemplate) ===
        hashFindingsIndexTemplateInvariant(globalTemplate),
    'global bootstrap observation template GET did not match the exact supported contract',
  );
  return {
    pipeline: exactJsonClone(installedPipeline),
    template: exactJsonClone(installedTemplate),
  };
}

export async function restoreGlobalFindingsBootstrapSnapshot(
  client: Client,
  snapshot: FindingsGlobalBootstrapSnapshot,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await client.ingest.putPipeline({
      id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      body: exactJsonClone(snapshot.pipeline) as never,
    });
    const response = (await client.ingest.getPipeline({
      id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
    })) as unknown as { body: Record<string, unknown> };
    deepStrictEqual(
      response.body[FINDINGS_FINAL_INGEST_PIPELINE_ID],
      snapshot.pipeline,
      'global findings pipeline pre-run body was not restored exactly',
    );
  } catch (error) {
    errors.push(error);
  }
  try {
    await client.indices.putIndexTemplate({
      name: GLOBAL_FINDINGS_TEMPLATE_NAME,
      body: exactJsonClone(snapshot.template) as never,
    });
    const response = (await client.indices.getIndexTemplate({
      name: GLOBAL_FINDINGS_TEMPLATE_NAME,
    })) as unknown as {
      body: {
        index_templates?: { name?: string; index_template?: Record<string, unknown> }[];
      };
    };
    const restored = response.body.index_templates?.find(
      (candidate) => candidate.name === GLOBAL_FINDINGS_TEMPLATE_NAME,
    )?.index_template;
    deepStrictEqual(
      restored,
      snapshot.template,
      'global findings template pre-run body was not restored exactly',
    );
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Global findings bootstrap restoration failed independently');
  }
}

async function verifyOrganizationStorage(
  context: FindingsAcceptanceContext,
  organizationId: string,
): Promise<void> {
  const indexName = buildFindingObservationIndexName(organizationId);
  const templateName = buildOrganizationFindingsIndexTemplateName(organizationId);
  const [pipelineResponse, templateResponse, settingsResponse, mappingResponse] = await Promise.all(
    [
      context.client.ingest.getPipeline({ id: FINDINGS_FINAL_INGEST_PIPELINE_ID }),
      context.client.indices.getIndexTemplate({ name: templateName }),
      context.client.indices.getSettings({ index: indexName }),
      context.client.indices.getMapping({ index: indexName }),
    ],
  );
  const pipelines = (pipelineResponse as unknown as { body: Record<string, unknown> }).body;
  const installedPipeline = pipelines[FINDINGS_FINAL_INGEST_PIPELINE_ID];
  invariant(
    installedPipeline !== undefined &&
      hashFindingsPipelineInvariant(installedPipeline) ===
        FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
    `pipeline invariant drifted for ${organizationId}`,
  );

  const templates = (
    templateResponse as unknown as {
      body: {
        index_templates?: { name?: string; index_template?: Record<string, unknown> }[];
      };
    }
  ).body.index_templates;
  const installedTemplate = templates?.find(
    (candidate) => candidate.name === templateName,
  )?.index_template;
  invariant(
    installedTemplate !== undefined &&
      hashFindingsIndexTemplateInvariant(installedTemplate) ===
        getOrganizationFindingsIndexTemplateContentHash(organizationId),
    `template invariant drifted for ${organizationId}`,
  );

  const settings = (
    settingsResponse as unknown as {
      body: Record<string, { settings?: Record<string, unknown> }>;
    }
  ).body;
  const normalizedSettings = normalizeFindingsIndexSettings(settings[indexName]?.settings);
  invariant(
    normalizedSettings?.['index.final_pipeline'] === FINDINGS_FINAL_INGEST_PIPELINE_ID,
    `index final pipeline drifted for ${organizationId}`,
  );

  const mappings = (
    mappingResponse as unknown as {
      body: Record<string, { mappings?: Record<string, unknown> }>;
    }
  ).body;
  const expectedMapping = buildOrganizationFindingsIndexTemplate(organizationId).template.mappings;
  invariant(
    mappings[indexName]?.mappings !== undefined &&
      hashFindingsMappingInvariant(mappings[indexName]?.mappings) ===
        hashFindingsMappingInvariant(expectedMapping),
    `index mapping drifted for ${organizationId}`,
  );
}

async function verifyCheckedSchema(context: FindingsAcceptanceContext): Promise<void> {
  context.signal.throwIfAborted();
  const client = await context.pool.connect();
  try {
    context.signal.throwIfAborted();
    const plan = loadMigrationPlan(resolve(__dirname, '../migrations'));
    await assertDatabaseMigrationsCurrent(new PostgresMigrationDatabase(client), plan);
    context.signal.throwIfAborted();
  } finally {
    client.release();
  }
}

async function verifyTopologyAndBootstrap(context: FindingsAcceptanceContext): Promise<void> {
  context.signal.throwIfAborted();
  context.log('[findings-opensearch] verifying OpenSearch 2.11 and checked PostgreSQL schema');
  const info = (await context.client.info()) as unknown as {
    body?: { version?: { number?: string } };
  };
  const version = info.body?.version?.number;
  invariant(typeof version === 'string', 'OpenSearch info omitted version.number');
  assertSupportedOpenSearchVersion(version);
  await verifyCheckedSchema(context);
  context.signal.throwIfAborted();

  context.log('[findings-opensearch] applying and reading back the global observation bootstrap');
  context.globalBootstrapSnapshot = await installAndCaptureGlobalFindingsBootstrap(context.client);
}

async function indexCorpus(context: FindingsAcceptanceContext): Promise<void> {
  const indexName = buildFindingObservationIndexName(context.ids.corpusOrganizationId);
  const accepted = new Map<string, FindingsCorpusFixture>();
  for (const fixture of context.corpusFixtures) {
    context.signal.throwIfAborted();
    context.ledger.trackDocument(indexName, fixture.documentId);
    try {
      await context.client.index({
        index: indexName,
        id: fixture.documentId,
        body: fixture.document,
        refresh: 'wait_for',
      });
      invariant(
        fixture.expectedClassification !== 'rejected',
        `${fixture.name} forged document ID was accepted`,
      );
      accepted.set(fixture.documentId, fixture);
    } catch (error) {
      invariant(
        fixture.expectedClassification === 'rejected' && responseStatus(error) === 400,
        `${fixture.name} failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const response = (await context.client.mget({
    index: indexName,
    body: { ids: context.corpusFixtures.map((fixture) => fixture.documentId) },
  })) as unknown as {
    body: {
      docs?: {
        _id?: string;
        found?: boolean;
        _source?: Record<string, unknown>;
      }[];
    };
  };
  const docs = new Map((response.body.docs ?? []).map((doc) => [doc._id, doc]));
  for (const fixture of context.corpusFixtures) {
    const stored = docs.get(fixture.documentId);
    if (fixture.expectedClassification === 'rejected') {
      invariant(stored?.found !== true, `${fixture.name} forged storage ID exists after rejection`);
      continue;
    }
    invariant(stored?.found === true && stored._source, `${fixture.name} was not stored`);
    invariant(
      stored._source[FINDINGS_CONTRACT_CLASSIFICATION_FIELD] === fixture.expectedClassification,
      `${fixture.name} classified as ${String(
        stored._source[FINDINGS_CONTRACT_CLASSIFICATION_FIELD],
      )}`,
    );
    const withoutPipelineFields = { ...stored._source };
    Reflect.deleteProperty(withoutPipelineFields, FINDINGS_CONTRACT_CLASSIFICATION_FIELD);
    Reflect.deleteProperty(withoutPipelineFields, FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD);
    Reflect.deleteProperty(withoutPipelineFields, FINDINGS_NORMALIZED_SEVERITY_FIELD);
    deepStrictEqual(
      withoutPipelineFields,
      accepted.get(fixture.documentId)?.document,
      `${fixture.name} _source changed beyond the declared classification fields`,
    );
  }
}

export interface CustomAnalyticsIsolationFixture {
  documentId: string;
  document: {
    arbitrary: { analytics: boolean; nested: (string | number)[] };
    custom_score: number;
  };
  mapping: {
    dynamic: 'strict';
    properties: {
      arbitrary: { type: 'object'; enabled: false };
      custom_score: { type: 'float' };
    };
  };
}

export function buildCustomAnalyticsIsolationFixture(
  suiteId: string,
): CustomAnalyticsIsolationFixture {
  return {
    documentId: `analytics-${suiteId}`,
    document: {
      arbitrary: { analytics: true, nested: ['retained', 7] },
      custom_score: 0.75,
    },
    mapping: {
      dynamic: 'strict',
      properties: {
        arbitrary: { type: 'object', enabled: false },
        custom_score: { type: 'float' },
      },
    },
  };
}

async function verifyCustomAnalyticsIsolation(context: FindingsAcceptanceContext): Promise<void> {
  const indexName = buildTenantAnalyticsIndexName(
    context.ids.corpusOrganizationId,
    `acceptance-${context.ids.suiteId}`,
  );
  const fixture = buildCustomAnalyticsIsolationFixture(context.ids.suiteId);
  context.ledger.trackIndex(indexName);
  await context.client.indices.create({
    index: indexName,
    body: { mappings: fixture.mapping },
  });
  await context.client.index({
    index: indexName,
    id: fixture.documentId,
    refresh: 'wait_for',
    body: fixture.document,
  });
  context.ledger.trackDocument(indexName, fixture.documentId);

  const [settingsResponse, mappingResponse, documentResponse] = await Promise.all([
    context.client.indices.getSettings({ index: indexName }),
    context.client.indices.getMapping({ index: indexName }),
    context.client.get({ index: indexName, id: fixture.documentId }),
  ]);
  const settings = (
    settingsResponse as unknown as {
      body: Record<string, { settings?: Record<string, unknown> }>;
    }
  ).body;
  const normalized = normalizeFindingsIndexSettings(settings[indexName]?.settings);
  invariant(
    normalized?.['index.final_pipeline'] === undefined,
    'custom analytics suffix inherited the findings final pipeline',
  );
  const installedMapping = (
    mappingResponse as unknown as {
      body: Record<string, { mappings?: Record<string, unknown> }>;
    }
  ).body[indexName]?.mappings;
  deepStrictEqual(
    installedMapping,
    fixture.mapping,
    'custom analytics suffix mapping changed or inherited the observation contract',
  );
  const storedSource = (
    documentResponse as unknown as {
      body: { found?: boolean; _source?: Record<string, unknown> };
    }
  ).body;
  invariant(storedSource.found === true, 'custom analytics suffix document was not stored');
  deepStrictEqual(
    storedSource._source,
    fixture.document,
    'custom analytics suffix _source was changed by the findings pipeline',
  );
}

async function verifyFirstUseAndCorpus(context: FindingsAcceptanceContext): Promise<void> {
  context.log(
    '[findings-opensearch] provisioning security-disabled first use and indexing the contract corpus',
  );
  await ensureSecurityDisabledTenant(context, context.ids.corpusOrganizationId);
  await verifyOrganizationStorage(context, context.ids.corpusOrganizationId);
  await indexCorpus(context);
  await verifyCustomAnalyticsIsolation(context);

  const controlIndex = buildFindingProjectionControlIndexName(context.ids.corpusOrganizationId);
  context.ledger.trackIndex(controlIndex);
  const result = await context.analytics.reconcileFindingStorageIdIntegrity(
    context.ids.corpusOrganizationId,
  );
  invariant(
    result.checked === 10 && result.mismatched === 0,
    'corpus reconciliation count drifted',
  );
  const list = await apiJson<{
    total?: number;
    items?: unknown[];
    availability?: string;
    degradedReasons?: string[];
  }>(context, context.ids.corpusOrganizationId, 'findings?paginationMode=cursor&pageSize=25');
  invariant(list.total === 10, `corpus list reported total=${String(list.total)}`);
  invariant((list.items?.length ?? 0) > 0, 'invalid corpus surfaced as false-empty success');
  invariant(
    list.availability === 'degraded' && list.degradedReasons?.includes('invalid_schema_documents'),
    'invalid corpus did not surface a truthful degraded state',
  );
}

export interface InvariantDriftProbe<TPreState> {
  label: string;
  expectedFailureMessage: string;
  proveHealthy(): Promise<unknown>;
  capturePreState(): Promise<TPreState>;
  mutate(): Promise<unknown>;
  reconcile(): Promise<unknown>;
  assertCheckingDegraded(): Promise<unknown>;
  runRecovery?(operation: () => Promise<void>): Promise<void>;
  restore(preState: TPreState): Promise<unknown>;
  assertRestored(preState: TPreState): Promise<unknown>;
  proveRecovered(): Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeInvariantDriftProbe<TPreState>(
  probe: InvariantDriftProbe<TPreState>,
): Promise<void> {
  await probe.proveHealthy();
  const preState = await probe.capturePreState();
  let driftError: unknown;
  let restoreError: unknown;
  try {
    await probe.mutate();
    let reconciliationFailure: unknown;
    try {
      await probe.reconcile();
    } catch (error) {
      reconciliationFailure = error;
    }
    if (reconciliationFailure === undefined) {
      throw new Error(`${probe.label} drift did not fail storage reconciliation`);
    }
    if (errorMessage(reconciliationFailure) !== probe.expectedFailureMessage) {
      throw new Error(
        `${probe.label} drift returned unexpected failure: ${errorMessage(reconciliationFailure)}`,
        { cause: reconciliationFailure },
      );
    }
    await probe.assertCheckingDegraded();
  } catch (error) {
    driftError = error;
  }

  let recoveryError: unknown;
  const restoreAndProveRecovery = async () => {
    try {
      await probe.restore(preState);
      await probe.assertRestored(preState);
    } catch (error) {
      restoreError = error;
    }
    try {
      await probe.proveRecovered();
    } catch (error) {
      recoveryError = error;
    }
  };
  let recoveryScopeError: unknown;
  try {
    if (probe.runRecovery) await probe.runRecovery(restoreAndProveRecovery);
    else await restoreAndProveRecovery();
  } catch (error) {
    recoveryScopeError = error;
  }
  const errors = [driftError, restoreError, recoveryError, recoveryScopeError].filter(
    (error): error is NonNullable<unknown> => error !== undefined,
  );
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `${probe.label} drift, restoration, or recovery failed`);
  }
}

async function readStorageVerificationState(
  context: FindingsAcceptanceContext,
  organizationId: string,
): Promise<string | undefined> {
  const response = (await context.client.get({
    index: buildFindingProjectionControlIndexName(organizationId),
    id: FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID,
  })) as unknown as {
    body: { _source?: Record<string, unknown> };
  };
  const state = response.body._source?.verification_state;
  return typeof state === 'string' ? state : undefined;
}

async function proveStorageVerifiedAndAvailable(
  context: FindingsAcceptanceContext,
  organizationId: string,
): Promise<void> {
  context.signal.throwIfAborted();
  const batch = await context.reconciler.reconcileOrganizationBatch(
    organizationId,
    10,
    context.signal,
  );
  invariant(
    !batch.skipped && batch.cycleComplete && batch.state.failed === 0,
    `could not establish prior verified reconciliation health for ${organizationId}`,
  );
  invariant(
    (await readStorageVerificationState(context, organizationId)) === 'verified',
    `storage verification was not verified for ${organizationId}`,
  );
  const watermark = await context.analytics.getFindingStorageIdIntegrityWatermark(organizationId);
  invariant(
    watermark?.matchesCurrentObservationIndex === true &&
      watermark.matchesCurrentInvariant === true &&
      watermark.mismatched === 0,
    `storage verification was not current and available for ${organizationId}`,
  );
  const list = await apiJson<{ availability?: string; degradedReasons?: string[] }>(
    context,
    organizationId,
    'findings?paginationMode=cursor&pageSize=1',
  );
  invariant(
    list.availability === 'available',
    `findings read was not available after verified reconciliation for ${organizationId}: ${(list.degradedReasons ?? []).join(',')}`,
  );
}

async function assertStorageCheckingAndDegraded(
  context: FindingsAcceptanceContext,
  organizationId: string,
): Promise<void> {
  invariant(
    (await readStorageVerificationState(context, organizationId)) === 'checking',
    `failed invariant did not leave ${organizationId} in checking state`,
  );
  invariant(
    (await context.analytics.getFindingStorageIdIntegrityWatermark(organizationId)) === null,
    `checking storage watermark was accepted as verified for ${organizationId}`,
  );
  const list = await apiJson<{ availability?: string; degradedReasons?: string[] }>(
    context,
    organizationId,
    'findings?paginationMode=cursor&pageSize=1',
  );
  invariant(
    list.availability === 'degraded' &&
      list.degradedReasons?.includes('storage_id_integrity_unverified'),
    `failed invariant did not surface checking/degraded state for ${organizationId}`,
  );
}

async function verifyDriftAndFailureSemantics(context: FindingsAcceptanceContext): Promise<void> {
  context.log('[findings-opensearch] mutating one storage invariant at a time');
  const driftPrefix = `findings-os-drift-${context.config.instance}-${context.ids.suiteId}`;
  const pipelineOrg = `${driftPrefix}-pipeline`;
  const templateOrg = `${driftPrefix}-template`;
  const settingsOrg = `${driftPrefix}-settings`;
  const mappingOrg = `${driftPrefix}-mapping`;
  for (const organizationId of [pipelineOrg, templateOrg, settingsOrg, mappingOrg]) {
    await ensureSecurityDisabledTenant(context, organizationId);
    await verifyOrganizationStorage(context, organizationId);
  }

  await executeInvariantDriftProbe({
    label: 'pipeline',
    expectedFailureMessage:
      'Installed findings final pipeline content does not match its immutable ID',
    proveHealthy: () => proveStorageVerifiedAndAvailable(context, pipelineOrg),
    capturePreState: async () => {
      const response = (await context.client.ingest.getPipeline({
        id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      })) as unknown as { body: Record<string, Record<string, unknown>> };
      const pipeline = response.body[FINDINGS_FINAL_INGEST_PIPELINE_ID];
      invariant(pipeline !== undefined, 'pipeline pre-state was absent');
      return exactJsonClone(pipeline);
    },
    mutate: () =>
      context.client.ingest.putPipeline({
        id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
        body: {
          ...exactJsonClone(buildFindingsFinalIngestPipeline()),
          description: 'intentionally drifted by the disposable release acceptance',
        } as never,
      }),
    reconcile: () => reconcileFindingStorageIdIntegrity(context.client as never, pipelineOrg, 10),
    assertCheckingDegraded: () => assertStorageCheckingAndDegraded(context, pipelineOrg),
    runRecovery: (operation) => context.runRecoveryOperation(operation),
    restore: (preState) =>
      context.client.ingest.putPipeline({
        id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
        body: preState as never,
      }),
    assertRestored: async (preState) => {
      const response = (await context.client.ingest.getPipeline({
        id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      })) as unknown as { body: Record<string, Record<string, unknown>> };
      deepStrictEqual(
        response.body[FINDINGS_FINAL_INGEST_PIPELINE_ID],
        preState,
        'pipeline exact pre-state was not restored',
      );
    },
    proveRecovered: () => proveStorageVerifiedAndAvailable(context, pipelineOrg),
  });

  const templateName = buildOrganizationFindingsIndexTemplateName(templateOrg);
  await executeInvariantDriftProbe({
    label: 'template',
    expectedFailureMessage:
      'Installed findings observation template content does not match its name',
    proveHealthy: () => proveStorageVerifiedAndAvailable(context, templateOrg),
    capturePreState: async () => {
      const response = (await context.client.indices.getIndexTemplate({
        name: templateName,
      })) as unknown as {
        body: {
          index_templates?: { name?: string; index_template?: Record<string, unknown> }[];
        };
      };
      const template = response.body.index_templates?.find(
        (candidate) => candidate.name === templateName,
      )?.index_template;
      invariant(template !== undefined, 'template pre-state was absent');
      return exactJsonClone(template);
    },
    mutate: () =>
      context.client.indices.putIndexTemplate({
        name: templateName,
        body: {
          ...exactJsonClone(buildOrganizationFindingsIndexTemplate(templateOrg)),
          priority: 99,
        } as never,
      }),
    reconcile: () => reconcileFindingStorageIdIntegrity(context.client as never, templateOrg, 10),
    assertCheckingDegraded: () => assertStorageCheckingAndDegraded(context, templateOrg),
    runRecovery: (operation) => context.runRecoveryOperation(operation),
    restore: (preState) =>
      context.client.indices.putIndexTemplate({ name: templateName, body: preState as never }),
    assertRestored: async (preState) => {
      const response = (await context.client.indices.getIndexTemplate({
        name: templateName,
      })) as unknown as {
        body: {
          index_templates?: { name?: string; index_template?: Record<string, unknown> }[];
        };
      };
      deepStrictEqual(
        response.body.index_templates?.find((candidate) => candidate.name === templateName)
          ?.index_template,
        preState,
        'template exact pre-state was not restored',
      );
    },
    proveRecovered: () => proveStorageVerifiedAndAvailable(context, templateOrg),
  });

  const settingsIndex = buildFindingObservationIndexName(settingsOrg);
  await executeInvariantDriftProbe({
    label: 'settings',
    expectedFailureMessage: `Observation index ${settingsIndex} is not protected by ${FINDINGS_FINAL_INGEST_PIPELINE_ID}`,
    proveHealthy: () => proveStorageVerifiedAndAvailable(context, settingsOrg),
    capturePreState: async () => {
      const response = (await context.client.indices.getSettings({
        index: settingsIndex,
      })) as unknown as {
        body: Record<string, { settings?: Record<string, unknown> }>;
      };
      const finalPipeline = normalizeFindingsIndexSettings(
        response.body[settingsIndex]?.settings,
      )?.['index.final_pipeline'];
      invariant(typeof finalPipeline === 'string', 'settings pre-state omitted final pipeline');
      return finalPipeline;
    },
    mutate: () =>
      context.client.indices.putSettings({
        index: settingsIndex,
        body: { 'index.final_pipeline': '_none' },
      }),
    reconcile: () => reconcileFindingStorageIdIntegrity(context.client as never, settingsOrg, 10),
    assertCheckingDegraded: () => assertStorageCheckingAndDegraded(context, settingsOrg),
    runRecovery: (operation) => context.runRecoveryOperation(operation),
    restore: (preState) =>
      context.client.indices.putSettings({
        index: settingsIndex,
        body: { 'index.final_pipeline': preState },
      }),
    assertRestored: async (preState) => {
      const response = (await context.client.indices.getSettings({
        index: settingsIndex,
      })) as unknown as {
        body: Record<string, { settings?: Record<string, unknown> }>;
      };
      invariant(
        normalizeFindingsIndexSettings(response.body[settingsIndex]?.settings)?.[
          'index.final_pipeline'
        ] === preState,
        'settings exact pre-state was not restored',
      );
    },
    proveRecovered: () => proveStorageVerifiedAndAvailable(context, settingsOrg),
  });

  const mappingIndex = buildFindingObservationIndexName(mappingOrg);
  await executeInvariantDriftProbe({
    label: 'mapping',
    expectedFailureMessage: 'Installed findings observation mapping does not match the contract',
    proveHealthy: () => proveStorageVerifiedAndAvailable(context, mappingOrg),
    capturePreState: async () => {
      const [mappingResponse, settingsResponse] = await Promise.all([
        context.client.indices.getMapping({ index: mappingIndex }),
        context.client.indices.getSettings({ index: mappingIndex }),
      ]);
      const mappings = (
        mappingResponse as unknown as {
          body: Record<string, { mappings?: Record<string, unknown> }>;
        }
      ).body[mappingIndex]?.mappings;
      const finalPipeline = normalizeFindingsIndexSettings(
        (
          settingsResponse as unknown as {
            body: Record<string, { settings?: Record<string, unknown> }>;
          }
        ).body[mappingIndex]?.settings,
      )?.['index.final_pipeline'];
      invariant(mappings !== undefined, 'mapping pre-state was absent');
      invariant(typeof finalPipeline === 'string', 'mapping pre-state omitted final pipeline');
      return { mappings: exactJsonClone(mappings), finalPipeline };
    },
    mutate: () =>
      context.client.indices.putMapping({
        index: mappingIndex,
        body: { properties: { sentris_acceptance_drift_probe: { type: 'keyword' } } },
      }),
    reconcile: () => reconcileFindingStorageIdIntegrity(context.client as never, mappingOrg, 10),
    assertCheckingDegraded: () => assertStorageCheckingAndDegraded(context, mappingOrg),
    runRecovery: (operation) => context.runRecoveryOperation(operation),
    restore: async (preState) => {
      await context.client.indices.delete({ index: mappingIndex });
      await context.client.indices.create({
        index: mappingIndex,
        body: {
          settings: { 'index.final_pipeline': preState.finalPipeline },
          mappings: preState.mappings,
        } as never,
      });
    },
    assertRestored: async (preState) => {
      const response = (await context.client.indices.getMapping({
        index: mappingIndex,
      })) as unknown as {
        body: Record<string, { mappings?: Record<string, unknown> }>;
      };
      deepStrictEqual(
        response.body[mappingIndex]?.mappings,
        preState.mappings,
        'mapping exact pre-state was not restored',
      );
    },
    proveRecovered: () => proveStorageVerifiedAndAvailable(context, mappingOrg),
  });

  const injected = await verifyInjectedOpenSearchFailureSemantics();
  invariant(
    injected.join(',') ===
      'timed-out:unavailable,partial:unavailable,malformed:unavailable,malformed-total:unavailable,inexact-total-relation:unavailable,malformed-discovery-bucket:unavailable',
    'injected OpenSearch failures did not remain unavailable',
  );
}

async function seedScopeAndRuns(context: FindingsAcceptanceContext): Promise<void> {
  const { ids } = context;
  context.ledger.trackWorkflow(ids.workflowId);
  context.ledger.trackScope(ids.scopeId);
  context.ledger.trackWorkflowRun(ids.scopedRunId);
  context.ledger.trackWorkflowRun(ids.unscopedRunId);

  await executeConnectedAbortablePostgresTransaction(
    context.pool,
    [
      {
        name: 'workflow fixture',
        sql: `
        INSERT INTO workflows
          (id, name, description, graph, organization_id, run_count, created_at, updated_at)
        VALUES ($1::uuid, $2, $3, $4::jsonb, $5, 0, $6, $6)
      `,
        params: [
          ids.workflowId,
          `Findings OpenSearch acceptance ${ids.suiteId}`,
          'Disposable release acceptance workflow',
          JSON.stringify({ nodes: [], edges: [] }),
          ids.primaryOrganizationId,
          new Date(),
        ],
      },
      {
        name: 'scope fixture',
        sql: `
        INSERT INTO scopes
          (id, organization_id, name, description, domains, repos, ip_ranges, runtime_values, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8::jsonb, $9)
      `,
        params: [
          ids.scopeId,
          ids.primaryOrganizationId,
          `Findings OpenSearch acceptance ${ids.suiteId}`,
          'Disposable >10k findings scope',
          [`${ids.suiteId}.example.invalid`],
          [],
          [],
          JSON.stringify({}),
          ids.actorId,
        ],
      },
      ...(
        [
          [ids.scopedRunId, ids.scopeId],
          [ids.unscopedRunId, null],
        ] as const
      ).map(([runId, scopeId]) => ({
        name: `workflow run fixture ${runId}`,
        sql: `
          INSERT INTO workflow_runs
            (run_id, workflow_id, scope_id, inputs, trigger_type, trigger_label,
             input_preview, organization_id, status, close_time, created_at, updated_at)
          VALUES
            ($1, $2::uuid, $3::uuid, $4::jsonb, 'manual', 'Acceptance fixture',
             $5::jsonb, $6, 'COMPLETED', $7, $7, $7)
        `,
        params: [
          runId,
          ids.workflowId,
          scopeId,
          JSON.stringify({}),
          JSON.stringify({ runtimeInputs: {}, nodeOverrides: {} }),
          ids.primaryOrganizationId,
          new Date(),
        ],
      })),
    ],
    context.signal,
  );
}

async function bulkIndexLargeFixtures(
  context: FindingsAcceptanceContext,
  indexName: string,
  fixtures: LargeFindingsFixture[],
): Promise<void> {
  const batchSize = 500;
  for (let offset = 0; offset < fixtures.length; offset += batchSize) {
    context.signal.throwIfAborted();
    const batch = fixtures.slice(offset, offset + batchSize);
    const body: Record<string, unknown>[] = [];
    for (const fixture of batch) {
      context.ledger.trackDocument(indexName, fixture.documentId);
      body.push({ index: { _index: indexName, _id: fixture.documentId } }, fixture.document);
    }
    const response = (await context.client.bulk({
      refresh: false,
      body,
    })) as unknown as {
      body: {
        errors?: boolean;
        items?: { index?: { status?: number; error?: unknown } }[];
      };
    };
    const failed = (response.body.items ?? []).filter(
      (item) => (item.index?.status ?? 500) >= 300 || item.index?.error !== undefined,
    );
    invariant(
      response.body.errors !== true && failed.length === 0,
      `OpenSearch bulk indexing failed for ${failed.length} large fixture(s) at offset ${offset}`,
    );
  }
  await context.client.indices.refresh({ index: indexName });
}

async function insertTriageRows(
  context: FindingsAcceptanceContext,
  fixtures: LargeFindingsFixture[],
): Promise<void> {
  const batchSize = 400;
  const statements: FindingsCleanupStatement[] = [];
  for (let offset = 0; offset < fixtures.length; offset += batchSize) {
    context.signal.throwIfAborted();
    const batch = fixtures.slice(offset, offset + batchSize);
    const params: unknown[] = [];
    const values = batch.map((fixture, batchIndex) => {
      context.ledger.trackTriageRow(fixture.triageRowId);
      const base = batchIndex * 11;
      params.push(
        fixture.triageRowId,
        fixture.organizationId,
        fixture.documentId,
        fixture.triageStatus,
        fixture.triageStatus === 'fixed' ? context.ids.actorId : null,
        fixture.severity,
        `Acceptance triage ${offset + batchIndex}`,
        1,
        fixture.createdAt,
        fixture.createdAt,
        null,
      );
      return `(
          $${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4},
          $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8},
          $${base + 9}, $${base + 10}, $${base + 11}
        )`;
    });
    statements.push({
      name: `finding triage fixture batch ${offset / batchSize + 1}`,
      sql: `
          INSERT INTO finding_triage
            (id, organization_id, finding_opensearch_id, status, assignee_user_id,
             severity_override, notes, projection_version, created_at, updated_at, sla_deadline)
          VALUES ${values.join(',')}
        `,
      params,
    });
  }
  await executeConnectedAbortablePostgresTransaction(context.pool, statements, context.signal);
}

async function seedForeignSentinel(
  context: FindingsAcceptanceContext,
): Promise<LargeFindingsFixture> {
  await ensureSecurityDisabledTenant(context, context.ids.foreignOrganizationId);
  const fixture = buildLargeFindingsFixtures({
    organizationId: context.ids.foreignOrganizationId,
    workflowId: context.ids.workflowId,
    scopeId: context.ids.scopeId,
    scopedRunId: `${context.ids.scopedRunId}-foreign`,
    unscopedRunId: `${context.ids.unscopedRunId}-foreign`,
    count: 1,
    now: new Date(),
  })[0]!;
  await bulkIndexLargeFixtures(
    context,
    buildFindingObservationIndexName(context.ids.foreignOrganizationId),
    [fixture],
  );
  await insertTriageRows(context, [fixture]);
  return fixture;
}

async function reconcileOrganization(
  context: FindingsAcceptanceContext,
  organizationId: string,
  expectedRows: number,
): Promise<void> {
  context.ledger.trackIndex(buildFindingProjectionControlIndexName(organizationId));
  let cycles = 0;
  while (cycles < Math.ceil(expectedRows / 500) + 3) {
    context.signal.throwIfAborted();
    const batch = await context.reconciler.reconcileOrganizationBatch(
      organizationId,
      500,
      context.signal,
    );
    invariant(!batch.skipped, `reconciliation lock was unavailable for ${organizationId}`);
    cycles += 1;
    if (batch.cycleComplete) {
      invariant(
        batch.state.checked === expectedRows &&
          batch.state.repaired === expectedRows &&
          batch.state.failed === 0,
        `reconciliation for ${organizationId} reported checked=${batch.state.checked}, repaired=${batch.state.repaired}, failed=${batch.state.failed}`,
      );
      return;
    }
  }
  throw new Error(`Reconciliation for ${organizationId} did not complete within its bounded plan`);
}

function sumNumericRecord(value: unknown): number {
  if (!isRecord(value)) return 0;
  let total = 0;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'number') total += candidate;
  }
  return total;
}

async function assertLargeReadModels(
  context: FindingsAcceptanceContext,
  foreignFixture: LargeFindingsFixture,
): Promise<void> {
  const primary = context.ids.primaryOrganizationId;
  const firstPage = await apiJson<{
    total?: number;
    items?: { id?: string }[];
    availability?: string;
    schemaCoverage?: { canonical?: number; invalid?: number; legacy?: number };
  }>(context, primary, 'findings?paginationMode=cursor&pageSize=100');
  invariant(firstPage.total === LARGE_FINDINGS_COUNT, 'large list total was capped or drifted');
  invariant(firstPage.availability === 'available', 'reconciled large list was not available');
  invariant(
    firstPage.schemaCoverage?.canonical === LARGE_FINDINGS_COUNT &&
      firstPage.schemaCoverage.invalid === 0 &&
      firstPage.schemaCoverage.legacy === 0,
    'large list schema coverage did not match the canonical dataset',
  );
  invariant(
    !firstPage.items?.some((item) => item.id === foreignFixture.documentId),
    'foreign finding sentinel leaked into the primary tenant list',
  );

  const combined = new URLSearchParams({
    paginationMode: 'cursor',
    pageSize: '100',
    severity: 'critical',
    triageStatus: 'fixed',
    scopeId: context.ids.scopeId,
    workflowId: context.ids.workflowId,
    componentId: 'component-a',
  });
  const combinedResult = await apiJson<{ total?: number; availability?: string }>(
    context,
    primary,
    `findings?${combined.toString()}`,
  );
  invariant(
    combinedResult.total === 167 && combinedResult.availability === 'available',
    `combined filters reported total=${String(combinedResult.total)}, availability=${String(
      combinedResult.availability,
    )}`,
  );

  const stats = await apiJson<{
    total?: number;
    availability?: string;
    severityCounts?: { severity?: string; count?: number }[];
  }>(context, primary, 'findings/stats');
  const severityCounts = new Map(
    (stats.severityCounts ?? []).map((item) => [item.severity, item.count]),
  );
  invariant(
    stats.total === LARGE_FINDINGS_COUNT &&
      stats.availability === 'available' &&
      severityCounts.get('critical') === 2_001 &&
      severityCounts.get('high') === 2_000 &&
      severityCounts.get('medium') === 2_000 &&
      severityCounts.get('low') === 2_000 &&
      severityCounts.get('info') === 2_000,
    'severity chart/stats did not agree with the >10k dataset',
  );

  const scope = await apiJson<{
    total?: number;
    availability?: string;
    bySeverity?: Record<string, number>;
  }>(context, primary, `scopes/${context.ids.scopeId}/findings-summary`);
  invariant(
    scope.total === 5_001 &&
      scope.availability === 'available' &&
      sumNumericRecord(scope.bySeverity) === 5_001,
    'scope findings summary was capped, false-zero, or degraded',
  );

  const statusDistribution = await apiJson<{
    total?: number;
    statuses?: { status?: string; count?: number }[];
  }>(context, primary, 'findings/analytics/status-distribution');
  invariant(
    statusDistribution.total === LARGE_FINDINGS_COUNT &&
      (statusDistribution.statuses ?? []).reduce((total, item) => total + (item.count ?? 0), 0) ===
        LARGE_FINDINGS_COUNT,
    'triage status chart did not agree with authoritative rows',
  );

  const posture = await apiJson<{
    buckets?: Record<string, number | string>[];
  }>(context, primary, 'findings/analytics/posture-trend?period=7d');
  const postureCount = (posture.buckets ?? []).reduce(
    (total, bucket) =>
      total +
      ['critical', 'high', 'medium', 'low', 'info'].reduce(
        (sum, severity) =>
          sum + (typeof bucket[severity] === 'number' ? Number(bucket[severity]) : 0),
        0,
      ),
    0,
  );
  invariant(postureCount === LARGE_FINDINGS_COUNT, 'posture chart count drifted from triage rows');

  const boundedExportResponse = await apiResponse(
    context,
    primary,
    'findings/export?format=json',
    {},
    { timeoutMs: 300_000 },
  );
  let exported: { id?: string }[];
  try {
    const { response: exportResponse } = boundedExportResponse;
    invariant(
      exportResponse.status === 200,
      `complete findings export returned HTTP ${exportResponse.status}`,
    );
    invariant(
      exportResponse.headers.get('x-sentris-availability') === 'available',
      'complete findings export reported degraded availability',
    );
    exported = (await exportResponse.json()) as { id?: string }[];
  } finally {
    boundedExportResponse.dispose();
  }
  const exportedIds = new Set(exported.map((item) => item.id));
  invariant(
    exported.length === LARGE_FINDINGS_COUNT &&
      exportedIds.size === LARGE_FINDINGS_COUNT &&
      !exportedIds.has(foreignFixture.documentId),
    `complete findings export returned ${exported.length} rows with ${exportedIds.size} unique IDs`,
  );

  const [projectionWatermark, storageWatermark, reconciliationState] = await Promise.all([
    context.analytics.getFindingTriageProjectionWatermark(primary),
    context.analytics.getFindingStorageIdIntegrityWatermark(primary),
    context.repository.getProjectionReconciliationState(primary),
  ]);
  invariant(
    projectionWatermark?.checked === LARGE_FINDINGS_COUNT &&
      projectionWatermark.repaired === LARGE_FINDINGS_COUNT &&
      projectionWatermark.failed === 0 &&
      projectionWatermark.matchesCurrentObservationIndex,
    'projection watermark did not agree with reconciliation',
  );
  invariant(
    storageWatermark?.checked === LARGE_FINDINGS_COUNT &&
      storageWatermark.mismatched === 0 &&
      storageWatermark.matchesCurrentObservationIndex &&
      storageWatermark.matchesCurrentInvariant,
    'storage integrity watermark did not agree with the exact live index',
  );
  invariant(
    reconciliationState?.checked === LARGE_FINDINGS_COUNT &&
      reconciliationState.repaired === LARGE_FINDINGS_COUNT &&
      reconciliationState.failed === 0 &&
      reconciliationState.cursor === null,
    'PostgreSQL reconciliation state did not agree with its OpenSearch watermarks',
  );
}

async function verifyLargeReadModels(context: FindingsAcceptanceContext): Promise<void> {
  context.log('[findings-opensearch] seeding >10,000 observation and triage rows');
  await ensureSecurityDisabledTenant(context, context.ids.primaryOrganizationId);
  await seedScopeAndRuns(context);
  await bulkIndexLargeFixtures(
    context,
    buildFindingObservationIndexName(context.ids.primaryOrganizationId),
    context.largeFixtures,
  );
  await insertTriageRows(context, context.largeFixtures);
  const foreignFixture = await seedForeignSentinel(context);

  const preReconciliation = await apiJson<{
    total?: number;
    items?: unknown[];
    availability?: string;
    degradedReasons?: string[];
  }>(context, context.ids.primaryOrganizationId, 'findings?paginationMode=cursor&pageSize=25');
  invariant(
    preReconciliation.total === LARGE_FINDINGS_COUNT &&
      (preReconciliation.items?.length ?? 0) > 0 &&
      preReconciliation.availability === 'degraded',
    'missing reconciliation surfaced as empty or available success',
  );

  context.log('[findings-opensearch] reconciling the full authoritative triage dataset');
  await reconcileOrganization(context, context.ids.primaryOrganizationId, LARGE_FINDINGS_COUNT);
  await reconcileOrganization(context, context.ids.foreignOrganizationId, 1);
  await assertLargeReadModels(context, foreignFixture);
}

interface CursorPage {
  total?: number;
  items?: { id?: string }[];
  currentCursor?: string | null;
  nextCursor?: string | null;
  availability?: string;
}

async function readCursorPage(
  context: FindingsAcceptanceContext,
  cursor?: string,
): Promise<CursorPage> {
  const query = new URLSearchParams({
    paginationMode: 'cursor',
    pageSize: '37',
    sortOrder: 'desc',
  });
  if (cursor) query.set('cursor', cursor);
  return apiJson<CursorPage>(
    context,
    context.ids.primaryOrganizationId,
    `findings?${query.toString()}`,
  );
}

function pageIds(page: CursorPage): string[] {
  return (page.items ?? []).map((item) => item.id ?? '');
}

async function verifyLongLivedPit(context: FindingsAcceptanceContext): Promise<void> {
  context.signal.throwIfAborted();
  context.log(`[findings-opensearch] holding a real cursor PIT for ${context.config.pitHoldMs}ms`);
  const first = await readCursorPage(context);
  invariant(
    first.total === LARGE_FINDINGS_COUNT &&
      typeof first.currentCursor === 'string' &&
      typeof first.nextCursor === 'string' &&
      first.availability === 'available',
    'PIT page one did not expose a complete signed cursor',
  );
  const second = await readCursorPage(context, first.nextCursor);
  invariant(
    typeof second.currentCursor === 'string' && typeof second.nextCursor === 'string',
    'PIT page two did not expose current and forward cursors',
  );
  const third = await readCursorPage(context, second.nextCursor);
  invariant(
    typeof third.currentCursor === 'string',
    'PIT page three did not expose a revisitable current cursor',
  );
  invariant(
    new Set([...pageIds(first), ...pageIds(second), ...pageIds(third)]).size ===
      pageIds(first).length + pageIds(second).length + pageIds(third).length,
    'forward PIT pages overlapped',
  );

  await context.sleep(context.config.pitHoldMs, context.signal);
  context.signal.throwIfAborted();

  const revisitedSecond = await readCursorPage(context, second.currentCursor);
  const revisitedFirst = await readCursorPage(context, first.currentCursor);
  const forwardAgain = await readCursorPage(context, first.nextCursor);
  deepStrictEqual(
    pageIds(revisitedSecond),
    pageIds(second),
    'page-two cursor changed after the >2 minute hold',
  );
  deepStrictEqual(
    pageIds(revisitedFirst),
    pageIds(first),
    'page-one cursor changed after the >2 minute hold',
  );
  deepStrictEqual(
    pageIds(forwardAgain),
    pageIds(second),
    'forward cursor from revisited page one changed after the >2 minute hold',
  );
}

function discoveryDocument(organizationId: string, suffix: string): Record<string, unknown> {
  return {
    '@timestamp': '2026-07-29T12:00:00.000Z',
    severity: 'info',
    title: `Observation-only discovery ${suffix}`,
    description: `Disposable discovery fixture ${suffix}`,
    evidence: { discovery: suffix },
    source: { suite: 'findings-opensearch-acceptance' },
    sentris: {
      organization_id: organizationId,
      workflow_id: `discovery-workflow-${suffix}`,
      workflow_name: 'Discovery acceptance',
      run_id: `discovery-run-${suffix}`,
      scope_id: null,
      component_id: 'discovery.fixture',
      node_ref: `discovery-node-${suffix}`,
      asset_key: null,
    },
  };
}

async function createObservationOnlyIndex(
  context: FindingsAcceptanceContext,
  organizationId: string,
  suffix: string,
  provisionFirstUse: boolean,
): Promise<void> {
  const indexName = buildFindingObservationIndexName(organizationId);
  context.ledger.trackOrganization(organizationId);
  context.ledger.trackIndex(indexName);
  if (provisionFirstUse) {
    await ensureSecurityDisabledTenant(context, organizationId);
  } else {
    await context.client.indices.create({
      index: indexName,
      body: {
        settings: { 'index.final_pipeline': FINDINGS_FINAL_INGEST_PIPELINE_ID },
        mappings: { dynamic: false, properties: FINDINGS_INDEX_PROPERTIES },
      } as never,
    });
  }
  const documentId = `discovery-${context.ids.suiteId}-${suffix}`;
  context.ledger.trackDocument(indexName, documentId);
  await context.client.index({
    index: indexName,
    id: documentId,
    refresh: false,
    body: discoveryDocument(organizationId, suffix),
  });
}

async function assertForgedDiscoveryPairRejected(
  context: FindingsAcceptanceContext,
): Promise<void> {
  const indexOrganizationId = `findings-os-forged-index-${context.ids.suiteId}`;
  const sourceOrganizationId = `findings-os-forged-source-${context.ids.suiteId}`;
  await createObservationOnlyIndex(context, indexOrganizationId, 'forged-pair', true);
  const indexName = buildFindingObservationIndexName(indexOrganizationId);
  const documentId = `discovery-${context.ids.suiteId}-forged-pair`;
  await context.client.delete({
    index: indexName,
    id: documentId,
    refresh: 'wait_for',
  });
  await context.client.index({
    index: indexName,
    id: documentId,
    refresh: 'wait_for',
    body: discoveryDocument(sourceOrganizationId, 'forged-pair'),
  });

  let afterKey: { indexName: string; organizationId: string } | undefined;
  let rejected = false;
  for (let page = 0; page < 10; page += 1) {
    context.signal.throwIfAborted();
    try {
      const result = await context.analytics.listFindingObservationOrganizationsPage(afterKey, 100);
      if (!result.afterKey) break;
      afterKey = result.afterKey;
    } catch (error) {
      rejected =
        typeof (error as { getStatus?: unknown })?.getStatus === 'function' &&
        (error as { getStatus(): number }).getStatus() === 503;
      break;
    }
  }
  invariant(rejected, 'forged OpenSearch index/organization pairing was accepted by discovery');

  await context.client.indices.delete({ index: indexName });
}

async function readDiscoveryStateSnapshot(
  pool: Pool,
  signal?: AbortSignal,
): Promise<DiscoveryStateSnapshot> {
  signal?.throwIfAborted();
  const result = await pool.query<NonNullable<DiscoveryStateSnapshot['row']>>(
    `
      SELECT organization_id, cursor, cycle_started_at, cycle_cutoff, checked,
             repaired, failed, last_completed_at, reconciled_through, updated_at
      FROM finding_projection_reconciliation
      WHERE organization_id = $1
    `,
    [DISCOVERY_STATE_ROW_ID],
  );
  signal?.throwIfAborted();
  return result.rows[0] ? { exists: true, row: result.rows[0] } : { exists: false };
}

async function restoreDiscoveryStateSnapshot(
  pool: Pool,
  snapshot: DiscoveryStateSnapshot,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!snapshot.exists) {
    await pool.query('DELETE FROM finding_projection_reconciliation WHERE organization_id = $1', [
      DISCOVERY_STATE_ROW_ID,
    ]);
    signal?.throwIfAborted();
  } else {
    const row = snapshot.row!;
    await pool.query(
      `
        INSERT INTO finding_projection_reconciliation
          (organization_id, cursor, cycle_started_at, cycle_cutoff, checked, repaired,
           failed, last_completed_at, reconciled_through, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (organization_id) DO UPDATE SET
          cursor = EXCLUDED.cursor,
          cycle_started_at = EXCLUDED.cycle_started_at,
          cycle_cutoff = EXCLUDED.cycle_cutoff,
          checked = EXCLUDED.checked,
          repaired = EXCLUDED.repaired,
          failed = EXCLUDED.failed,
          last_completed_at = EXCLUDED.last_completed_at,
          reconciled_through = EXCLUDED.reconciled_through,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.organization_id,
        row.cursor,
        row.cycle_started_at,
        row.cycle_cutoff,
        row.checked,
        row.repaired,
        row.failed,
        row.last_completed_at,
        row.reconciled_through,
        row.updated_at,
      ],
    );
    signal?.throwIfAborted();
  }

  const restored = await readDiscoveryStateSnapshot(pool, signal);
  invariant(restored.exists === snapshot.exists, 'discovery cursor row presence was not restored');
  if (snapshot.exists) {
    deepStrictEqual(restored.row, snapshot.row, 'discovery cursor row was not restored exactly');
  }
}

export function assertExactDiscoveryCoverage(
  discoveredOrganizations: string[],
  expectedOrganizations: string[],
  label: string,
): void {
  const expected = new Set(expectedOrganizations);
  invariant(
    expected.size === expectedOrganizations.length,
    `${label} expected tenant set contained a duplicate`,
  );
  invariant(
    discoveredOrganizations.length === expectedOrganizations.length,
    `${label} discovery cardinality was ${discoveredOrganizations.length}; expected ${expectedOrganizations.length}`,
  );
  const discovered = new Set(discoveredOrganizations);
  invariant(
    discovered.size === discoveredOrganizations.length,
    `${label} discovery returned a duplicate tenant`,
  );
  for (const organizationId of expected) {
    invariant(
      discovered.has(organizationId),
      `${label} discovery omitted tenant ${organizationId}`,
    );
  }
  for (const organizationId of discovered) {
    invariant(
      expected.has(organizationId),
      `${label} discovery returned extra tenant ${organizationId}`,
    );
  }
}

async function verifyDiscoveryCursorDurability(
  context: FindingsAcceptanceContext,
  expectedOrganizations: string[],
  observationOnlyOrganizationId: string,
): Promise<void> {
  const locked = await context.lockService.withOrganizationLock(
    DISCOVERY_LOCK_ID,
    async () => {
      context.signal.throwIfAborted();
      const snapshot = await readDiscoveryStateSnapshot(context.pool, context.signal);
      context.signal.throwIfAborted();
      let primaryError: unknown;
      try {
        const first = await context.analytics.listFindingObservationOrganizationsPage(
          undefined,
          100,
        );
        context.signal.throwIfAborted();
        invariant(
          first.organizationIds.length === 100 && first.afterKey !== null,
          'discovery did not produce a full first page with a continuation cursor',
        );
        await context.repository.saveFindingObservationDiscoveryCursor(first.afterKey);
        context.signal.throwIfAborted();

        const restartedRepository = new FindingTriageRepository(
          context.db as unknown as NodePgDatabase,
        );
        const resumed = await restartedRepository.getFindingObservationDiscoveryCursor();
        context.signal.throwIfAborted();
        deepStrictEqual(resumed, first.afterKey, 'persisted discovery cursor was not restart-safe');

        const discovered = [...first.organizationIds];
        let afterKey: { indexName: string; organizationId: string } | undefined =
          resumed ?? undefined;
        let pages = 1;
        while (afterKey) {
          context.signal.throwIfAborted();
          const page = await context.analytics.listFindingObservationOrganizationsPage(
            afterKey,
            100,
          );
          context.signal.throwIfAborted();
          discovered.push(...page.organizationIds);
          pages += 1;
          await restartedRepository.saveFindingObservationDiscoveryCursor(page.afterKey);
          context.signal.throwIfAborted();
          afterKey = page.afterKey ?? undefined;
          invariant(pages < 10, 'discovery cursor did not wrap within the bounded test corpus');
        }
        invariant(pages > 1, 'discovery did not cross a composite aggregation page');
        const expectedSet = new Set(expectedOrganizations);
        assertExactDiscoveryCoverage(
          discovered.filter((organizationId) => expectedSet.has(organizationId)),
          expectedOrganizations,
          'restart/wrap cycle',
        );

        const processAfterWrap = new FindingTriageRepository(
          context.db as unknown as NodePgDatabase,
        );
        const wrappedCursor = await processAfterWrap.getFindingObservationDiscoveryCursor();
        context.signal.throwIfAborted();
        invariant(wrappedCursor === null, 'wrapped discovery cursor did not persist as page one');
        const pageOneAgain = await context.analytics.listFindingObservationOrganizationsPage(
          undefined,
          100,
        );
        context.signal.throwIfAborted();
        deepStrictEqual(
          pageOneAgain.organizationIds,
          first.organizationIds,
          'page-one discovery changed after persisted wrap/restart',
        );

        const secondCycle: string[] = [];
        let secondCycleAfterKey: { indexName: string; organizationId: string } | undefined;
        let secondCyclePages = 0;
        do {
          context.signal.throwIfAborted();
          const page = await context.analytics.listFindingObservationOrganizationsPage(
            secondCycleAfterKey,
            100,
          );
          context.signal.throwIfAborted();
          secondCycle.push(...page.organizationIds);
          secondCycleAfterKey = page.afterKey ?? undefined;
          await processAfterWrap.saveFindingObservationDiscoveryCursor(page.afterKey);
          context.signal.throwIfAborted();
          secondCyclePages += 1;
          invariant(
            secondCyclePages < 10,
            'second discovery cycle did not wrap within the bounded test corpus',
          );
        } while (secondCycleAfterKey);
        assertExactDiscoveryCoverage(
          secondCycle.filter((organizationId) => expectedSet.has(organizationId)),
          expectedOrganizations,
          'post-wrap cycle',
        );
        const secondWrappedCursor = await processAfterWrap.getFindingObservationDiscoveryCursor();
        context.signal.throwIfAborted();
        invariant(
          secondWrappedCursor === null,
          'second wrapped discovery cursor did not persist as page one',
        );

        const discoveredSet = new Set(discovered);
        for (const organizationId of expectedOrganizations) {
          invariant(discoveredSet.has(organizationId), `discovery omitted ${organizationId}`);
        }
        const triage = await context.pool.query<{ count: number }>(
          `
            SELECT count(*)::int AS count
            FROM finding_triage
            WHERE organization_id = $1
          `,
          [observationOnlyOrganizationId],
        );
        context.signal.throwIfAborted();
        invariant(
          triage.rows[0]?.count === 0 && discoveredSet.has(observationOnlyOrganizationId),
          'observation-only organization was not discovered without triage rows',
        );
      } catch (error) {
        primaryError = error;
      }

      let restoreError: unknown;
      try {
        await context.runRecoveryOperation(() =>
          restoreDiscoveryStateSnapshot(context.pool, snapshot, context.signal),
        );
      } catch (error) {
        restoreError = error;
      }
      if (primaryError !== undefined && restoreError !== undefined) {
        throw new AggregateError(
          [primaryError, restoreError],
          'Discovery acceptance and cursor restoration both failed',
        );
      }
      if (primaryError !== undefined) throw primaryError;
      if (restoreError !== undefined) throw restoreError;
    },
    context.signal,
  );
  invariant(locked.acquired, 'global discovery reconciliation lock was unavailable');
}

async function verifyCompositeDiscovery(context: FindingsAcceptanceContext): Promise<void> {
  context.log('[findings-opensearch] exercising multi-page composite tenant discovery');
  await assertForgedDiscoveryPairRejected(context);

  const caseRoot = `findings-os-case-${context.ids.suiteId}`;
  const caseOrganizations = [caseRoot, caseRoot.toUpperCase(), ` ${caseRoot} `];
  for (let index = 0; index < caseOrganizations.length; index += 1) {
    context.signal.throwIfAborted();
    await createObservationOnlyIndex(context, caseOrganizations[index]!, `case-${index}`, true);
    await verifyOrganizationStorage(context, caseOrganizations[index]!);
  }
  invariant(
    new Set(caseOrganizations.map(buildFindingObservationIndexName)).size ===
      caseOrganizations.length,
    'case/whitespace-distinct organization IDs collapsed to one index',
  );
  invariant(
    new Set(caseOrganizations.map(buildOrganizationFindingsIndexTemplateName)).size ===
      caseOrganizations.length,
    'case/whitespace-distinct organization IDs collapsed to one template',
  );

  const directOrganizations = Array.from(
    { length: DISCOVERY_ORGANIZATION_COUNT - caseOrganizations.length },
    (_, index) =>
      `findings-os-discovery-${context.ids.suiteId}-${index.toString().padStart(3, '0')}`,
  );
  for (let offset = 0; offset < directOrganizations.length; offset += 8) {
    context.signal.throwIfAborted();
    await Promise.all(
      directOrganizations
        .slice(offset, offset + 8)
        .map((organizationId, index) =>
          createObservationOnlyIndex(context, organizationId, `direct-${offset + index}`, false),
        ),
    );
  }
  const discoveryIndexNames = [
    ...caseOrganizations.map(buildFindingObservationIndexName),
    ...directOrganizations.map(buildFindingObservationIndexName),
  ];
  for (const indexNames of chunkExactOpenSearchIndexNames(discoveryIndexNames)) {
    context.signal.throwIfAborted();
    await context.client.indices.refresh({ index: indexNames });
  }

  await verifyDiscoveryCursorDurability(
    context,
    [...caseOrganizations, ...directOrganizations],
    directOrganizations[0]!,
  );
}

async function verifyPitAndDiscovery(context: FindingsAcceptanceContext): Promise<void> {
  await verifyLongLivedPit(context);
  await verifyCompositeDiscovery(context);
}

async function discoverOwnedDatabaseRows(context: FindingsAcceptanceContext): Promise<void> {
  const organizations = context.ledger.snapshot().organizationIds;
  if (organizations.length === 0) return;
  context.signal.throwIfAborted();
  const auditRows = await context.pool.query<{ id: string }>(
    'SELECT id FROM audit_logs WHERE organization_id = ANY($1::varchar[])',
    [organizations],
  );
  context.signal.throwIfAborted();
  for (const row of auditRows.rows) context.ledger.trackAuditRow(row.id);
  context.signal.throwIfAborted();
  const outboxRows = await context.pool.query<{ id: string }>(
    'SELECT id FROM outbox_events WHERE organization_id = ANY($1::varchar[])',
    [organizations],
  );
  context.signal.throwIfAborted();
  for (const row of outboxRows.rows) context.ledger.trackOutboxEvent(row.id);
}

async function openSearchIndexExists(client: Client, indexName: string): Promise<boolean> {
  const response = (await client.indices.exists({ index: indexName })) as unknown as {
    body: boolean;
  };
  return response.body === true;
}

export async function executeExactCleanupOperations(
  label: string,
  operations: (() => Promise<void>)[],
  concurrency = 8,
  signal?: AbortSignal,
): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Exact cleanup concurrency must be a positive integer');
  }
  const errors: unknown[] = [];
  for (let offset = 0; offset < operations.length; offset += concurrency) {
    signal?.throwIfAborted();
    const results = await Promise.allSettled(
      operations.slice(offset, offset + concurrency).map((operation) => operation()),
    );
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `${label} failed for ${errors.length} exact operation(s)`);
  }
}

export interface FindingsCleanupStages<TManifest> {
  discoverOwnedDatabaseRows(): Promise<void>;
  snapshot(): TManifest;
  cleanupOpenSearchResources(manifest: TManifest): Promise<void>;
  cleanupDatabaseResources(manifest: TManifest): Promise<void>;
}

export async function executeFindingsCleanupStages<TManifest>(
  stages: FindingsCleanupStages<TManifest>,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await stages.discoverOwnedDatabaseRows();
  } catch (error) {
    errors.push(error);
  }

  const manifest = stages.snapshot();
  try {
    await stages.cleanupOpenSearchResources(manifest);
  } catch (error) {
    errors.push(error);
  }
  try {
    await stages.cleanupDatabaseResources(manifest);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Findings cleanup stages failed independently');
  }
}

function exactDocumentResourceKey(indexName: string, documentId: string): string {
  return `${indexName}\u0000${documentId}`;
}

function exactDocumentResourceSet(indexName: string, documentIds: string[]): Set<string> {
  assertExactResourceName(indexName, 'OpenSearch index');
  const resources = new Set<string>();
  for (const documentId of documentIds) {
    assertExactResourceName(documentId, 'OpenSearch document ID');
    resources.add(exactDocumentResourceKey(indexName, documentId));
  }
  if (resources.size !== documentIds.length) {
    throw new Error('Exact OpenSearch deletion proof received duplicate document IDs');
  }
  return resources;
}

export function assertExactBulkDeleteResponse(
  response: unknown,
  indexName: string,
  documentIds: string[],
): void {
  const expected = exactDocumentResourceSet(indexName, documentIds);
  if (!isRecord(response) || !isRecord(response.body) || !Array.isArray(response.body.items)) {
    throw new Error('OpenSearch bulk deletion did not return one exact item per document');
  }
  if (response.body.items.length !== expected.size) {
    throw new Error('OpenSearch bulk deletion did not return one exact item per document');
  }

  const seen = new Set<string>();
  for (const item of response.body.items) {
    if (!isRecord(item) || !isRecord(item.delete)) {
      throw new Error('OpenSearch bulk deletion returned a malformed delete item');
    }
    const resourceIndex = item.delete._index;
    const documentId = item.delete._id;
    const status = item.delete.status;
    if (
      typeof resourceIndex !== 'string' ||
      typeof documentId !== 'string' ||
      (status !== 200 && status !== 404) ||
      item.delete.error !== undefined
    ) {
      throw new Error('OpenSearch bulk deletion returned a failed or malformed delete item');
    }
    const key = exactDocumentResourceKey(resourceIndex, documentId);
    if (!expected.has(key) || seen.has(key)) {
      throw new Error('OpenSearch bulk deletion returned an unexpected or duplicate document');
    }
    seen.add(key);
  }
  if (seen.size !== expected.size) {
    throw new Error('OpenSearch bulk deletion did not return one exact item per document');
  }
}

export function assertExactMgetDeletionResponse(
  response: unknown,
  indexName: string,
  documentIds: string[],
): void {
  const expected = exactDocumentResourceSet(indexName, documentIds);
  if (!isRecord(response) || !isRecord(response.body) || !Array.isArray(response.body.docs)) {
    throw new Error(
      'OpenSearch mget deletion proof did not return one exact document per requested ID',
    );
  }
  if (response.body.docs.length !== expected.size) {
    throw new Error(
      'OpenSearch mget deletion proof did not return one exact document per requested ID',
    );
  }

  const seen = new Set<string>();
  for (const document of response.body.docs) {
    if (
      !isRecord(document) ||
      typeof document._index !== 'string' ||
      typeof document._id !== 'string'
    ) {
      throw new Error('OpenSearch mget deletion proof returned a malformed document');
    }
    const key = exactDocumentResourceKey(document._index, document._id);
    if (!expected.has(key) || seen.has(key)) {
      throw new Error(
        'OpenSearch mget deletion proof returned an unexpected or duplicate document',
      );
    }
    if (document.found !== false) {
      throw new Error(`OpenSearch document ${document._id} still exists after exact deletion`);
    }
    seen.add(key);
  }
  if (seen.size !== expected.size) {
    throw new Error(
      'OpenSearch mget deletion proof did not return one exact document per requested ID',
    );
  }
}

async function deleteExactDocuments(
  context: FindingsAcceptanceContext,
  manifest: FindingsOpenSearchResourceManifest,
): Promise<void> {
  const ownedIndexes = new Set(manifest.indexNames);
  const documentsByIndex = new Map<string, string[]>();
  for (const resource of manifest.documents) {
    if (ownedIndexes.has(resource.indexName)) continue;
    const ids = documentsByIndex.get(resource.indexName) ?? [];
    ids.push(resource.documentId);
    documentsByIndex.set(resource.indexName, ids);
  }

  await executeExactCleanupOperations(
    'Exact OpenSearch document cleanup',
    [...documentsByIndex].map(([indexName, documentIds]) => async () => {
      context.signal.throwIfAborted();
      if (!(await openSearchIndexExists(context.client, indexName))) return;
      for (let offset = 0; offset < documentIds.length; offset += 500) {
        const ids = documentIds.slice(offset, offset + 500);
        const response = await context.client.bulk({
          refresh: false,
          body: ids.map((documentId) => ({
            delete: { _index: indexName, _id: documentId },
          })),
        });
        assertExactBulkDeleteResponse(response, indexName, ids);
      }
      await context.client.indices.refresh({ index: indexName });
      for (let offset = 0; offset < documentIds.length; offset += 500) {
        const ids = documentIds.slice(offset, offset + 500);
        const response = await context.client.mget({
          index: indexName,
          body: { ids },
        });
        assertExactMgetDeletionResponse(response, indexName, ids);
      }
    }),
    8,
    context.signal,
  );
}

async function cleanupOpenSearchResources(
  context: FindingsAcceptanceContext,
  manifest: FindingsOpenSearchResourceManifest,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await deleteExactDocuments(context, manifest);
  } catch (error) {
    errors.push(error);
  }
  try {
    const indexChunks = chunkExactOpenSearchIndexNames(manifest.indexNames);
    await executeExactCleanupOperations(
      'Exact OpenSearch index cleanup',
      indexChunks.map((indexNames) => async () => {
        const response = (await context.client.indices.delete({
          index: indexNames,
          ignore_unavailable: true,
        })) as unknown as { body?: { acknowledged?: boolean } };
        if (response.body?.acknowledged !== true) {
          throw new Error(
            `OpenSearch did not acknowledge exact index cleanup for ${indexNames.join(',')}`,
          );
        }
      }),
      4,
      context.signal,
    );
  } catch (error) {
    errors.push(error);
  }
  try {
    const indexChunks = chunkExactOpenSearchIndexNames(manifest.indexNames);
    await executeExactCleanupOperations(
      'Exact OpenSearch index removal proof',
      indexChunks.map((indexNames) => async () => {
        let returned: Record<string, unknown> = {};
        try {
          const response = (await context.client.indices.get({
            index: indexNames,
            allow_no_indices: true,
            ignore_unavailable: true,
          })) as unknown as { body?: Record<string, unknown> };
          returned = response.body ?? {};
        } catch (error) {
          if (responseStatus(error) !== 404) throw error;
        }
        const requested = new Set(indexNames);
        const residual = Object.keys(returned).filter((indexName) => requested.has(indexName));
        invariant(
          residual.length === 0,
          `OpenSearch cleanup could not prove exact index removal: ${residual.join(',')}`,
        );
      }),
      4,
      context.signal,
    );
  } catch (error) {
    errors.push(error);
  }

  try {
    await executeExactCleanupOperations(
      'Exact OpenSearch index-template cleanup',
      manifest.indexTemplateNames.map((templateName) => async () => {
        try {
          await context.client.indices.deleteIndexTemplate({ name: templateName });
        } catch (error) {
          if (responseStatus(error) !== 404) throw error;
        }
      }),
      8,
      context.signal,
    );
  } catch (error) {
    errors.push(error);
  }
  try {
    await executeExactCleanupOperations(
      'Exact OpenSearch index-template removal proof',
      manifest.indexTemplateNames.map((templateName) => async () => {
        let exists = true;
        try {
          await context.client.indices.getIndexTemplate({ name: templateName });
        } catch (error) {
          if (responseStatus(error) === 404) exists = false;
          else throw error;
        }
        invariant(!exists, `OpenSearch cleanup could not prove template removal: ${templateName}`);
      }),
      8,
      context.signal,
    );
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Exact OpenSearch fixture cleanup or proof failed');
  }
}

async function cleanupDatabaseResources(
  context: FindingsAcceptanceContext,
  manifest: FindingsOpenSearchResourceManifest,
): Promise<void> {
  context.signal.throwIfAborted();
  const client = await context.pool.connect();
  try {
    context.signal.throwIfAborted();
  } catch (error) {
    client.release();
    throw error;
  }
  await executeAbortablePostgresTransaction(
    client,
    buildFindingsCleanupStatements(manifest),
    context.signal,
  );

  const checks: { table: string; column: string; cast: string; values: string[] }[] = [
    { table: 'audit_logs', column: 'id', cast: 'uuid', values: manifest.auditRowIds },
    { table: 'outbox_events', column: 'id', cast: 'uuid', values: manifest.outboxEventIds },
    { table: 'finding_triage', column: 'id', cast: 'uuid', values: manifest.triageRowIds },
    { table: 'workflow_runs', column: 'run_id', cast: 'text', values: manifest.workflowRunIds },
    { table: 'scopes', column: 'id', cast: 'uuid', values: manifest.scopeIds },
    { table: 'workflows', column: 'id', cast: 'uuid', values: manifest.workflowIds },
    {
      table: 'finding_projection_reconciliation',
      column: 'organization_id',
      cast: 'varchar',
      values: manifest.organizationIds,
    },
  ];
  for (const check of checks) {
    if (check.values.length === 0) continue;
    context.signal.throwIfAborted();
    const result = await context.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${check.table} WHERE ${check.column} = ANY($1::${check.cast}[])`,
      [check.values],
    );
    context.signal.throwIfAborted();
    invariant(
      result.rows[0]?.count === 0,
      `PostgreSQL cleanup could not prove exact removal from ${check.table}`,
    );
  }

  if (manifest.organizationIds.length > 0) {
    for (const [table, column] of [
      ['audit_logs', 'organization_id'],
      ['outbox_events', 'organization_id'],
      ['finding_triage', 'organization_id'],
      ['workflow_runs', 'organization_id'],
      ['scopes', 'organization_id'],
      ['workflows', 'organization_id'],
      ['finding_projection_reconciliation', 'organization_id'],
    ] as const) {
      context.signal.throwIfAborted();
      const result = await context.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${table} WHERE ${column} = ANY($1::varchar[])`,
        [manifest.organizationIds],
      );
      context.signal.throwIfAborted();
      invariant(
        result.rows[0]?.count === 0,
        `PostgreSQL cleanup found an untracked fixture row in ${table}`,
      );
    }
  }
}

export async function executeTwoConsecutiveZeroPasses(
  runExactZeroPass: () => Promise<void>,
  waitBetweenPasses: () => Promise<void>,
  signal: AbortSignal,
  maxAttempts = 6,
): Promise<void> {
  let consecutiveZeroPasses = 0;
  const transientErrors: unknown[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    signal.throwIfAborted();
    try {
      await runExactZeroPass();
      consecutiveZeroPasses += 1;
      if (consecutiveZeroPasses === 2) return;
    } catch (error) {
      transientErrors.push(error);
      consecutiveZeroPasses = 0;
    }
    signal.throwIfAborted();
    await waitBetweenPasses();
  }
  throw new AggregateError(
    transientErrors,
    'PostgreSQL fixture cleanup did not reach two consecutive exact zero passes',
  );
}

async function cleanupDatabaseResourcesUntilQuiescent(
  context: FindingsAcceptanceContext,
  initialManifest: FindingsOpenSearchResourceManifest,
): Promise<void> {
  let manifest = initialManifest;
  let firstPass = true;
  await executeTwoConsecutiveZeroPasses(
    async () => {
      if (!firstPass) {
        await discoverOwnedDatabaseRows(context);
        manifest = context.ledger.snapshot();
      }
      firstPass = false;
      await cleanupDatabaseResources(context, manifest);
    },
    () => context.sleep(500, context.signal),
    context.signal,
  );
}

async function cleanupOpenSearchAndRestoreBootstrap(
  context: FindingsAcceptanceContext,
  manifest: FindingsOpenSearchResourceManifest,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    if (!context.globalBootstrapSnapshot) {
      context.globalBootstrapSnapshot = await installAndCaptureGlobalFindingsBootstrap(
        context.client,
      );
    }
    await restoreGlobalFindingsBootstrapSnapshot(context.client, context.globalBootstrapSnapshot);
  } catch (error) {
    errors.push(error);
  }
  try {
    await cleanupOpenSearchResources(context, manifest);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Global findings bootstrap restoration and exact fixture cleanup both failed',
    );
  }
}

async function cleanupAcceptanceResources(context: FindingsAcceptanceContext): Promise<void> {
  context.log('[findings-opensearch] removing and proving exact fixture resources');
  await executeFindingsCleanupStages({
    discoverOwnedDatabaseRows: () => discoverOwnedDatabaseRows(context),
    snapshot: () => context.ledger.snapshot(),
    cleanupOpenSearchResources: (manifest) =>
      cleanupOpenSearchAndRestoreBootstrap(context, manifest),
    cleanupDatabaseResources: (manifest) =>
      cleanupDatabaseResourcesUntilQuiescent(context, manifest),
  });
}

export async function runFindingsOpenSearchAcceptance(
  env: ScriptEnvironment = process.env,
  log: (message: string) => void = console.log,
  dependencies: FindingsOpenSearchAcceptanceDependencies = {},
): Promise<void> {
  const config = resolveFindingsOpenSearchAcceptanceConfig(env);
  log(formatDatabaseTarget(config.databaseTarget));
  log(`Connection: ${config.databaseTarget.redactedConnectionString}`);
  log(`OpenSearch target: ${config.redactedOpenSearchUrl}`);
  log(`Findings OpenSearch acceptance instance: ${config.instance}`);

  const randomUuid = dependencies.randomUuid ?? randomUUID;
  const ids = createIdentifiers(config.instance, randomUuid);
  let activeSignal = new AbortController().signal;
  const rawClient =
    dependencies.createOpenSearchClient?.(config) ??
    new Client({
      node: config.openSearchUrl,
      ssl: { rejectUnauthorized: env.NODE_ENV === 'production' },
      maxRetries: 0,
      requestTimeout: FINDINGS_OPENSEARCH_REQUEST_TIMEOUT_MS,
    });
  const client = createAbortableOpenSearchClient(rawClient, () => activeSignal);
  const pool =
    dependencies.createPool?.(config.databaseTarget.connectionString) ??
    new Pool({
      connectionString: config.databaseTarget.connectionString,
      max: 8,
      connectionTimeoutMillis: 10_000,
      statement_timeout: FINDINGS_OPENSEARCH_STATEMENT_TIMEOUT_MS,
      query_timeout: FINDINGS_OPENSEARCH_QUERY_TIMEOUT_MS,
      lock_timeout: FINDINGS_OPENSEARCH_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: FINDINGS_OPENSEARCH_STATEMENT_TIMEOUT_MS,
    });
  const db = drizzle(pool, { schema: databaseSchema });
  const repository = new FindingTriageRepository(db as unknown as NodePgDatabase);
  const analytics = new SecurityAnalyticsService(openSearchClientForService(client) as never);
  const lockService = new FindingProjectionReconciliationLockService(pool);
  const reconciler = new FindingTriageReconcilerService(repository, analytics, lockService);
  const corpusFixtures = buildFindingsCorpusFixtures({
    organizationId: ids.corpusOrganizationId,
    workflowId: ids.workflowId,
    runId: `${ids.scopedRunId}-corpus`,
    scopeId: ids.scopeId,
    componentId: 'test.analytics.fixture',
    nodeRef: 'corpus-node',
  });
  const largeFixtures = buildLargeFindingsFixtures({
    organizationId: ids.primaryOrganizationId,
    workflowId: ids.workflowId,
    scopeId: ids.scopeId,
    scopedRunId: ids.scopedRunId,
    unscopedRunId: ids.unscopedRunId,
    count: LARGE_FINDINGS_COUNT,
    now: dependencies.now?.() ?? new Date(),
  });
  const context: FindingsAcceptanceContext = {
    config,
    client,
    pool,
    db,
    analytics,
    repository,
    reconciler,
    lockService,
    ledger: new FindingsOpenSearchResourceLedger(),
    ids,
    corpusFixtures,
    largeFixtures,
    fetchImpl: dependencies.fetchImpl ?? fetch,
    signal: activeSignal,
    activateSignal(signal) {
      activeSignal = signal;
      context.signal = signal;
    },
    async runRecoveryOperation(operation) {
      const phaseSignal = context.signal;
      const recoveryScope = createReferencedAbortScope(
        FINDINGS_OPENSEARCH_RECOVERY_TIMEOUT_MS,
        'findings acceptance scoped recovery',
      );
      activeSignal = recoveryScope.signal;
      context.signal = recoveryScope.signal;
      let operationError: unknown;
      try {
        await operation();
      } catch (error) {
        operationError = error;
      } finally {
        recoveryScope.dispose();
        activeSignal = phaseSignal;
        context.signal = phaseSignal;
      }

      const phaseError = phaseSignal.aborted
        ? (phaseSignal.reason ?? new Error('Findings acceptance phase aborted during recovery'))
        : undefined;
      if (operationError !== undefined && phaseError !== undefined) {
        throw new AggregateError(
          [operationError, phaseError],
          'Findings recovery failed while its owning phase was aborted',
        );
      }
      if (operationError !== undefined) throw operationError;
      if (phaseError !== undefined) throw phaseError;
    },
    sleep: (ms, signal) =>
      sleepWithAbort(
        ms,
        signal,
        dependencies.sleep ? (delay) => dependencies.sleep!(delay, signal) : undefined,
      ),
    log,
  };

  let acceptanceError: unknown;
  try {
    await executeFindingsOpenSearchAcceptancePlan({
      verifyTopologyAndBootstrap: (signal) => {
        context.activateSignal(signal);
        return verifyTopologyAndBootstrap(context);
      },
      verifyFirstUseAndCorpus: (signal) => {
        context.activateSignal(signal);
        return verifyFirstUseAndCorpus(context);
      },
      verifyDriftAndFailureSemantics: (signal) => {
        context.activateSignal(signal);
        return verifyDriftAndFailureSemantics(context);
      },
      verifyLargeReadModels: (signal) => {
        context.activateSignal(signal);
        return verifyLargeReadModels(context);
      },
      verifyPitAndDiscovery: (signal) => {
        context.activateSignal(signal);
        return verifyPitAndDiscovery(context);
      },
      cleanup: (signal) => {
        context.activateSignal(signal);
        return cleanupAcceptanceResources(context);
      },
    });
    log('[findings-opensearch] real OpenSearch acceptance passed');
  } catch (error) {
    acceptanceError = error;
  }

  const closeErrors: unknown[] = [];
  try {
    await executeCooperativeDeadline(
      'findings acceptance client shutdown',
      FINDINGS_OPENSEARCH_CLOSE_TIMEOUT_MS - 10_000,
      10_000,
      async () => {
        const results = await Promise.allSettled([pool.end(), rawClient.close()]);
        for (const result of results) {
          if (result.status === 'rejected') closeErrors.push(result.reason);
        }
      },
      undefined,
      { schedule: setTimeout, cancel: clearTimeout },
    );
  } catch (error) {
    closeErrors.push(error);
  }
  if (acceptanceError !== undefined && closeErrors.length > 0) {
    throw new AggregateError(
      [acceptanceError, ...closeErrors],
      'Findings OpenSearch acceptance and client shutdown failed',
    );
  }
  if (acceptanceError !== undefined) throw acceptanceError;
  if (closeErrors.length === 1) throw closeErrors[0];
  if (closeErrors.length > 1) {
    throw new AggregateError(closeErrors, 'Findings OpenSearch clients failed to close');
  }
}

if (import.meta.main) {
  const standaloneTimer = setTimeout(() => {
    console.error(
      `Findings OpenSearch acceptance exceeded its ${FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS}ms standalone bound`,
    );
    process.exit(1);
  }, FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS);
  runFindingsOpenSearchAcceptance()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(standaloneTimer));
}
