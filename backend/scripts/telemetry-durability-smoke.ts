/* eslint-disable no-console -- This file is an explicit, operator-invoked release smoke. */

import 'reflect-metadata';

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
  type ScriptDatabaseTarget,
} from '@sentris/local-runtime';
import { DURABLE_KAFKA_PUBLISH_EVENT, durableTelemetryKafkaProducerConfig } from '@sentris/shared';
import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import { KafkaTopicResolver } from '../src/common/kafka-topic-resolver';
import { assertDatabaseMigrationsCurrent } from '../src/database/migration.guard';
import { loadMigrationPlan } from '../src/database/migrations/checked-migrations';
import { PostgresMigrationDatabase } from '../src/database/migrations/postgres-migration-database';
import { KafkaLogAdapter } from '../../worker/src/adapters/kafka-log.adapter';
import { KafkaTraceAdapter } from '../../worker/src/adapters/kafka-trace.adapter';
import { PostgresDurableKafkaFallback } from '../../worker/src/common/durable-kafka-fallback';

export const TELEMETRY_DURABILITY_DATABASE_URL_ENV = 'TELEMETRY_DURABILITY_SMOKE_DATABASE_URL';
export const TELEMETRY_DURABILITY_PHASE_TIMEOUT_MS = 150_000;
export const TELEMETRY_DURABILITY_CLOSE_TIMEOUT_MS = 30_000;
export const TELEMETRY_DURABILITY_STANDALONE_TIMEOUT_MS =
  TELEMETRY_DURABILITY_PHASE_TIMEOUT_MS + TELEMETRY_DURABILITY_CLOSE_TIMEOUT_MS + 10_000;
export const TELEMETRY_DURABILITY_POLL_TIMEOUT_MS = 90_000;
export const TELEMETRY_DURABILITY_HTTP_TIMEOUT_MS = 5_000;
export const TELEMETRY_DURABILITY_STARTED_AT_MAX_AGE_MS = 60 * 60 * 1_000;
export const TELEMETRY_DURABILITY_STARTED_AT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const TELEMETRY_DURABILITY_EXTERNAL_CLEANUP_REQUIREMENT = Object.freeze({
  postgres: 'exact-fixture-delete',
  kafka: 'disposable-volume-teardown',
  loki: 'disposable-volume-teardown',
});
export const TELEMETRY_DURABILITY_COVERAGE = Object.freeze({
  liveProjection: ['events', 'logs'],
  allRequiredReadiness: ['events', 'logs', 'agent-trace', 'node-io'],
  sharedMechanismStaticProof: ['agent-trace', 'node-io'],
});

const DESTRUCTIVE_OPT_IN_ENV = 'SENTRIS_ALLOW_TELEMETRY_DURABILITY_SMOKE';
const DISPOSABLE_PROJECT_OPT_IN_ENV = 'SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT';
const PHASE_ENV = 'TELEMETRY_DURABILITY_SMOKE_PHASE';
const BACKEND_URL_ENV = 'TELEMETRY_DURABILITY_SMOKE_BACKEND_URL';
const INTERNAL_TOKEN_ENV = 'TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN';
const KAFKA_BROKERS_ENV = 'TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS';
const EVENT_TOPIC_BASE_ENV = 'TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE';
const LOG_TOPIC_BASE_ENV = 'TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE';
const EVENT_GROUP_ID_ENV = 'TELEMETRY_DURABILITY_SMOKE_EVENT_GROUP_ID';
const LOG_GROUP_ID_ENV = 'TELEMETRY_DURABILITY_SMOKE_LOG_GROUP_ID';
const LOKI_URL_ENV = 'TELEMETRY_DURABILITY_SMOKE_LOKI_URL';
const LOKI_TENANT_ENV = 'TELEMETRY_DURABILITY_SMOKE_LOKI_TENANT_ID';
const LOKI_USERNAME_ENV = 'TELEMETRY_DURABILITY_SMOKE_LOKI_USERNAME';
const LOKI_PASSWORD_ENV = 'TELEMETRY_DURABILITY_SMOKE_LOKI_PASSWORD';
const SUITE_ID_ENV = 'TELEMETRY_DURABILITY_SMOKE_SUITE_ID';
const STARTED_AT_ENV = 'TELEMETRY_DURABILITY_SMOKE_STARTED_AT';
const BACKEND_GENERATION_BEFORE_ENV = 'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_BEFORE';
const BACKEND_GENERATION_AFTER_ENV = 'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_AFTER';
const RECEIPT_EVENT_TYPE = 'telemetry.kafka.ingested.v1';
const POISON_EVENT_TYPE = 'telemetry.kafka.poison.v1';
const POLL_INTERVAL_MS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TELEMETRY_DURABILITY_PHASES = [
  'direct',
  'fallback',
  'await-dead',
  'recover',
  'poison',
  'cleanup',
] as const;

export type TelemetryDurabilityPhase = (typeof TELEMETRY_DURABILITY_PHASES)[number];
type ScriptEnvironment = Record<string, string | undefined>;

export interface TelemetryDurabilityConfig {
  instance: string;
  phase: TelemetryDurabilityPhase;
  suiteId: string;
  startedAt: Date;
  composeProject: string;
  targetProfile: 'standalone' | 'production-compose';
  databaseTarget: ScriptDatabaseTarget;
  backendUrl: string;
  internalToken: string;
  kafkaBrokers: string[];
  eventTopic: string;
  logTopic: string;
  eventGroupId: string;
  logGroupId: string;
  lokiUrl: string;
  lokiTenantId?: string;
  lokiUsername?: string;
  lokiPassword?: string;
  backendGenerationBefore?: string;
  backendGenerationAfter?: string;
}

export interface TelemetryTraceFixture {
  eventId: string;
  runId: string;
  workflowId: null;
  organizationId: string;
  type: 'NODE_PROGRESS';
  nodeRef: string;
  timestamp: string;
  level: 'info';
  message: string;
  sequence: number;
}

export interface TelemetryLogFixture {
  eventId: string;
  runId: string;
  organizationId: string;
  nodeRef: string;
  stream: 'stdout';
  message: string;
  level: 'info';
  timestamp: Date;
}

export interface TelemetryScenarioFixture {
  runId: string;
  trace: TelemetryTraceFixture;
  log: TelemetryLogFixture;
}

export interface TelemetryDurabilityFixtures {
  suiteId: string;
  organizationId: string;
  direct: TelemetryScenarioFixture;
  fallback: TelemetryScenarioFixture;
  dead: Pick<TelemetryScenarioFixture, 'runId' | 'trace'>;
  poison: {
    traceValue: string;
    logValue: string;
    traceSha256: string;
    logSha256: string;
  };
  runIds: string[];
}

export interface TelemetrySqlStatement {
  name: string;
  sql: string;
  params: unknown[];
}

export interface TelemetryDurabilityReleasePlan {
  direct(): Promise<unknown>;
  fallbackDuringKafkaOutage(): Promise<unknown>;
  awaitDeadLetterWhileKafkaIsDown(): Promise<unknown>;
  recoverAfterBackendAndKafkaRestart(): Promise<unknown>;
  poisonEvidence(): Promise<unknown>;
  quiesce(): Promise<unknown>;
  cleanup(): Promise<unknown>;
}

interface OutboxRow {
  id: string;
  event_type: string;
  organization_id: string | null;
  aggregate_id: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'dead';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

interface TelemetryRuntimeContext {
  config: TelemetryDurabilityConfig;
  fixtures: TelemetryDurabilityFixtures;
  pool: Pool;
  log(message: string): void;
  activeClosers: Set<() => Promise<void>>;
}

function requiredEnvironment(env: ScriptEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set explicitly for the telemetry durability smoke`);
  }
  return value;
}

function normalizedHttpUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed;
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid-url>';
  }
}

export function telemetryDurabilityDatabaseName(instance: string): string {
  if (!/^\d$/.test(instance)) {
    throw new Error('Telemetry durability database name requires an instance from 0 to 9');
  }
  return `sentris_telemetry_durability_smoke_i${instance}`;
}

export function telemetryDurabilityComposeProjectName(instance: string): string {
  if (!/^\d$/.test(instance)) {
    throw new Error('Telemetry durability Compose project requires an instance from 0 to 9');
  }
  return `sentris-telemetry-durability-smoke-i${instance}`;
}

export function telemetryDurabilityProductionComposeProjectName(instance: string): string {
  if (!/^\d$/.test(instance)) {
    throw new Error(
      'Telemetry durability production Compose project requires an instance from 0 to 9',
    );
  }
  return `sentris-production-smoke-${instance}`;
}

export function resolveTelemetryDurabilityConfig(
  env: ScriptEnvironment = process.env,
): TelemetryDurabilityConfig {
  const instance = env.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error('SENTRIS_INSTANCE must be set explicitly for the telemetry durability smoke');
  }
  if (!/^\d$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }
  if (env.CI !== 'true' && env[DESTRUCTIVE_OPT_IN_ENV] !== 'true') {
    throw new Error(
      `Telemetry durability smoke is destructive; run in CI or set ${DESTRUCTIVE_OPT_IN_ENV}=true`,
    );
  }
  if (env[DISPOSABLE_PROJECT_OPT_IN_ENV] !== 'true') {
    throw new Error(`Telemetry durability smoke requires ${DISPOSABLE_PROJECT_OPT_IN_ENV}=true`);
  }

  const composeProject = requiredEnvironment(env, 'COMPOSE_PROJECT_NAME');
  const standaloneProject = telemetryDurabilityComposeProjectName(instance);
  const productionProject = telemetryDurabilityProductionComposeProjectName(instance);
  if (composeProject !== standaloneProject && composeProject !== productionProject) {
    throw new Error(
      `Telemetry durability smoke must use disposable Compose project ${standaloneProject} or ${productionProject}; project/database tuple rejected for ${composeProject}`,
    );
  }

  const databaseTarget = getScriptDatabaseTarget({
    env,
    overrideEnvVar: TELEMETRY_DURABILITY_DATABASE_URL_ENV,
  });
  if (databaseTarget.source !== `env:${TELEMETRY_DURABILITY_DATABASE_URL_ENV}`) {
    throw new Error(
      `Telemetry durability smoke requires ${TELEMETRY_DURABILITY_DATABASE_URL_ENV} to be set explicitly`,
    );
  }
  const standaloneDatabase = telemetryDurabilityDatabaseName(instance);
  const standaloneTarget =
    composeProject === standaloneProject && databaseTarget.databaseName === standaloneDatabase;
  const productionTarget =
    composeProject === productionProject && databaseTarget.databaseName === 'sentris';
  if (!standaloneTarget && !productionTarget && composeProject === standaloneProject) {
    throw new Error(
      `Telemetry durability smoke must target dedicated database ${standaloneDatabase}; received ${databaseTarget.databaseName}`,
    );
  }
  if (!standaloneTarget && !productionTarget) {
    throw new Error(
      `Telemetry durability smoke rejected project/database tuple ${composeProject}/${databaseTarget.databaseName}; expected ${standaloneProject}/${standaloneDatabase} or ${productionProject}/sentris`,
    );
  }

  const phaseValue = requiredEnvironment(env, PHASE_ENV);
  if (!TELEMETRY_DURABILITY_PHASES.includes(phaseValue as TelemetryDurabilityPhase)) {
    throw new Error(
      `Unsupported telemetry durability phase "${phaseValue}"; expected one of ${TELEMETRY_DURABILITY_PHASES.join(', ')}`,
    );
  }
  const suiteId = requiredEnvironment(env, SUITE_ID_ENV);
  if (!UUID_PATTERN.test(suiteId)) {
    throw new Error(`${SUITE_ID_ENV} must be a UUID`);
  }
  const startedAtValue = requiredEnvironment(env, STARTED_AT_ENV);
  const startedAtMillis = Date.parse(startedAtValue);
  if (
    !Number.isFinite(startedAtMillis) ||
    new Date(startedAtMillis).toISOString() !== startedAtValue
  ) {
    throw new Error(`${STARTED_AT_ENV} must be a canonical ISO-8601 instant`);
  }
  const now = Date.now();
  if (
    now - startedAtMillis > TELEMETRY_DURABILITY_STARTED_AT_MAX_AGE_MS ||
    startedAtMillis - now > TELEMETRY_DURABILITY_STARTED_AT_MAX_FUTURE_SKEW_MS
  ) {
    throw new Error(
      `${STARTED_AT_ENV} must be recent (within ${TELEMETRY_DURABILITY_STARTED_AT_MAX_AGE_MS}ms past or ${TELEMETRY_DURABILITY_STARTED_AT_MAX_FUTURE_SKEW_MS}ms future)`,
    );
  }

  const backend = normalizedHttpUrl(requiredEnvironment(env, BACKEND_URL_ENV), BACKEND_URL_ENV);
  if (backend.username || backend.password) {
    throw new Error(`${BACKEND_URL_ENV} must not contain credentials`);
  }
  const internalToken = requiredEnvironment(env, INTERNAL_TOKEN_ENV);
  const kafkaBrokers = requiredEnvironment(env, KAFKA_BROKERS_ENV)
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
  if (kafkaBrokers.length === 0 || kafkaBrokers.some((broker) => !/^[^,\s:]+:\d+$/.test(broker))) {
    throw new Error(`${KAFKA_BROKERS_ENV} must contain explicit host:port brokers`);
  }

  const resolver = new KafkaTopicResolver({
    instanceId: instance,
    topics: {
      events: requiredEnvironment(env, EVENT_TOPIC_BASE_ENV),
      logs: requiredEnvironment(env, LOG_TOPIC_BASE_ENV),
    },
  });
  const loki = normalizedHttpUrl(requiredEnvironment(env, LOKI_URL_ENV), LOKI_URL_ENV);
  const embeddedUsername = decodeURIComponent(loki.username);
  const embeddedPassword = decodeURIComponent(loki.password);
  loki.username = '';
  loki.password = '';
  const lokiUsername = env[LOKI_USERNAME_ENV]?.trim() || embeddedUsername || undefined;
  const lokiPassword = env[LOKI_PASSWORD_ENV]?.trim() || embeddedPassword || undefined;
  if (Boolean(lokiUsername) !== Boolean(lokiPassword)) {
    throw new Error(`${LOKI_USERNAME_ENV} and ${LOKI_PASSWORD_ENV} must be set together`);
  }
  const targetProfile = standaloneTarget ? 'standalone' : 'production-compose';

  return {
    instance,
    phase: phaseValue as TelemetryDurabilityPhase,
    suiteId,
    startedAt: new Date(startedAtMillis),
    composeProject,
    targetProfile,
    databaseTarget,
    backendUrl: backend.toString().replace(/\/+$/, ''),
    internalToken,
    kafkaBrokers,
    eventTopic: resolver.getEventsTopic(),
    logTopic: resolver.getLogsTopic(),
    eventGroupId: env[EVENT_GROUP_ID_ENV]?.trim() || `sentris-event-ingestor-${instance}`,
    logGroupId:
      env[LOG_GROUP_ID_ENV]?.trim() ||
      (targetProfile === 'production-compose'
        ? `sentris-backend-log-consumer-${instance}`
        : `sentris-log-ingestor-${instance}`),
    lokiUrl: loki.toString().replace(/\/+$/, ''),
    lokiTenantId: env[LOKI_TENANT_ENV]?.trim() || undefined,
    lokiUsername,
    lokiPassword,
    backendGenerationBefore: env[BACKEND_GENERATION_BEFORE_ENV]?.trim() || undefined,
    backendGenerationAfter: env[BACKEND_GENERATION_AFTER_ENV]?.trim() || undefined,
  };
}

export function formatTelemetryDurabilityTargets(config: TelemetryDurabilityConfig): string[] {
  return [
    formatDatabaseTarget(config.databaseTarget),
    `Connection: ${config.databaseTarget.redactedConnectionString}`,
    `Compose project: ${config.composeProject} (${config.targetProfile}, explicitly disposable)`,
    `Backend: ${redactUrl(config.backendUrl)}`,
    `Kafka brokers: ${config.kafkaBrokers.join(',')}`,
    `Kafka topics: events=${config.eventTopic}, logs=${config.logTopic}`,
    `Kafka consumer groups: events=${config.eventGroupId}, logs=${config.logGroupId}`,
    `Loki: ${redactUrl(config.lokiUrl)}`,
    `Instance: ${config.instance}; suite=${config.suiteId}; startedAt=${config.startedAt.toISOString()}; phase=${config.phase}`,
  ];
}

export function buildTelemetryPoolConfig(config: TelemetryDurabilityConfig): PoolConfig {
  return {
    connectionString: config.databaseTarget.connectionString,
    application_name: `sentris-telemetry-durability-smoke-i${config.instance}`,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
    lock_timeout: 3_000,
    idle_in_transaction_session_timeout: 10_000,
  };
}

function deterministicUuid(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicSequence(seed: string): number {
  return (createHash('sha256').update(seed).digest().readUInt32BE(0) % 2_147_483_646) + 1;
}

function scenarioFixture(
  suiteId: string,
  organizationId: string,
  name: 'direct' | 'fallback',
  timestamp: Date,
): TelemetryScenarioFixture {
  const runId = `sentris-run-${deterministicUuid(`${suiteId}:${name}:run`)}`;
  return {
    runId,
    trace: {
      eventId: `trace:telemetry-smoke:${suiteId}:${name}`,
      runId,
      workflowId: null,
      organizationId,
      type: 'NODE_PROGRESS',
      nodeRef: `telemetry.${name}.trace`,
      timestamp: timestamp.toISOString(),
      level: 'info',
      message: `telemetry-durability-${suiteId}-${name}-trace`,
      sequence: deterministicSequence(`${suiteId}:${name}:trace`),
    },
    log: {
      eventId: `log:telemetry-smoke:${suiteId}:${name}`,
      runId,
      organizationId,
      nodeRef: `telemetry.${name}.log`,
      stream: 'stdout',
      message: `telemetry-durability-${suiteId}-${name}-log`,
      level: 'info',
      timestamp,
    },
  };
}

export function buildTelemetryDurabilityFixtures(
  config: Pick<TelemetryDurabilityConfig, 'suiteId' | 'startedAt'>,
): TelemetryDurabilityFixtures {
  const organizationId = `telemetry-durability-smoke-${config.suiteId}`;
  const direct = scenarioFixture(
    config.suiteId,
    organizationId,
    'direct',
    new Date(config.startedAt.getTime()),
  );
  const fallback = scenarioFixture(
    config.suiteId,
    organizationId,
    'fallback',
    new Date(config.startedAt.getTime() + 10),
  );
  const deadRunId = `sentris-run-${deterministicUuid(`${config.suiteId}:dead:run`)}`;
  const deadTimestamp = new Date(config.startedAt.getTime() + 20);
  const deadTrace: TelemetryTraceFixture = {
    eventId: `trace:telemetry-smoke:${config.suiteId}:dead`,
    runId: deadRunId,
    workflowId: null,
    organizationId,
    type: 'NODE_PROGRESS',
    nodeRef: 'telemetry.dead.trace',
    timestamp: deadTimestamp.toISOString(),
    level: 'info',
    message: `telemetry-durability-${config.suiteId}-dead-trace`,
    sequence: deterministicSequence(`${config.suiteId}:dead:trace`),
  };
  const traceValue = JSON.stringify({
    organizationId,
    smokeMarker: `telemetry-durability-${config.suiteId}-poison-trace`,
    type: 'NOT_A_TRACE_TYPE',
  });
  const logValue = JSON.stringify({
    organizationId,
    smokeMarker: `telemetry-durability-${config.suiteId}-poison-log`,
    stream: 'not-a-log-stream',
  });
  return {
    suiteId: config.suiteId,
    organizationId,
    direct,
    fallback,
    dead: { runId: deadRunId, trace: deadTrace },
    poison: {
      traceValue,
      logValue,
      traceSha256: createHash('sha256').update(traceValue).digest('hex'),
      logSha256: createHash('sha256').update(logValue).digest('hex'),
    },
    runIds: [direct.runId, fallback.runId, deadRunId],
  };
}

export function durablePublicationIdentity(
  topic: string,
  key: string | null,
  value: string,
): { aggregateId: string; dedupeKey: string } {
  const aggregateId = createHash('sha256')
    .update(JSON.stringify([topic, key, value]))
    .digest('hex');
  return {
    aggregateId,
    dedupeKey: `${DURABLE_KAFKA_PUBLISH_EVENT}:${aggregateId}`,
  };
}

export function buildTelemetryCleanupStatements(
  fixtures: TelemetryDurabilityFixtures,
): TelemetrySqlStatement[] {
  return [
    {
      name: 'workflow traces',
      sql: 'DELETE FROM workflow_traces WHERE run_id = ANY($1::text[]) AND organization_id = $2',
      params: [fixtures.runIds, fixtures.organizationId],
    },
    {
      name: 'workflow log streams',
      sql: 'DELETE FROM workflow_log_streams WHERE run_id = ANY($1::text[]) AND organization_id = $2',
      params: [fixtures.runIds, fixtures.organizationId],
    },
    {
      name: 'audit logs',
      sql: 'DELETE FROM audit_logs WHERE organization_id = $1',
      params: [fixtures.organizationId],
    },
    {
      name: 'outbox events',
      sql: 'DELETE FROM outbox_events WHERE organization_id = $1',
      params: [fixtures.organizationId],
    },
  ];
}

export function buildTelemetryResidualCountStatements(
  fixtures: TelemetryDurabilityFixtures,
): TelemetrySqlStatement[] {
  return buildTelemetryCleanupStatements(fixtures).map((statement) => ({
    ...statement,
    sql: statement.sql.replace(/^DELETE FROM /, 'SELECT COUNT(*)::int AS count FROM '),
  }));
}

export async function executeTelemetryDurabilityReleasePlan(
  plan: TelemetryDurabilityReleasePlan,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await plan.direct();
    await plan.fallbackDuringKafkaOutage();
    await plan.awaitDeadLetterWhileKafkaIsDown();
    await plan.recoverAfterBackendAndKafkaRestart();
    await plan.poisonEvidence();
  } catch (error) {
    errors.push(error);
  }
  try {
    await plan.quiesce();
  } catch (error) {
    errors.push(error);
  }
  try {
    await plan.cleanup();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Telemetry durability smoke or exact cleanup failed');
  }
}

export function assertBackendGenerationChanged(
  before: string | undefined,
  after: string | undefined,
): void {
  if (!before) {
    throw new Error(
      `${BACKEND_GENERATION_BEFORE_ENV} must provide the backend generation before restart`,
    );
  }
  if (!after) {
    throw new Error(
      `${BACKEND_GENERATION_AFTER_ENV} must provide the backend generation after restart`,
    );
  }
  if (before === after) {
    throw new Error('Backend generations before and after restart must differ');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function executeCooperativeDeadline(
  name: string,
  workTimeoutMs: number,
  cleanupTimeoutMs: number,
  work: (signal: AbortSignal) => Promise<void>,
  cleanup: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const workController = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const workPromise = work(workController.signal);
  const workOutcome = workPromise.then(
    () => ({ status: 'fulfilled' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  const deadlineOutcome = new Promise<{ status: 'deadline' }>((resolveDeadline) => {
    deadlineTimer = setTimeout(() => {
      workController.abort(new Error(`${name} deadline exceeded`));
      resolveDeadline({ status: 'deadline' });
    }, workTimeoutMs);
  });
  const outcome = await Promise.race([workOutcome, deadlineOutcome]);
  if (deadlineTimer) clearTimeout(deadlineTimer);

  if (outcome.status === 'deadline') {
    await Promise.race([workOutcome, delay(cleanupTimeoutMs)]);
  }

  const cleanupController = new AbortController();
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanupOutcome = cleanup(cleanupController.signal).then(
    () => ({ status: 'fulfilled' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  const cleanupDeadline = new Promise<{ status: 'deadline' }>((resolveDeadline) => {
    cleanupTimer = setTimeout(() => {
      cleanupController.abort(new Error(`${name} cleanup deadline exceeded`));
      resolveDeadline({ status: 'deadline' });
    }, cleanupTimeoutMs);
  });
  const cleanupResult = await Promise.race([cleanupOutcome, cleanupDeadline]);
  if (cleanupTimer) clearTimeout(cleanupTimer);

  const errors: unknown[] = [];
  if (outcome.status === 'deadline') {
    errors.push(new Error(`${name} exceeded its ${workTimeoutMs}ms deadline`));
  } else if (outcome.status === 'rejected') {
    errors.push(outcome.error);
  }
  if (cleanupResult.status === 'deadline') {
    errors.push(new Error(`${name} cleanup exceeded its ${cleanupTimeoutMs}ms deadline`));
  } else if (cleanupResult.status === 'rejected') {
    errors.push(cleanupResult.error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `${name} and cooperative cleanup failed`);
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Telemetry durability assertion failed: ${message}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolveSleep, rejectSleep) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveSleep();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(signal.reason ?? new Error('Operation aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForInvariant(
  name: string,
  signal: AbortSignal,
  check: () => Promise<boolean>,
  timeoutMs = TELEMETRY_DURABILITY_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      if (await check()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await sleepWithSignal(POLL_INTERVAL_MS, signal);
  }
  const detail = lastError ? `: ${errorMessage(lastError)}` : '';
  throw new Error(`${name} did not converge within ${timeoutMs}ms${detail}`);
}

async function boundedFetch(
  input: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const propagateAbort = () =>
    controller.abort(signal.reason ?? new Error('Parent operation aborted'));
  signal.addEventListener('abort', propagateAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`HTTP request exceeded ${TELEMETRY_DURABILITY_HTTP_TIMEOUT_MS}ms`),
      ),
    TELEMETRY_DURABILITY_HTTP_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', propagateAbort);
  }
}

function apiHeaders(config: TelemetryDurabilityConfig): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-internal-token': config.internalToken,
    'x-organization-id': `telemetry-durability-smoke-${config.suiteId}`,
  };
}

async function apiJson<T>(
  context: TelemetryRuntimeContext,
  path: string,
  signal: AbortSignal,
  method = 'GET',
): Promise<T> {
  const response = await boundedFetch(
    `${context.config.backendUrl}/api/v1${path}`,
    {
      method,
      headers: apiHeaders(context.config),
    },
    signal,
  );
  if (!response.ok) {
    throw new Error(`Backend API ${method} ${path} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function waitForBackendReady(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  await waitForInvariant('backend readiness after Kafka recovery', signal, async () => {
    try {
      const response = await boundedFetch(
        `${context.config.backendUrl}/health/ready`,
        { method: 'GET' },
        signal,
      );
      return response.ok;
    } catch {
      return false;
    }
  });
}

async function requireBackendUnavailable(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  try {
    await boundedFetch(`${context.config.backendUrl}/health`, { method: 'GET' }, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return;
  }
  throw new Error(
    'Telemetry fallback/cleanup phase requires the backend process to be stopped and quiescent',
  );
}

async function requireBackendRunningButNotReady(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  const liveness = await boundedFetch(
    `${context.config.backendUrl}/health`,
    { method: 'GET' },
    signal,
  );
  invariant(liveness.ok, 'backend must be live while exercising Kafka-down dead-letter behavior');
  const readiness = await boundedFetch(
    `${context.config.backendUrl}/health/ready`,
    { method: 'GET' },
    signal,
  );
  invariant(
    !readiness.ok,
    'backend readiness must remain failed while Redpanda is intentionally unavailable',
  );
}

async function queryRows<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}

async function countRows(pool: Pool, sql: string, params: unknown[]): Promise<number> {
  const rows = await queryRows<{ count: number }>(pool, sql, params);
  return Number(rows[0]?.count ?? 0);
}

async function verifyCheckedSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const plan = loadMigrationPlan(resolve(__dirname, '../migrations'));
    await assertDatabaseMigrationsCurrent(new PostgresMigrationDatabase(client), plan);
  } finally {
    client.release();
  }
}

function receiptDedupeKey(eventId: string): string {
  return `telemetry.event.ingested:${eventId}`;
}

async function receiptCount(context: TelemetryRuntimeContext, eventId: string): Promise<number> {
  return countRows(
    context.pool,
    `SELECT COUNT(*)::int AS count
       FROM outbox_events
      WHERE organization_id = $1
        AND event_type = $2
        AND status = 'completed'
        AND dedupe_key = $3`,
    [context.fixtures.organizationId, RECEIPT_EVENT_TYPE, receiptDedupeKey(eventId)],
  );
}

async function traceProjectionCount(
  context: TelemetryRuntimeContext,
  trace: TelemetryTraceFixture,
): Promise<number> {
  return countRows(
    context.pool,
    `SELECT COUNT(*)::int AS count
       FROM workflow_traces
      WHERE organization_id = $1 AND run_id = $2 AND message = $3`,
    [context.fixtures.organizationId, trace.runId, trace.message],
  );
}

async function logProjectionState(
  context: TelemetryRuntimeContext,
  log: TelemetryLogFixture,
): Promise<{ rows: number; lineCount: number }> {
  const rows = await queryRows<{ rows: number; line_count: number }>(
    context.pool,
    `SELECT COUNT(*)::int AS rows, COALESCE(SUM(line_count), 0)::int AS line_count
       FROM workflow_log_streams
      WHERE organization_id = $1
        AND run_id = $2
        AND node_ref = $3
        AND stream = $4`,
    [context.fixtures.organizationId, log.runId, log.nodeRef, log.stream],
  );
  return {
    rows: Number(rows[0]?.rows ?? 0),
    lineCount: Number(rows[0]?.line_count ?? 0),
  };
}

async function outboxRowsForFixture(context: TelemetryRuntimeContext): Promise<OutboxRow[]> {
  return queryRows<OutboxRow>(
    context.pool,
    `SELECT id, event_type, organization_id, aggregate_id, dedupe_key, payload,
            status, attempts, max_attempts, last_error
       FROM outbox_events
      WHERE organization_id = $1`,
    [context.fixtures.organizationId],
  );
}

function publicationEventId(row: OutboxRow): string | undefined {
  if (row.event_type !== DURABLE_KAFKA_PUBLISH_EVENT) return undefined;
  const value = row.payload.value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as { eventId?: unknown };
    return typeof parsed.eventId === 'string' ? parsed.eventId : undefined;
  } catch {
    return undefined;
  }
}

async function publicationRow(
  context: TelemetryRuntimeContext,
  eventId: string,
): Promise<OutboxRow | undefined> {
  return (await outboxRowsForFixture(context)).find((row) => publicationEventId(row) === eventId);
}

function assertExactPublicationRow(
  row: OutboxRow,
  expectedTopic: string,
  expectedKey: string | null,
): void {
  const topic = row.payload.topic;
  const key = row.payload.key;
  const value = row.payload.value;
  invariant(typeof topic === 'string', `fallback row ${row.id} omitted topic`);
  invariant(key === null || typeof key === 'string', `fallback row ${row.id} used invalid key`);
  invariant(topic === expectedTopic, `fallback row ${row.id} used unexpected topic`);
  invariant(key === expectedKey, `fallback row ${row.id} used unexpected key`);
  invariant(typeof value === 'string', `fallback row ${row.id} omitted serialized value`);
  const identity = durablePublicationIdentity(topic, key, value);
  invariant(row.aggregate_id === identity.aggregateId, `fallback row ${row.id} hash drifted`);
  invariant(row.dedupe_key === identity.dedupeKey, `fallback row ${row.id} dedupe key drifted`);
}

function lokiHeaders(config: TelemetryDurabilityConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.lokiTenantId) headers['X-Scope-OrgID'] = config.lokiTenantId;
  if (config.lokiUsername && config.lokiPassword) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.lokiUsername}:${config.lokiPassword}`,
    ).toString('base64')}`;
  }
  return headers;
}

async function lokiMessageCount(
  context: TelemetryRuntimeContext,
  log: TelemetryLogFixture,
  signal: AbortSignal,
): Promise<number> {
  const start = new Date(log.timestamp.getTime() - 1_000);
  const end = new Date(log.timestamp.getTime() + 1_000);
  const selector = `{run_id="${log.runId}",node="${log.nodeRef}",stream="${log.stream}"}`;
  const params = new URLSearchParams({
    query: selector,
    direction: 'forward',
    limit: '100',
    start: (BigInt(start.getTime()) * 1_000_000n).toString(),
    end: (BigInt(end.getTime()) * 1_000_000n).toString(),
  });
  const response = await boundedFetch(
    `${context.config.lokiUrl}/loki/api/v1/query_range?${params.toString()}`,
    { method: 'GET', headers: lokiHeaders(context.config) },
    signal,
  );
  if (!response.ok) {
    throw new Error(`Loki query failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: { result?: { values?: [string, string][] }[] };
  };
  return (payload.data?.result ?? []).reduce(
    (count, stream) =>
      count + (stream.values ?? []).filter(([, message]) => message === log.message).length,
    0,
  );
}

async function apiTraceMessageCount(
  context: TelemetryRuntimeContext,
  trace: TelemetryTraceFixture,
  signal: AbortSignal,
): Promise<number> {
  const payload = await apiJson<{ events?: { message?: string }[] }>(
    context,
    `/workflows/runs/${encodeURIComponent(trace.runId)}/trace`,
    signal,
  );
  return (payload.events ?? []).filter((event) => event.message === trace.message).length;
}

async function apiLogMessageCount(
  context: TelemetryRuntimeContext,
  log: TelemetryLogFixture,
  signal: AbortSignal,
): Promise<number> {
  const start = new Date(log.timestamp.getTime() - 1_000).toISOString();
  const end = new Date(log.timestamp.getTime() + 1_000).toISOString();
  const params = new URLSearchParams({
    nodeRef: log.nodeRef,
    stream: log.stream,
    startTime: start,
    endTime: end,
    limit: '100',
  });
  const payload = await apiJson<{ logs?: { message?: string }[] }>(
    context,
    `/workflows/runs/${encodeURIComponent(log.runId)}/logs?${params.toString()}`,
    signal,
  );
  return (payload.logs ?? []).filter((entry) => entry.message === log.message).length;
}

async function verifyScenarioVisibleExactlyOnce(
  context: TelemetryRuntimeContext,
  fixture: TelemetryScenarioFixture,
  signal: AbortSignal,
): Promise<void> {
  await waitForInvariant(
    `trace/log receipts and projections for ${fixture.runId}`,
    signal,
    async () => {
      const [traceReceipts, logReceipts, traces, logState] = await Promise.all([
        receiptCount(context, fixture.trace.eventId),
        receiptCount(context, fixture.log.eventId),
        traceProjectionCount(context, fixture.trace),
        logProjectionState(context, fixture.log),
      ]);
      return (
        traceReceipts === 1 &&
        logReceipts === 1 &&
        traces === 1 &&
        logState.rows === 1 &&
        logState.lineCount === 1
      );
    },
  );

  await waitForInvariant(
    `trace/log APIs and Loki visibility for ${fixture.runId}`,
    signal,
    async () => {
      const [apiTraces, apiLogs, lokiLogs] = await Promise.all([
        apiTraceMessageCount(context, fixture.trace, signal),
        apiLogMessageCount(context, fixture.log, signal),
        lokiMessageCount(context, fixture.log, signal),
      ]);
      return apiTraces === 1 && apiLogs === 1 && lokiLogs === 1;
    },
  );
}

async function verifyTraceVisibleExactlyOnce(
  context: TelemetryRuntimeContext,
  trace: TelemetryTraceFixture,
  signal: AbortSignal,
): Promise<void> {
  await waitForInvariant(`trace receipt and API for ${trace.eventId}`, signal, async () => {
    const [receipts, projections, apiCount] = await Promise.all([
      receiptCount(context, trace.eventId),
      traceProjectionCount(context, trace),
      apiTraceMessageCount(context, trace, signal),
    ]);
    return receipts === 1 && projections === 1 && apiCount === 1;
  });
}

interface TelemetryPublishers {
  trace: KafkaTraceAdapter;
  logs: KafkaLogAdapter;
  close(): Promise<void>;
}

function createPublishers(context: TelemetryRuntimeContext): TelemetryPublishers {
  const fallback = new PostgresDurableKafkaFallback(context.pool, (message) =>
    context.log(`[telemetry-durability] ${message}`),
  );
  const logger = {
    log: (message: unknown) => context.log(String(message)),
    error: (message: unknown) => context.log(String(message)),
  };
  const trace = new KafkaTraceAdapter(
    {
      brokers: context.config.kafkaBrokers,
      topic: context.config.eventTopic,
      clientId: `telemetry-durability-trace-i${context.config.instance}`,
    },
    logger,
    fallback,
  );
  const logs = new KafkaLogAdapter(
    {
      brokers: context.config.kafkaBrokers,
      topic: context.config.logTopic,
      clientId: `telemetry-durability-log-i${context.config.instance}`,
    },
    fallback,
    logger,
  );
  return {
    trace,
    logs,
    close: async () => {
      const results = await Promise.allSettled([trace.close(), logs.close()]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Telemetry publishers failed to close');
      }
    },
  };
}

async function withPublishers(
  context: TelemetryRuntimeContext,
  operation: (publishers: TelemetryPublishers) => Promise<void>,
): Promise<void> {
  const publishers = createPublishers(context);
  const close = () => publishers.close();
  context.activeClosers.add(close);
  try {
    await operation(publishers);
  } finally {
    context.activeClosers.delete(close);
    await publishers.close();
  }
}

async function publishScenario(
  publishers: TelemetryPublishers,
  fixture: TelemetryScenarioFixture,
): Promise<void> {
  await Promise.all([publishers.trace.record(fixture.trace), publishers.logs.append(fixture.log)]);
}

async function publishTrace(
  publishers: TelemetryPublishers,
  trace: TelemetryTraceFixture,
): Promise<void> {
  await publishers.trace.record(trace);
}

async function createRawProducer(context: TelemetryRuntimeContext): Promise<Producer> {
  const producer = new Kafka({
    clientId: `telemetry-durability-poison-i${context.config.instance}`,
    brokers: context.config.kafkaBrokers,
    logLevel: KafkaLogLevel.NOTHING,
  }).producer(durableTelemetryKafkaProducerConfig());
  await producer.connect();
  return producer;
}

async function waitForConsumerGroupCaughtUp(
  context: TelemetryRuntimeContext,
  topic: string,
  groupId: string,
  signal: AbortSignal,
): Promise<void> {
  const admin = new Kafka({
    clientId: `telemetry-durability-admin-i${context.config.instance}`,
    brokers: context.config.kafkaBrokers,
    logLevel: KafkaLogLevel.NOTHING,
  }).admin();
  await admin.connect();
  try {
    await waitForInvariant(`Kafka consumer group ${groupId} on ${topic}`, signal, async () => {
      const [topicOffsets, groupOffsets] = await Promise.all([
        admin.fetchTopicOffsets(topic),
        admin.fetchOffsets({ groupId, topics: [topic] }),
      ]);
      const committed = new Map(
        (groupOffsets.find((entry) => entry.topic === topic)?.partitions ?? []).map((entry) => [
          entry.partition,
          BigInt(entry.offset),
        ]),
      );
      return topicOffsets.every(
        (partition) => (committed.get(partition.partition) ?? -1n) >= BigInt(partition.high),
      );
    });
  } finally {
    await admin.disconnect();
  }
}

async function runDirectPhase(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  context.log('[telemetry-durability] direct: checked schema and healthy Kafka fast path');
  await verifyCheckedSchema(context.pool);
  await waitForBackendReady(context, signal);
  invariant(
    (await receiptCount(context, context.fixtures.direct.trace.eventId)) === 0,
    'direct trace fixture already exists',
  );
  invariant(
    (await receiptCount(context, context.fixtures.direct.log.eventId)) === 0,
    'direct log fixture already exists',
  );

  await withPublishers(context, async (publishers) => {
    await publishScenario(publishers, context.fixtures.direct);
    await publishScenario(publishers, context.fixtures.direct);
  });
  await verifyScenarioVisibleExactlyOnce(context, context.fixtures.direct, signal);
  const directFallbackRows = (await outboxRowsForFixture(context)).filter((row) => {
    const eventId = publicationEventId(row);
    return (
      eventId === context.fixtures.direct.trace.eventId ||
      eventId === context.fixtures.direct.log.eventId
    );
  });
  invariant(
    directFallbackRows.length === 0,
    'healthy direct publication unexpectedly used the PostgreSQL fallback',
  );
}

async function runFallbackPhase(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  context.log(
    '[telemetry-durability] fallback: backend stopped, Redpanda unavailable, exact publications enter PostgreSQL',
  );
  await requireBackendUnavailable(context, signal);
  for (const eventId of [
    context.fixtures.fallback.trace.eventId,
    context.fixtures.fallback.log.eventId,
    context.fixtures.dead.trace.eventId,
  ]) {
    invariant((await publicationRow(context, eventId)) === undefined, `${eventId} already exists`);
    invariant((await receiptCount(context, eventId)) === 0, `${eventId} already has a receipt`);
  }

  await withPublishers(context, async (publishers) => {
    await Promise.all([
      publishScenario(publishers, context.fixtures.fallback),
      publishTrace(publishers, context.fixtures.dead.trace),
    ]);
  });

  const fallbackTrace = await publicationRow(context, context.fixtures.fallback.trace.eventId);
  const fallbackLog = await publicationRow(context, context.fixtures.fallback.log.eventId);
  const deadTrace = await publicationRow(context, context.fixtures.dead.trace.eventId);
  invariant(fallbackTrace, 'fallback trace did not enter the durable outbox');
  invariant(fallbackLog, 'fallback log did not enter the durable outbox');
  invariant(deadTrace, 'dead-letter recovery trace did not enter the durable outbox');
  for (const row of [fallbackTrace, fallbackLog, deadTrace]) {
    invariant(row.status === 'pending', `fallback row ${row.id} was not quiescent/pending`);
  }
  assertExactPublicationRow(
    fallbackTrace,
    context.config.eventTopic,
    context.fixtures.fallback.runId,
  );
  assertExactPublicationRow(fallbackLog, context.config.logTopic, null);
  assertExactPublicationRow(deadTrace, context.config.eventTopic, context.fixtures.dead.runId);

  const updated = await context.pool.query(
    `UPDATE outbox_events
        SET max_attempts = 1, updated_at = NOW()
      WHERE id = $1 AND status = 'pending' AND attempts = 0
      RETURNING id`,
    [deadTrace.id],
  );
  invariant(
    updated.rowCount === 1,
    'failed to bound the exact dead-letter recovery fixture to one attempt',
  );
}

async function runAwaitDeadPhase(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  context.log(
    '[telemetry-durability] await-dead: reconstructed backend dispatcher fails one exact row while Kafka remains down',
  );
  await requireBackendRunningButNotReady(context, signal);
  await waitForInvariant('Kafka-down fallback dead letter', signal, async () => {
    const row = await publicationRow(context, context.fixtures.dead.trace.eventId);
    return (
      row?.status === 'dead' &&
      row.max_attempts === 1 &&
      row.attempts === 1 &&
      Boolean(row.last_error)
    );
  });
  for (const eventId of [
    context.fixtures.fallback.trace.eventId,
    context.fixtures.fallback.log.eventId,
  ]) {
    const row = await publicationRow(context, eventId);
    invariant(row, `replay fixture ${eventId} disappeared`);
    invariant(
      row.status === 'pending' || row.status === 'processing',
      `replay fixture ${eventId} became ${row.status} before Kafka recovery`,
    );
    invariant(
      (await receiptCount(context, eventId)) === 0,
      `${eventId} was ingested while Kafka down`,
    );
  }
}

async function requeueDeadPublication(
  context: TelemetryRuntimeContext,
  row: OutboxRow,
  signal: AbortSignal,
): Promise<void> {
  const response = await apiJson<{ eventId: string; status: string }>(
    context,
    `/admin/outbox/dead-letters/${encodeURIComponent(row.id)}/requeue`,
    signal,
    'POST',
  );
  invariant(
    response.eventId === row.id && response.status === 'pending',
    'dead-letter requeue API returned an unexpected contract',
  );
}

async function runRecoverPhase(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  context.log(
    '[telemetry-durability] recover: changed backend generation, readiness, outbox replay, receipts, APIs, Loki, exact duplicate',
  );
  assertBackendGenerationChanged(
    context.config.backendGenerationBefore,
    context.config.backendGenerationAfter,
  );
  await waitForBackendReady(context, signal);
  await verifyScenarioVisibleExactlyOnce(context, context.fixtures.fallback, signal);
  for (const eventId of [
    context.fixtures.fallback.trace.eventId,
    context.fixtures.fallback.log.eventId,
  ]) {
    await waitForInvariant(`completed fallback publication ${eventId}`, signal, async () => {
      return (await publicationRow(context, eventId))?.status === 'completed';
    });
  }

  const deadRow = await publicationRow(context, context.fixtures.dead.trace.eventId);
  invariant(deadRow?.status === 'dead', 'operator-recoverable fallback row was not dead');
  await requeueDeadPublication(context, deadRow, signal);
  await waitForInvariant('requeued dead publication completion', signal, async () => {
    return (
      (await publicationRow(context, context.fixtures.dead.trace.eventId))?.status === 'completed'
    );
  });
  await verifyTraceVisibleExactlyOnce(context, context.fixtures.dead.trace, signal);

  await withPublishers(context, async (publishers) => {
    await publishScenario(publishers, context.fixtures.fallback);
  });
  await Promise.all([
    waitForConsumerGroupCaughtUp(
      context,
      context.config.eventTopic,
      context.config.eventGroupId,
      signal,
    ),
    waitForConsumerGroupCaughtUp(
      context,
      context.config.logTopic,
      context.config.logGroupId,
      signal,
    ),
  ]);
  await verifyScenarioVisibleExactlyOnce(context, context.fixtures.fallback, signal);
}

async function poisonRows(context: TelemetryRuntimeContext): Promise<OutboxRow[]> {
  return (await outboxRowsForFixture(context)).filter(
    (row) => row.event_type === POISON_EVENT_TYPE,
  );
}

async function runPoisonPhase(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  context.log(
    '[telemetry-durability] poison: malformed trace/log become exact dead evidence without projection',
  );
  await waitForBackendReady(context, signal);
  invariant((await poisonRows(context)).length === 0, 'poison fixture rows already exist');

  const producer = await createRawProducer(context);
  const close = () => producer.disconnect();
  context.activeClosers.add(close);
  try {
    await producer.send({
      topic: context.config.eventTopic,
      messages: [{ key: context.fixtures.direct.runId, value: context.fixtures.poison.traceValue }],
    });
    await producer.send({
      topic: context.config.logTopic,
      messages: [{ value: context.fixtures.poison.logValue }],
    });
  } finally {
    context.activeClosers.delete(close);
    await producer.disconnect();
  }

  await Promise.all([
    waitForConsumerGroupCaughtUp(
      context,
      context.config.eventTopic,
      context.config.eventGroupId,
      signal,
    ),
    waitForConsumerGroupCaughtUp(
      context,
      context.config.logTopic,
      context.config.logGroupId,
      signal,
    ),
  ]);
  await waitForInvariant('trace/log poison evidence', signal, async () => {
    const hashes = new Set(
      (await poisonRows(context)).map((row) => String(row.payload.sha256 ?? '')),
    );
    return (
      hashes.has(context.fixtures.poison.traceSha256) &&
      hashes.has(context.fixtures.poison.logSha256)
    );
  });
  const rows = await poisonRows(context);
  for (const [hash, byteLength] of [
    [context.fixtures.poison.traceSha256, Buffer.byteLength(context.fixtures.poison.traceValue)],
    [context.fixtures.poison.logSha256, Buffer.byteLength(context.fixtures.poison.logValue)],
  ] as const) {
    const row = rows.find((candidate) => candidate.payload.sha256 === hash);
    invariant(row?.status === 'dead', `poison ${hash} was not dead`);
    invariant(
      row.max_attempts === 1 && row.attempts === 0,
      `poison ${hash} retry contract drifted`,
    );
    invariant(row.payload.byteLength === byteLength, `poison ${hash} byte length drifted`);
    invariant(Boolean(row.last_error), `poison ${hash} omitted validation evidence`);
  }

  const deadLetters = await apiJson<{
    items?: { id: string; eventType: string; payload: Record<string, unknown> }[];
  }>(context, '/admin/outbox/dead-letters?limit=100', signal);
  const apiHashes = new Set(
    (deadLetters.items ?? [])
      .filter((entry) => entry.eventType === POISON_EVENT_TYPE)
      .map((entry) => String(entry.payload.sha256 ?? '')),
  );
  invariant(
    apiHashes.has(context.fixtures.poison.traceSha256) &&
      apiHashes.has(context.fixtures.poison.logSha256),
    'organization-scoped dead-letter API omitted poison evidence',
  );
}

async function executeExactDatabaseCleanup(context: TelemetryRuntimeContext): Promise<void> {
  const client = await context.pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    for (const statement of buildTelemetryCleanupStatements(context.fixtures)) {
      await client.query(statement.sql, statement.params);
    }
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the primary cleanup failure.
      }
    }
    throw error;
  } finally {
    client.release();
  }

  for (let zeroPass = 1; zeroPass <= 2; zeroPass += 1) {
    const residuals: string[] = [];
    for (const statement of buildTelemetryResidualCountStatements(context.fixtures)) {
      const rows = await queryRows<{ count: number }>(
        context.pool,
        statement.sql,
        statement.params,
      );
      const count = Number(rows[0]?.count ?? -1);
      if (count !== 0) residuals.push(`${statement.name}=${count}`);
    }
    invariant(
      residuals.length === 0,
      `exact PostgreSQL cleanup pass ${zeroPass} left ${residuals.join(', ')}`,
    );
    if (zeroPass === 1) await delay(POLL_INTERVAL_MS);
  }
}

async function runCleanupPhase(
  context: TelemetryRuntimeContext,
  signal: AbortSignal,
): Promise<void> {
  context.log(
    '[telemetry-durability] cleanup: backend quiescent, exact PostgreSQL fixture deletion and two zero passes',
  );
  await requireBackendUnavailable(context, signal);
  await executeExactDatabaseCleanup(context);
  context.log(
    '[telemetry-durability] PostgreSQL exact cleanup passed; parent must now run Compose down with volumes for exact Kafka/Loki cleanup',
  );
}

async function closeRuntime(context: TelemetryRuntimeContext): Promise<void> {
  const errors: unknown[] = [];
  const closers = [...context.activeClosers];
  context.activeClosers.clear();
  for (const close of closers) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await context.pool.end();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Telemetry durability runtime failed to close');
  }
}

export async function runTelemetryDurabilitySmoke(
  env: ScriptEnvironment = process.env,
  log: (message: string) => void = console.log,
): Promise<void> {
  const config = resolveTelemetryDurabilityConfig(env);
  for (const line of formatTelemetryDurabilityTargets(config)) log(line);
  const context: TelemetryRuntimeContext = {
    config,
    fixtures: buildTelemetryDurabilityFixtures(config),
    pool: new Pool(buildTelemetryPoolConfig(config)),
    log,
    activeClosers: new Set(),
  };
  const phaseOperations: Record<
    TelemetryDurabilityPhase,
    (context: TelemetryRuntimeContext, signal: AbortSignal) => Promise<void>
  > = {
    direct: runDirectPhase,
    fallback: runFallbackPhase,
    'await-dead': runAwaitDeadPhase,
    recover: runRecoverPhase,
    poison: runPoisonPhase,
    cleanup: runCleanupPhase,
  };

  await executeCooperativeDeadline(
    `telemetry durability ${config.phase} phase`,
    TELEMETRY_DURABILITY_PHASE_TIMEOUT_MS,
    TELEMETRY_DURABILITY_CLOSE_TIMEOUT_MS,
    (signal) => phaseOperations[config.phase](context, signal),
    () => closeRuntime(context),
  );
  log(`[telemetry-durability] ${config.phase} phase passed`);
}

if (import.meta.main) {
  const standaloneTimer = setTimeout(() => {
    console.error(
      `Telemetry durability smoke exceeded its ${TELEMETRY_DURABILITY_STANDALONE_TIMEOUT_MS}ms standalone bound`,
    );
    process.exit(1);
  }, TELEMETRY_DURABILITY_STANDALONE_TIMEOUT_MS);
  runTelemetryDurabilitySmoke()
    .catch((error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(standaloneTimer));
}
