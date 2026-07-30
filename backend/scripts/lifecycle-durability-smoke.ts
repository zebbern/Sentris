/* eslint-disable no-console -- This file is an explicit, operator-invoked release smoke. */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
  type ScriptDatabaseTarget,
} from '@sentris/local-runtime';
import type { FindingTriageChangedEvent, RunLifecycleEvent } from '@sentris/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import type { Response } from 'express';

import { AuditLogRepository } from '../src/audit/audit-log.repository';
import { AuditLogService } from '../src/audit/audit-log.service';
import { AuditLogsController } from '../src/audit/audit-logs.controller';
import type { AuthContext } from '../src/auth/types';
import {
  auditLogsTable,
  findingTriageTable,
  notificationDeliveriesTable,
  outboxEventsTable,
  ticketLinksTable,
  type AuditLogInsert,
  type NotificationChannelRecord,
  type NotificationDeliveryInsert,
  type TicketingConnectionConfig,
} from '../src/database/schema';
import * as databaseSchema from '../src/database/schema';
import { assertDatabaseMigrationsCurrent } from '../src/database/migration.guard';
import { loadMigrationPlan } from '../src/database/migrations/checked-migrations';
import { PostgresMigrationDatabase } from '../src/database/migrations/postgres-migration-database';
import { TokenEncryptionService } from '../src/integrations/token.encryption';
import type { NotificationAdapterResult } from '../src/notifications/adapters/notification.adapter';
import { DiscordNotificationAdapter } from '../src/notifications/adapters/discord.adapter';
import { SlackNotificationAdapter } from '../src/notifications/adapters/slack.adapter';
import { NotificationDispatcherService } from '../src/notifications/notification-dispatcher.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationChannelRepository } from '../src/notifications/repository/notification-channel.repository';
import { NotificationDeliveryRepository } from '../src/notifications/repository/notification-delivery.repository';
import {
  OutboxDispatcherService,
  type OutboxRepositoryPort,
} from '../src/outbox/outbox-dispatcher.service';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { JiraAdapter, type CreateIssueInput } from '../src/ticketing/jira/jira.adapter';
import { TicketingListenerService } from '../src/ticketing/ticketing-listener.service';
import { TicketingRepository } from '../src/ticketing/ticketing.repository';
import { TicketingService } from '../src/ticketing/ticketing.service';

export const LIFECYCLE_DURABILITY_DATABASE_URL_ENV = 'LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL';
const DESTRUCTIVE_OPT_IN_ENV = 'SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE';
const BULK_AUDIT_ROW_COUNT = 10_001;
const AUDIT_PAGE_SIZE = 1_000;
const LIFECYCLE_STATEMENT_TIMEOUT_MS = 120_000;
const LIFECYCLE_QUERY_TIMEOUT_MS = 130_000;
const LIFECYCLE_LOCK_TIMEOUT_MS = 10_000;
const LIFECYCLE_IDLE_TRANSACTION_TIMEOUT_MS = 30_000;

type SmokeDatabase = NodePgDatabase<typeof databaseSchema>;
type ScriptEnvironment = Record<string, string | undefined>;

export interface LifecycleSmokeConfig {
  instance: string;
  databaseTarget: ScriptDatabaseTarget;
}

export interface LifecycleCleanupManifest {
  organizationIds: string[];
  notificationChannelIds: string[];
  findingTriageIds: string[];
  ticketingConnectionIds: string[];
}

export interface LifecycleCleanupStatement {
  name: string;
  sql: string;
  params: [string[]];
}

export function lifecycleSmokeDatabaseName(instance: string): string {
  if (!/^\d$/.test(instance)) {
    throw new Error('Lifecycle smoke database name requires an instance from 0 to 9');
  }
  return `sentris_lifecycle_smoke_i${instance}`;
}

export interface LifecycleSmokePlan {
  verifyCheckedSchema(): Promise<void>;
  runAuditScenario(): Promise<void>;
  runNotificationScenario(): Promise<void>;
  runTicketingScenario(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface LifecycleOutboxHandlers {
  handleAuditPersist?(payload: unknown): Promise<void>;
  handleRunTerminal?(payload: unknown): Promise<void>;
}

export function createLifecycleOutboxDispatcher(
  repository: OutboxRepositoryPort,
  handlers: LifecycleOutboxHandlers,
): OutboxDispatcherService {
  const eventEmitter = new EventEmitter2();
  if (handlers.handleAuditPersist) {
    eventEmitter.on('audit.log.persist.v1', handlers.handleAuditPersist);
  }
  if (handlers.handleRunTerminal) {
    eventEmitter.on('run.status.terminal', handlers.handleRunTerminal);
  }
  return new OutboxDispatcherService(repository, eventEmitter);
}

export class LifecycleSmokeResourceLedger {
  private readonly organizationIds: string[];
  private readonly notificationChannelIds = new Set<string>();
  private readonly findingTriageIds = new Set<string>();
  private readonly ticketingConnectionIds = new Set<string>();

  constructor(organizationIds: string[]) {
    if (organizationIds.length === 0 || organizationIds.some((id) => id.trim().length === 0)) {
      throw new Error('Lifecycle smoke cleanup requires exact organization IDs');
    }
    this.organizationIds = [...new Set(organizationIds)];
  }

  trackNotificationChannel(id: string): void {
    this.notificationChannelIds.add(id);
  }

  trackFindingTriage(id: string): void {
    this.findingTriageIds.add(id);
  }

  trackTicketingConnection(id: string): void {
    this.ticketingConnectionIds.add(id);
  }

  snapshot(): LifecycleCleanupManifest {
    return {
      organizationIds: [...this.organizationIds],
      notificationChannelIds: [...this.notificationChannelIds],
      findingTriageIds: [...this.findingTriageIds],
      ticketingConnectionIds: [...this.ticketingConnectionIds],
    };
  }
}

export function resolveLifecycleSmokeConfig(
  env: ScriptEnvironment = process.env,
): LifecycleSmokeConfig {
  const instance = env.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error('SENTRIS_INSTANCE must be set explicitly for the lifecycle durability smoke');
  }
  if (!/^\d$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }
  if (env.CI !== 'true' && env[DESTRUCTIVE_OPT_IN_ENV] !== 'true') {
    throw new Error(
      `Lifecycle durability smoke is destructive; run in CI or set ${DESTRUCTIVE_OPT_IN_ENV}=true`,
    );
  }

  const databaseTarget = getScriptDatabaseTarget({
    env,
    overrideEnvVar: LIFECYCLE_DURABILITY_DATABASE_URL_ENV,
  });
  if (databaseTarget.source !== `env:${LIFECYCLE_DURABILITY_DATABASE_URL_ENV}`) {
    throw new Error(
      `Lifecycle durability smoke requires ${LIFECYCLE_DURABILITY_DATABASE_URL_ENV} to be set explicitly`,
    );
  }
  const expectedDatabaseName = lifecycleSmokeDatabaseName(instance);
  if (databaseTarget.databaseName !== expectedDatabaseName) {
    throw new Error(
      `Lifecycle durability smoke must target dedicated database ${expectedDatabaseName}; received ${databaseTarget.databaseName}`,
    );
  }

  return {
    instance,
    databaseTarget,
  };
}

export function buildLifecyclePoolConfig(config: LifecycleSmokeConfig): PoolConfig {
  return {
    connectionString: config.databaseTarget.connectionString,
    application_name: `sentris-lifecycle-smoke-i${config.instance}`,
    max: 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: LIFECYCLE_STATEMENT_TIMEOUT_MS,
    query_timeout: LIFECYCLE_QUERY_TIMEOUT_MS,
    lock_timeout: LIFECYCLE_LOCK_TIMEOUT_MS,
    idle_in_transaction_session_timeout: LIFECYCLE_IDLE_TRANSACTION_TIMEOUT_MS,
  };
}

function exactIdStatement(
  name: string,
  table: string,
  column: string,
  cast: 'uuid' | 'varchar',
  values: string[],
): LifecycleCleanupStatement | null {
  if (values.length === 0) return null;
  return {
    name,
    sql: `DELETE FROM ${table} WHERE ${column} = ANY($1::${cast}[])`,
    params: [[...values]],
  };
}

export function buildLifecycleCleanupStatements(
  manifest: LifecycleCleanupManifest,
): LifecycleCleanupStatement[] {
  return [
    exactIdStatement(
      'notification deliveries',
      'notification_deliveries',
      'channel_id',
      'uuid',
      manifest.notificationChannelIds,
    ),
    exactIdStatement(
      'notification channels',
      'notification_channels',
      'id',
      'uuid',
      manifest.notificationChannelIds,
    ),
    exactIdStatement(
      'ticket links',
      'ticket_links',
      'finding_triage_id',
      'uuid',
      manifest.findingTriageIds,
    ),
    exactIdStatement('finding triage', 'finding_triage', 'id', 'uuid', manifest.findingTriageIds),
    exactIdStatement(
      'ticketing connections',
      'ticketing_connections',
      'id',
      'uuid',
      manifest.ticketingConnectionIds,
    ),
    exactIdStatement(
      'audit logs',
      'audit_logs',
      'organization_id',
      'varchar',
      manifest.organizationIds,
    ),
    exactIdStatement(
      'outbox events',
      'outbox_events',
      'organization_id',
      'varchar',
      manifest.organizationIds,
    ),
  ].filter((statement): statement is LifecycleCleanupStatement => statement !== null);
}

function exactIdResidualCountStatement(
  name: string,
  table: string,
  column: string,
  cast: 'uuid' | 'varchar',
  values: string[],
): LifecycleCleanupStatement | null {
  if (values.length === 0) return null;
  return {
    name,
    sql: `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = ANY($1::${cast}[])`,
    params: [[...values]],
  };
}

export function buildLifecycleResidualCountStatements(
  manifest: LifecycleCleanupManifest,
): LifecycleCleanupStatement[] {
  return [
    exactIdResidualCountStatement(
      'notification deliveries',
      'notification_deliveries',
      'channel_id',
      'uuid',
      manifest.notificationChannelIds,
    ),
    exactIdResidualCountStatement(
      'notification channels',
      'notification_channels',
      'id',
      'uuid',
      manifest.notificationChannelIds,
    ),
    exactIdResidualCountStatement(
      'ticket links',
      'ticket_links',
      'finding_triage_id',
      'uuid',
      manifest.findingTriageIds,
    ),
    exactIdResidualCountStatement(
      'finding triage',
      'finding_triage',
      'id',
      'uuid',
      manifest.findingTriageIds,
    ),
    exactIdResidualCountStatement(
      'ticketing connections',
      'ticketing_connections',
      'id',
      'uuid',
      manifest.ticketingConnectionIds,
    ),
    exactIdResidualCountStatement(
      'audit logs',
      'audit_logs',
      'organization_id',
      'varchar',
      manifest.organizationIds,
    ),
    exactIdResidualCountStatement(
      'outbox events',
      'outbox_events',
      'organization_id',
      'varchar',
      manifest.organizationIds,
    ),
  ].filter((statement): statement is LifecycleCleanupStatement => statement !== null);
}

export async function executeLifecycleSmokePlan(plan: LifecycleSmokePlan): Promise<void> {
  let primaryError: unknown;
  try {
    await plan.verifyCheckedSchema();
    await plan.runAuditScenario();
    await plan.runNotificationScenario();
    await plan.runTicketingScenario();
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  try {
    await plan.cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Lifecycle durability smoke and exact cleanup both failed',
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
}

interface SmokeIdentifiers {
  suiteId: string;
  primaryOrganizationId: string;
  foreignOrganizationId: string;
  actorId: string;
  successRunId: string;
  ambiguousRunId: string;
  staleRunId: string;
}

interface SmokeContext {
  pool: Pool;
  db: SmokeDatabase;
  repositoryDb: NodePgDatabase;
  ids: SmokeIdentifiers;
  ledger: LifecycleSmokeResourceLedger;
  auth: AuthContext;
  auditRepository: AuditLogRepository;
  auditService: AuditLogService;
  channelRepository: NotificationChannelRepository;
  deliveryRepository: NotificationDeliveryRepository;
  outboxRepository: OutboxRepository;
  notificationChannel?: NotificationChannelRecord;
  log(message: string): void;
}

function buildIdentifiers(): SmokeIdentifiers {
  const suiteId = randomUUID();
  return {
    suiteId,
    primaryOrganizationId: `lifecycle-smoke-${suiteId}`,
    foreignOrganizationId: `lifecycle-smoke-foreign-${suiteId}`,
    actorId: `lifecycle-smoke-actor-${suiteId}`,
    successRunId: `lifecycle-smoke-success-${suiteId}`,
    ambiguousRunId: `lifecycle-smoke-ambiguous-${suiteId}`,
    staleRunId: `lifecycle-smoke-stale-${suiteId}`,
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Lifecycle durability assertion failed: ${message}`);
  }
}

async function expectFailure(
  operation: () => Promise<unknown>,
  expectedMessage: string,
): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    invariant(
      message.includes(expectedMessage),
      `expected failure containing "${expectedMessage}", received "${message}"`,
    );
    return error;
  }
  throw new Error(`Lifecycle durability assertion failed: expected "${expectedMessage}" failure`);
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

async function cleanupLifecycleFixtures(
  pool: Pool,
  manifest: LifecycleCleanupManifest,
): Promise<void> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    for (const statement of buildLifecycleCleanupStatements(manifest)) {
      await client.query(statement.sql, statement.params);
    }
    await client.query('COMMIT');
    transactionOpen = false;

    const residuals: string[] = [];
    for (const statement of buildLifecycleResidualCountStatements(manifest)) {
      const result = await client.query<{ count: number }>(statement.sql, statement.params);
      const count = result.rows[0]?.count ?? -1;
      if (count !== 0) {
        residuals.push(`${statement.name}=${count}`);
      }
    }
    invariant(
      residuals.length === 0,
      `exact cleanup left lifecycle fixture rows: ${residuals.join(', ')}`,
    );
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the cleanup failure if rollback also fails.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

class AuditCsvProbe extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  dataRows = 0;
  maxRowsPerDataWrite = 0;
  formulaNeutralized = false;
  backpressureObserved = false;
  private writes = 0;

  setHeader(): this {
    return this;
  }

  write(chunk: string): boolean {
    this.writes += 1;
    const rowCount = chunk.split('\n').length - 1;
    if (this.writes > 1) {
      this.dataRows += rowCount;
      this.maxRowsPerDataWrite = Math.max(this.maxRowsPerDataWrite, rowCount);
      this.formulaNeutralized ||= chunk.includes("'=HYPERLINK");
    }

    if (!this.backpressureObserved && this.writes === 2) {
      this.backpressureObserved = true;
      queueMicrotask(() => this.emit('drain'));
      return false;
    }
    return true;
  }

  end(): this {
    this.writableEnded = true;
    return this;
  }
}

async function runAuditScenario(context: SmokeContext): Promise<void> {
  context.log('[lifecycle-durability] audit: atomic mutation/outbox and projection replay');
  const committedChannel = await context.channelRepository.create(
    {
      organizationId: context.ids.primaryOrganizationId,
      name: `lifecycle-commit-${context.ids.suiteId}`,
      type: 'slack',
      config: { webhookUrl: 'https://hooks.slack.com/services/lifecycle/fake/transport' },
      status: 'active',
      events: ['run.completed', 'run.failed'],
      createdBy: context.ids.actorId,
    },
    (executor, record) =>
      context.auditService.recordDurableWithExecutor(executor, context.auth, {
        action: 'notification_channel.create',
        resourceType: 'notification_channel',
        resourceId: record.id,
        resourceName: record.name,
        metadata: { lifecycleSmoke: true },
      }),
  );
  context.ledger.trackNotificationChannel(committedChannel.id);
  context.notificationChannel = committedChannel;

  const committedOutboxRows = await context.db
    .select()
    .from(outboxEventsTable)
    .where(
      and(
        eq(outboxEventsTable.organizationId, context.ids.primaryOrganizationId),
        eq(outboxEventsTable.eventType, 'audit.log.persist.v1'),
      ),
    );
  const committedAuditOutbox = committedOutboxRows.find(
    (row) =>
      row.payload.action === 'notification_channel.create' &&
      row.payload.resourceId === committedChannel.id,
  );
  invariant(committedAuditOutbox, 'committed mutation must co-commit its audit outbox event');

  const rollbackName = `lifecycle-rollback-${context.ids.suiteId}`;
  await expectFailure(
    () =>
      context.channelRepository.create(
        {
          organizationId: context.ids.primaryOrganizationId,
          name: rollbackName,
          type: 'slack',
          config: { webhookUrl: 'https://hooks.slack.com/services/lifecycle/fake/rollback' },
          status: 'active',
          events: ['run.failed'],
          createdBy: context.ids.actorId,
        },
        async (executor, record) => {
          await context.auditService.recordDurableWithExecutor(executor, context.auth, {
            action: 'notification_channel.create',
            resourceType: 'notification_channel',
            resourceId: record.id,
            resourceName: rollbackName,
          });
          throw new Error('injected atomic rollback');
        },
      ),
    'injected atomic rollback',
  );

  const rolledBackChannels = await context.channelRepository.list({
    organizationId: context.ids.primaryOrganizationId,
  });
  invariant(
    !rolledBackChannels.some((channel) => channel.name === rollbackName),
    'failed audit transaction must roll back the mutation',
  );
  const postRollbackOutbox = await context.db
    .select()
    .from(outboxEventsTable)
    .where(
      and(
        eq(outboxEventsTable.organizationId, context.ids.primaryOrganizationId),
        eq(outboxEventsTable.eventType, 'audit.log.persist.v1'),
      ),
    );
  invariant(
    !postRollbackOutbox.some((row) => row.payload.resourceName === rollbackName),
    'failed mutation must roll back its audit outbox event',
  );

  const firstAuditRuntime = createLifecycleOutboxDispatcher(
    new OutboxRepository(context.repositoryDb),
    {
      handleAuditPersist: (payload) => context.auditService.handlePersistEvent(payload),
    },
  );
  await firstAuditRuntime.drainOnce();
  const completedAuditOutbox = await readLifecycleOutboxEvent(context, committedAuditOutbox.id);
  invariant(
    completedAuditOutbox.status === 'completed' && completedAuditOutbox.attempts === 1,
    `audit outbox did not complete through claim/emit/complete: ${completedAuditOutbox.status}/${completedAuditOutbox.attempts}`,
  );

  const restartedAuditRuntime = createLifecycleOutboxDispatcher(
    new OutboxRepository(context.repositoryDb),
    {
      handleAuditPersist: (payload) => context.auditService.handlePersistEvent(payload),
    },
  );
  await restartedAuditRuntime.drainOnce();
  const projectedAuditRows = await context.db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.id, String(committedAuditOutbox.payload.auditId)));
  invariant(projectedAuditRows.length === 1, 'stable audit replay must be idempotent');

  context.log('[lifecycle-durability] audit: >10,000 tenant-scoped keyset/export rows');
  const baseTime = Date.now() - 60_000;
  const bulkRows: AuditLogInsert[] = Array.from({ length: BULK_AUDIT_ROW_COUNT }, (_, index) => ({
    id: randomUUID(),
    organizationId: context.ids.primaryOrganizationId,
    actorId: context.ids.actorId,
    actorType: 'user',
    actorDisplay:
      index === 0 ? '=HYPERLINK("https://example.invalid","lifecycle")' : 'Lifecycle Smoke',
    action: 'lifecycle.bulk',
    resourceType: 'analytics',
    resourceId: `lifecycle-resource-${index.toString().padStart(5, '0')}`,
    resourceName: `Lifecycle resource ${index}`,
    metadata: { index },
    correlationId: `lifecycle-correlation-${index}`,
    createdAt: new Date(baseTime - index),
  }));
  for (let offset = 0; offset < bulkRows.length; offset += 500) {
    await context.db.insert(auditLogsTable).values(bulkRows.slice(offset, offset + 500));
  }
  const foreignSentinelId = randomUUID();
  await context.auditRepository.insert({
    id: foreignSentinelId,
    organizationId: context.ids.foreignOrganizationId,
    actorId: 'foreign-actor',
    actorType: 'user',
    action: 'lifecycle.bulk',
    resourceType: 'analytics',
    resourceId: 'foreign-sentinel',
    createdAt: new Date(baseTime + 1_000),
  });

  const exportedIds = new Set<string>();
  let pageCount = 0;
  for await (const page of context.auditService.exportPages(
    context.auth,
    { action: 'lifecycle.bulk' },
    AUDIT_PAGE_SIZE,
  )) {
    pageCount += 1;
    invariant(page.length <= AUDIT_PAGE_SIZE, 'audit export page exceeded the 1,000-row bound');
    for (const row of page) {
      invariant(
        row.organizationId === context.ids.primaryOrganizationId,
        'foreign tenant row leaked through audit export',
      );
      exportedIds.add(row.id);
    }
  }
  invariant(pageCount > 10, 'audit export must require more than ten keyset pages');
  invariant(
    exportedIds.size === BULK_AUDIT_ROW_COUNT,
    `audit export returned ${exportedIds.size} of ${BULK_AUDIT_ROW_COUNT} rows`,
  );
  invariant(!exportedIds.has(foreignSentinelId), 'foreign audit sentinel leaked into export');

  const firstListPage = await context.auditService.list(context.auth, {
    action: 'lifecycle.bulk',
    limit: 100,
  });
  invariant(
    firstListPage.items.every((row) => row.organizationId === context.ids.primaryOrganizationId),
    'tenant-scoped audit list returned a foreign row',
  );

  const csvProbe = new AuditCsvProbe();
  const controller = new AuditLogsController(context.auditService);
  await controller.export(
    context.auth,
    {
      action: 'lifecycle.bulk',
      format: 'csv',
    } as Parameters<AuditLogsController['export']>[1],
    csvProbe as unknown as Response,
  );
  invariant(csvProbe.writableEnded, 'audit CSV response did not finish');
  invariant(csvProbe.backpressureObserved, 'audit CSV did not exercise response backpressure');
  invariant(
    csvProbe.maxRowsPerDataWrite <= AUDIT_PAGE_SIZE,
    'audit CSV emitted an unbounded response chunk',
  );
  invariant(
    csvProbe.dataRows === BULK_AUDIT_ROW_COUNT,
    `audit CSV streamed ${csvProbe.dataRows} of ${BULK_AUDIT_ROW_COUNT} rows`,
  );
  invariant(csvProbe.formulaNeutralized, 'audit CSV did not neutralize a spreadsheet formula');
}

class DeterministicSlackTransport {
  private readonly ambiguousRuns = new Set<string>();
  private readonly sendCounts = new Map<string, number>();

  makeAmbiguous(runId: string): void {
    this.ambiguousRuns.add(runId);
  }

  makeDefinitive(runId: string): void {
    this.ambiguousRuns.delete(runId);
  }

  sendCount(runId: string): number {
    return this.sendCounts.get(runId) ?? 0;
  }

  async send(
    _channel: NotificationChannelRecord,
    payload: RunLifecycleEvent,
  ): Promise<NotificationAdapterResult> {
    this.sendCounts.set(payload.runId, this.sendCount(payload.runId) + 1);
    if (this.ambiguousRuns.has(payload.runId)) {
      throw new Error('fake Slack accepted the request but its response was lost');
    }
    return {
      success: true,
      responseStatus: 200,
      responseBody: `fake-slack:${payload.runId}`,
    };
  }
}

interface LifecycleNotificationRuntime {
  outboxDispatcher: OutboxDispatcherService;
  notifications: NotificationsService;
}

function createLifecycleNotificationRuntime(
  context: SmokeContext,
  slackTransport: DeterministicSlackTransport,
): LifecycleNotificationRuntime {
  const channelRepository = new NotificationChannelRepository(context.repositoryDb);
  const deliveryRepository = new NotificationDeliveryRepository(context.repositoryDb);
  const outboxRepository = new OutboxRepository(context.repositoryDb);
  const slackAdapter = slackTransport as unknown as SlackNotificationAdapter;
  const discordAdapter = {
    send: async (): Promise<NotificationAdapterResult> => ({
      success: false,
      error: 'fake Discord is intentionally unused',
    }),
  } as unknown as DiscordNotificationAdapter;
  const notificationDispatcher = new NotificationDispatcherService(
    channelRepository,
    deliveryRepository,
    slackAdapter,
    discordAdapter,
  );
  const notifications = new NotificationsService(
    channelRepository,
    deliveryRepository,
    slackAdapter,
    discordAdapter,
    context.auditService,
    notificationDispatcher,
    outboxRepository,
  );
  const outboxDispatcher = createLifecycleOutboxDispatcher(outboxRepository, {
    handleAuditPersist: (payload) => context.auditService.handlePersistEvent(payload),
    handleRunTerminal: (payload) =>
      notificationDispatcher.handleRunTerminal(
        payload as Parameters<NotificationDispatcherService['handleRunTerminal']>[0],
      ),
  });
  return {
    outboxDispatcher,
    notifications,
  };
}

function lifecycleRunPayload(
  context: SmokeContext,
  runId: string,
  status: RunLifecycleEvent['status'] = 'COMPLETED',
): RunLifecycleEvent {
  return {
    runId,
    workflowId: `lifecycle-workflow-${context.ids.suiteId}`,
    organizationId: context.ids.primaryOrganizationId,
    status,
    completedAt: new Date().toISOString(),
  };
}

async function createLifecycleOutboxAnchor(
  context: SmokeContext,
  input: {
    id?: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    status?: 'pending' | 'processing' | 'completed' | 'dead';
    maxAttempts?: number;
    organizationId?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const id = input.id ?? randomUUID();
  const status = input.status ?? 'pending';
  const maxAttempts = input.maxAttempts ?? 8;
  const now = input.createdAt ?? new Date();
  await context.db.insert(outboxEventsTable).values({
    id,
    eventType: input.eventType,
    organizationId: input.organizationId ?? context.ids.primaryOrganizationId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    status,
    attempts: status === 'dead' ? maxAttempts : status === 'completed' ? 1 : 0,
    maxAttempts,
    availableAt: now,
    lockedAt: status === 'processing' ? now : null,
    lockedBy: status === 'processing' ? `lifecycle-worker-${context.ids.suiteId}` : null,
    lastError: status === 'dead' ? 'injected lifecycle dead letter' : null,
    processedAt: status === 'completed' ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function readLifecycleOutboxEvent(context: SmokeContext, eventId: string) {
  const [event] = await context.db
    .select()
    .from(outboxEventsTable)
    .where(eq(outboxEventsTable.id, eventId));
  invariant(event, `outbox event ${eventId} is missing`);
  return event;
}

async function runNotificationScenario(context: SmokeContext): Promise<void> {
  context.log('[lifecycle-durability] notifications: replay, ambiguity, manual resend, retention');
  const channel = context.notificationChannel;
  invariant(channel, 'audit scenario did not create the notification channel');

  const slackTransport = new DeterministicSlackTransport();
  let runtime = createLifecycleNotificationRuntime(context, slackTransport);

  const successPayload = lifecycleRunPayload(context, context.ids.successRunId);
  const successOutboxId = await createLifecycleOutboxAnchor(context, {
    eventType: 'run.status.terminal',
    aggregateType: 'workflow_run',
    aggregateId: context.ids.successRunId,
    dedupeKey: `lifecycle-notification-success:${context.ids.suiteId}`,
    payload: successPayload as unknown as Record<string, unknown>,
  });
  await runtime.outboxDispatcher.drainOnce();
  const completedSuccessOutbox = await readLifecycleOutboxEvent(context, successOutboxId);
  invariant(
    completedSuccessOutbox.status === 'completed' && completedSuccessOutbox.attempts === 1,
    `successful notification outbox did not complete exactly once: ${completedSuccessOutbox.status}/${completedSuccessOutbox.attempts}`,
  );

  runtime = createLifecycleNotificationRuntime(context, slackTransport);
  await runtime.outboxDispatcher.drainOnce();
  invariant(
    slackTransport.sendCount(context.ids.successRunId) === 1,
    'restarting after a completed notification outbox event sent Slack more than once',
  );
  const successDeliveries = await context.deliveryRepository.listByRunId(context.ids.successRunId);
  invariant(
    successDeliveries.length === 1 && successDeliveries[0]?.status === 'sent',
    'notification replay did not resolve to one sent delivery receipt',
  );

  slackTransport.makeAmbiguous(context.ids.ambiguousRunId);
  const ambiguousPayload = lifecycleRunPayload(context, context.ids.ambiguousRunId, 'FAILED');
  const ambiguousOutboxId = await createLifecycleOutboxAnchor(context, {
    eventType: 'run.status.terminal',
    aggregateType: 'workflow_run',
    aggregateId: context.ids.ambiguousRunId,
    dedupeKey: `lifecycle-notification-ambiguous:${context.ids.suiteId}`,
    payload: ambiguousPayload as unknown as Record<string, unknown>,
    maxAttempts: 2,
  });
  await runtime.outboxDispatcher.drainOnce();
  const rescheduledAmbiguousOutbox = await readLifecycleOutboxEvent(context, ambiguousOutboxId);
  invariant(
    rescheduledAmbiguousOutbox.status === 'pending' &&
      rescheduledAmbiguousOutbox.attempts === 1 &&
      rescheduledAmbiguousOutbox.lastError?.includes('manual resend is required'),
    `ambiguous outbox did not reschedule after its first attempt: ${rescheduledAmbiguousOutbox.status}/${rescheduledAmbiguousOutbox.attempts}/${rescheduledAmbiguousOutbox.lastError}`,
  );
  await context.db
    .update(outboxEventsTable)
    .set({ availableAt: new Date(0), updatedAt: new Date() })
    .where(eq(outboxEventsTable.id, ambiguousOutboxId));

  runtime = createLifecycleNotificationRuntime(context, slackTransport);
  await runtime.outboxDispatcher.drainOnce();
  const deadAmbiguousOutbox = await readLifecycleOutboxEvent(context, ambiguousOutboxId);
  invariant(
    deadAmbiguousOutbox.status === 'dead' &&
      deadAmbiguousOutbox.attempts === 2 &&
      deadAmbiguousOutbox.lastError?.includes('manual resend is required'),
    `ambiguous outbox did not dead-letter after its bounded retry: ${deadAmbiguousOutbox.status}/${deadAmbiguousOutbox.attempts}/${deadAmbiguousOutbox.lastError}`,
  );
  invariant(
    slackTransport.sendCount(context.ids.ambiguousRunId) === 1,
    'ambiguous notification replay automatically duplicated the external send',
  );
  const ambiguousDeliveries = await context.deliveryRepository.listByRunId(
    context.ids.ambiguousRunId,
  );
  invariant(
    ambiguousDeliveries.length === 1 && ambiguousDeliveries[0]?.status === 'unknown',
    'ambiguous notification was not retained as unknown',
  );
  const ambiguousDelivery = ambiguousDeliveries[0]!;

  const staleDeliveryId = randomUUID();
  const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  await context.db.insert(notificationDeliveriesTable).values({
    id: staleDeliveryId,
    channelId: channel.id,
    runId: context.ids.staleRunId,
    eventType: 'run.failed',
    status: 'sending',
    payload: lifecycleRunPayload(context, context.ids.staleRunId, 'FAILED') as unknown as Record<
      string,
      unknown
    >,
    createdAt: oldDate,
    sendingStartedAt: oldDate,
  });
  const reconciledStale = await context.deliveryRepository.markStaleSendingUnknown(
    staleDeliveryId,
    channel.id,
    new Date(Date.now() - 10 * 60 * 1_000),
    'lifecycle smoke stale sending outcome',
  );
  invariant(
    reconciledStale?.status === 'unknown',
    'stale sending notification did not reconcile to unknown',
  );

  slackTransport.makeDefinitive(context.ids.ambiguousRunId);
  const childDelivery = await runtime.notifications.resendDelivery(
    context.auth,
    channel.id,
    ambiguousDelivery.id,
  );
  invariant(childDelivery.status === 'sent', 'explicit notification resend did not succeed');
  const afterResend = await context.deliveryRepository.listByRunId(context.ids.ambiguousRunId);
  invariant(
    afterResend.length === 2,
    `explicit resend created ${afterResend.length - 1} child attempts instead of one`,
  );
  invariant(
    slackTransport.sendCount(context.ids.ambiguousRunId) === 2,
    'explicit resend did not create exactly one additional Slack send',
  );
  const requeuedAmbiguousOutbox = await readLifecycleOutboxEvent(context, ambiguousOutboxId);
  invariant(
    requeuedAmbiguousOutbox.status === 'pending' && requeuedAmbiguousOutbox.attempts === 0,
    `manual resend did not atomically requeue the dead outbox event: ${requeuedAmbiguousOutbox.status}/${requeuedAmbiguousOutbox.attempts}`,
  );

  runtime = createLifecycleNotificationRuntime(context, slackTransport);
  await runtime.outboxDispatcher.drainOnce(200);
  await runtime.outboxDispatcher.drainOnce(200);
  const recoveredAmbiguousOutbox = await readLifecycleOutboxEvent(context, ambiguousOutboxId);
  invariant(
    recoveredAmbiguousOutbox.status === 'completed' && recoveredAmbiguousOutbox.attempts === 1,
    `requeued notification outbox did not complete after restart: ${recoveredAmbiguousOutbox.status}/${recoveredAmbiguousOutbox.attempts}`,
  );
  invariant(
    slackTransport.sendCount(context.ids.ambiguousRunId) === 2,
    'recovered outbox replay duplicated the explicit Slack resend',
  );
  await expectFailure(
    () => runtime.notifications.resendDelivery(context.auth, channel.id, ambiguousDelivery.id),
    'Only failed or unknown deliveries can be re-sent',
  );
  const afterDuplicateResend = await context.deliveryRepository.listByRunId(
    context.ids.ambiguousRunId,
  );
  invariant(
    afterDuplicateResend.length === 2,
    'a repeated operator resend created another child delivery',
  );

  const resendAuditEvents = (
    await context.db
      .select()
      .from(outboxEventsTable)
      .where(
        and(
          eq(outboxEventsTable.organizationId, context.ids.primaryOrganizationId),
          eq(outboxEventsTable.eventType, 'audit.log.persist.v1'),
        ),
      )
  ).filter(
    (row) =>
      row.payload.action === 'notification_delivery.resend' &&
      row.payload.resourceId === ambiguousDelivery.id,
  );
  const requestedResendAudit = resendAuditEvents.find(
    (row) => (row.payload.metadata as Record<string, unknown> | null)?.phase === 'requested',
  );
  const reconciledResendAudit = resendAuditEvents.find(
    (row) => (row.payload.metadata as Record<string, unknown> | null)?.phase === 'reconciled',
  );
  invariant(requestedResendAudit, 'manual resend child creation was not durably audited');
  invariant(reconciledResendAudit, 'manual resend child completion was not durably audited');
  invariant(
    resendAuditEvents.every((row) => row.status === 'completed'),
    'manual resend audit outbox events did not complete through the restarted dispatcher',
  );
  invariant(
    (requestedResendAudit.payload.metadata as Record<string, unknown>).childDeliveryId ===
      childDelivery.id,
    'manual resend requested audit does not identify the exact child attempt',
  );

  const retentionAnchorCompleted = await createLifecycleOutboxAnchor(context, {
    eventType: 'lifecycle.retention',
    aggregateType: 'notification',
    aggregateId: `retention-completed-${context.ids.suiteId}`,
    dedupeKey: `lifecycle-retention-completed:${context.ids.suiteId}`,
    payload: {},
    status: 'completed',
    createdAt: oldDate,
  });
  const retentionAnchorPending = await createLifecycleOutboxAnchor(context, {
    eventType: 'lifecycle.retention',
    aggregateType: 'notification',
    aggregateId: `retention-pending-${context.ids.suiteId}`,
    dedupeKey: `lifecycle-retention-pending:${context.ids.suiteId}`,
    payload: {},
    status: 'pending',
    createdAt: oldDate,
  });
  const retentionAnchorDead = await createLifecycleOutboxAnchor(context, {
    eventType: 'lifecycle.retention',
    aggregateType: 'notification',
    aggregateId: `retention-dead-${context.ids.suiteId}`,
    dedupeKey: `lifecycle-retention-dead:${context.ids.suiteId}`,
    payload: {},
    status: 'dead',
    createdAt: oldDate,
  });

  const retentionFixtures: NotificationDeliveryInsert[] = [
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-eligible-unanchored-${context.ids.suiteId}`,
      eventType: 'run.completed',
      status: 'sent',
      payload: {},
      createdAt: oldDate,
    },
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-eligible-completed-${context.ids.suiteId}`,
      eventType: 'run.failed',
      status: 'failed',
      payload: {},
      outboxEventId: retentionAnchorCompleted,
      createdAt: oldDate,
    },
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-pending-${context.ids.suiteId}`,
      eventType: 'run.completed',
      status: 'pending',
      payload: {},
      createdAt: oldDate,
    },
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-sending-${context.ids.suiteId}`,
      eventType: 'run.completed',
      status: 'sending',
      payload: {},
      sendingStartedAt: oldDate,
      createdAt: oldDate,
    },
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-unknown-${context.ids.suiteId}`,
      eventType: 'run.completed',
      status: 'unknown',
      payload: {},
      createdAt: oldDate,
    },
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-uncompleted-outbox-${context.ids.suiteId}`,
      eventType: 'run.completed',
      status: 'sent',
      payload: {},
      outboxEventId: retentionAnchorPending,
      createdAt: oldDate,
    },
    {
      id: randomUUID(),
      channelId: channel.id,
      runId: `retention-dead-outbox-${context.ids.suiteId}`,
      eventType: 'run.failed',
      status: 'failed',
      payload: {},
      outboxEventId: retentionAnchorDead,
      createdAt: oldDate,
    },
  ];
  await context.db.insert(notificationDeliveriesTable).values(retentionFixtures);
  const purged = await context.deliveryRepository.purgeResolvedBefore(
    new Date(Date.now() - 60 * 60 * 1_000),
    10_000,
  );
  invariant(purged === 2, `notification retention deleted ${purged} rows instead of two`);
  const retainedFixtureRows = await context.db
    .select()
    .from(notificationDeliveriesTable)
    .where(
      inArray(
        notificationDeliveriesTable.id,
        retentionFixtures.map((fixture) => fixture.id!),
      ),
    );
  const retainedIds = new Set(retainedFixtureRows.map((row) => row.id));
  invariant(
    !retainedIds.has(retentionFixtures[0]!.id!) && !retainedIds.has(retentionFixtures[1]!.id!),
    'eligible completed notification rows were not deleted',
  );
  for (const fixture of retentionFixtures.slice(2)) {
    invariant(
      retainedIds.has(fixture.id!),
      `retention deleted protected delivery ${fixture.runId ?? fixture.id}`,
    );
  }
}

type JiraCreateMode = 'success' | 'accept-then-throw' | 'reject-then-throw';

interface FakeJiraIssue {
  id: string;
  key: string;
  self: string;
  findingId: string;
  status: string;
}

class DeterministicJiraTransport {
  private readonly createModes = new Map<string, JiraCreateMode>();
  private readonly createCounts = new Map<string, number>();
  private readonly transitionCounts = new Map<string, number>();
  private readonly issuesByFinding = new Map<string, FakeJiraIssue>();
  private readonly issuesByKey = new Map<string, FakeJiraIssue>();
  private nextIssueNumber = 100;

  setCreateMode(findingId: string, mode: JiraCreateMode): void {
    this.createModes.set(findingId, mode);
  }

  createCount(findingId: string): number {
    return this.createCounts.get(findingId) ?? 0;
  }

  transitionCount(issueKey: string): number {
    return this.transitionCounts.get(issueKey) ?? 0;
  }

  issueKeyForFinding(findingId: string): string | undefined {
    return this.issuesByFinding.get(findingId)?.key;
  }

  async getAccessibleResources() {
    return [
      {
        id: 'lifecycle-cloud',
        url: 'https://lifecycle-smoke.atlassian.net',
        name: 'Lifecycle Smoke',
        scopes: ['write:jira-work'],
        avatarUrl: 'https://lifecycle-smoke.atlassian.net/avatar.png',
      },
    ];
  }

  async createIssue(
    _cloudId: string,
    _accessToken: string,
    input: CreateIssueInput,
  ): Promise<{ id: string; key: string; self: string }> {
    const findingMatch = /^Finding ID: ([^\r\n]+)/m.exec(input.description);
    invariant(findingMatch?.[1], 'fake Jira could not resolve the finding ID from the request');
    const findingId = findingMatch[1];
    this.createCounts.set(findingId, this.createCount(findingId) + 1);
    const mode = this.createModes.get(findingId) ?? 'success';

    if (mode === 'reject-then-throw') {
      throw new Error('fake Jira rejected the request before creating an issue');
    }

    let issue = this.issuesByFinding.get(findingId);
    if (!issue) {
      const issueNumber = this.nextIssueNumber;
      this.nextIssueNumber += 1;
      issue = {
        id: `lifecycle-jira-${issueNumber}`,
        key: `SEC-${issueNumber}`,
        self: `https://api.atlassian.com/lifecycle/${issueNumber}`,
        findingId,
        status: 'Open',
      };
      this.issuesByFinding.set(findingId, issue);
      this.issuesByKey.set(issue.key, issue);
    }

    if (mode === 'accept-then-throw') {
      throw new Error('fake Jira accepted the issue but its response was lost');
    }
    return { id: issue.id, key: issue.key, self: issue.self };
  }

  async getIssue(
    _cloudId: string,
    _accessToken: string,
    issueKey: string,
  ): Promise<Record<string, unknown>> {
    const issue = this.issuesByKey.get(issueKey.toUpperCase());
    if (!issue) {
      throw new Error(`fake Jira issue ${issueKey} not found`);
    }
    return {
      id: issue.id,
      key: issue.key,
      fields: { status: { name: issue.status } },
    };
  }

  async transitionIssue(
    _cloudId: string,
    _accessToken: string,
    issueKey: string,
    _transitionName: string,
    resultingStatus?: string,
  ): Promise<boolean> {
    const issue = this.issuesByKey.get(issueKey.toUpperCase());
    invariant(issue, `fake Jira issue ${issueKey} not found for transition`);
    this.transitionCounts.set(issue.key, this.transitionCount(issue.key) + 1);
    issue.status = resultingStatus ?? issue.status;
    return true;
  }
}

interface TicketingRuntime {
  repository: TicketingRepository;
  service: TicketingService;
  listener: TicketingListenerService;
}

function createTicketingRuntime(
  context: SmokeContext,
  jiraTransport: DeterministicJiraTransport,
): TicketingRuntime {
  const repository = new TicketingRepository(context.db as unknown as NodePgDatabase);
  const adapter = jiraTransport as unknown as JiraAdapter;
  const encryption = {
    decrypt: async () => 'lifecycle-fake-access-token',
    encrypt: async (value: string) => ({
      ciphertext: value,
      iv: 'lifecycle-iv',
      authTag: 'lifecycle-auth-tag',
      keyId: 'lifecycle-key',
    }),
  } as unknown as TokenEncryptionService;
  const configService = {
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
  } as unknown as ConfigService;
  const service = new TicketingService(
    repository,
    adapter,
    encryption,
    configService,
    null,
    context.auditService,
  );
  return {
    repository,
    service,
    listener: new TicketingListenerService(service, repository),
  };
}

function ticketFindingPayload(findingId: string, label: string) {
  return {
    findingOpensearchId: findingId,
    title: `Lifecycle ${label}`,
    description: `Deterministic lifecycle smoke finding ${label}`,
    severity: 'high',
  };
}

async function createDeadTriageEvent(
  context: SmokeContext,
  triageId: string,
  findingId: string,
): Promise<{ eventId: string; event: FindingTriageChangedEvent }> {
  const event: FindingTriageChangedEvent = {
    findingTriageId: triageId,
    findingOpensearchId: findingId,
    organizationId: context.ids.primaryOrganizationId,
    projectionVersion: 1,
    status: 'triaged',
    previousStatus: 'new',
    source: 'user',
    userId: context.ids.actorId,
  };
  const eventId = await createLifecycleOutboxAnchor(context, {
    eventType: 'finding.triage.changed',
    aggregateType: 'finding',
    aggregateId: findingId,
    dedupeKey: `lifecycle-triage:${findingId}:${context.ids.suiteId}`,
    payload: event as unknown as Record<string, unknown>,
    status: 'dead',
  });
  return { eventId, event };
}

async function runTicketingScenario(context: SmokeContext): Promise<void> {
  context.log(
    '[lifecycle-durability] ticketing: restart replay, ambiguity, reconciliation, dead revival',
  );
  const jiraTransport = new DeterministicJiraTransport();
  let runtime = createTicketingRuntime(context, jiraTransport);

  const connectionId = randomUUID();
  const foreignConnectionId = randomUUID();
  context.ledger.trackTicketingConnection(connectionId);
  context.ledger.trackTicketingConnection(foreignConnectionId);
  const connectionConfig: TicketingConnectionConfig = {
    projectKey: 'SEC',
    issueTypeId: '10001',
    statusMapping: {
      in_progress: {
        transitionName: 'Start Progress',
        resultingStatus: 'In Progress',
      },
    },
    autoCreateOnStatuses: ['triaged'],
  };
  const encryptedToken = {
    ciphertext: 'lifecycle-ciphertext',
    iv: 'lifecycle-iv',
    authTag: 'lifecycle-auth-tag',
    keyId: 'lifecycle-key',
  };
  await runtime.repository.createConnection({
    id: connectionId,
    organizationId: context.ids.primaryOrganizationId,
    provider: 'jira',
    accessToken: encryptedToken,
    refreshToken: null,
    tokenExpiresAt: null,
    cloudId: 'lifecycle-cloud',
    config: connectionConfig,
    createdBy: context.ids.actorId,
  });
  await runtime.repository.createConnection({
    id: foreignConnectionId,
    organizationId: context.ids.foreignOrganizationId,
    provider: 'jira',
    accessToken: encryptedToken,
    refreshToken: null,
    tokenExpiresAt: null,
    cloudId: 'lifecycle-cloud',
    config: connectionConfig,
    createdBy: 'foreign-actor',
  });

  const successfulTriageId = randomUUID();
  const ambiguousTriageId = randomUUID();
  const retryTriageId = randomUUID();
  const foreignTriageId = randomUUID();
  for (const triageId of [successfulTriageId, ambiguousTriageId, retryTriageId, foreignTriageId]) {
    context.ledger.trackFindingTriage(triageId);
  }
  const successfulFindingId = `lifecycle-finding-success-${context.ids.suiteId}`;
  const ambiguousFindingId = `lifecycle-finding-ambiguous-${context.ids.suiteId}`;
  const retryFindingId = `lifecycle-finding-retry-${context.ids.suiteId}`;
  const foreignFindingId = `lifecycle-finding-foreign-${context.ids.suiteId}`;
  await context.db.insert(findingTriageTable).values([
    {
      id: successfulTriageId,
      organizationId: context.ids.primaryOrganizationId,
      findingOpensearchId: successfulFindingId,
      status: 'triaged',
      projectionVersion: 1,
    },
    {
      id: ambiguousTriageId,
      organizationId: context.ids.primaryOrganizationId,
      findingOpensearchId: ambiguousFindingId,
      status: 'triaged',
      projectionVersion: 1,
    },
    {
      id: retryTriageId,
      organizationId: context.ids.primaryOrganizationId,
      findingOpensearchId: retryFindingId,
      status: 'triaged',
      projectionVersion: 1,
    },
    {
      id: foreignTriageId,
      organizationId: context.ids.foreignOrganizationId,
      findingOpensearchId: foreignFindingId,
      status: 'triaged',
      projectionVersion: 1,
    },
  ]);
  const foreignTicketLink = await runtime.repository.createTicketLink({
    findingTriageId: foreignTriageId,
    organizationId: context.ids.foreignOrganizationId,
    provider: 'jira',
    externalId: 'FOREIGN-1',
    externalUrl: 'https://foreign.atlassian.net/browse/FOREIGN-1',
    syncStatus: 'synced',
    metadata: { lastAppliedProjectionVersion: 1 },
  });

  jiraTransport.setCreateMode(successfulFindingId, 'success');
  const successfulLink = await runtime.service.createTicket(
    context.ids.primaryOrganizationId,
    successfulTriageId,
    ticketFindingPayload(successfulFindingId, 'successful replay'),
    1,
  );
  invariant(
    jiraTransport.createCount(successfulFindingId) === 1,
    'initial Jira reservation did not produce exactly one external create',
  );

  runtime = createTicketingRuntime(context, jiraTransport);
  const replayedLink = await runtime.service.createTicket(
    context.ids.primaryOrganizationId,
    successfulTriageId,
    ticketFindingPayload(successfulFindingId, 'successful replay'),
    1,
  );
  invariant(
    replayedLink.id === successfulLink.id && jiraTransport.createCount(successfulFindingId) === 1,
    'process restart replay duplicated an already finalized Jira create',
  );

  await runtime.service.updateTicketStatus(
    context.ids.primaryOrganizationId,
    successfulTriageId,
    'in_progress',
    2,
  );
  invariant(
    jiraTransport.transitionCount(successfulLink.externalId) === 1,
    'initial Jira status projection did not transition exactly once',
  );
  runtime = createTicketingRuntime(context, jiraTransport);
  await runtime.service.updateTicketStatus(
    context.ids.primaryOrganizationId,
    successfulTriageId,
    'in_progress',
    2,
  );
  await runtime.listener.handleFindingTriageChanged({
    findingTriageId: successfulTriageId,
    findingOpensearchId: successfulFindingId,
    organizationId: context.ids.primaryOrganizationId,
    projectionVersion: 1,
    status: 'in_progress',
    previousStatus: 'triaged',
    source: 'user',
    userId: context.ids.actorId,
  });
  invariant(
    jiraTransport.transitionCount(successfulLink.externalId) === 1,
    'restart or stale projection replay duplicated a Jira update',
  );

  const ambiguousDeadEvent = await createDeadTriageEvent(
    context,
    ambiguousTriageId,
    ambiguousFindingId,
  );
  jiraTransport.setCreateMode(ambiguousFindingId, 'accept-then-throw');
  await expectFailure(
    () =>
      runtime.service.createTicket(
        context.ids.primaryOrganizationId,
        ambiguousTriageId,
        ticketFindingPayload(ambiguousFindingId, 'ambiguous accepted create'),
        1,
      ),
    'response was lost',
  );
  const ambiguousIssueKey = jiraTransport.issueKeyForFinding(ambiguousFindingId);
  invariant(ambiguousIssueKey, 'fake Jira did not retain the ambiguously accepted issue');
  const unresolvedAmbiguous = await runtime.repository.findUnresolvedTicketIntent({
    findingTriageId: ambiguousTriageId,
    organizationId: context.ids.primaryOrganizationId,
  });
  invariant(
    unresolvedAmbiguous?.syncStatus === 'unknown',
    'ambiguous Jira create was not retained as an unknown local intent',
  );

  runtime = createTicketingRuntime(context, jiraTransport);
  const attached = await runtime.service.reconcileTicketCreation(context.auth, ambiguousTriageId, {
    action: 'attach',
    issueKey: ambiguousIssueKey,
  });
  invariant(
    attached.status === 'attached' && jiraTransport.createCount(ambiguousFindingId) === 1,
    'ambiguous Jira reconciliation duplicated the external create',
  );
  const attachedOutbox = await context.db
    .select()
    .from(outboxEventsTable)
    .where(eq(outboxEventsTable.id, ambiguousDeadEvent.eventId));
  invariant(
    attachedOutbox[0]?.status === 'pending',
    'attach reconciliation did not revive the exact dead triage event',
  );
  runtime = createTicketingRuntime(context, jiraTransport);
  await runtime.listener.handleFindingTriageChanged(ambiguousDeadEvent.event);
  invariant(
    jiraTransport.createCount(ambiguousFindingId) === 1,
    'replayed reconciled Jira event created a duplicate issue',
  );

  const retryDeadEvent = await createDeadTriageEvent(context, retryTriageId, retryFindingId);
  jiraTransport.setCreateMode(retryFindingId, 'reject-then-throw');
  await expectFailure(
    () =>
      runtime.service.createTicket(
        context.ids.primaryOrganizationId,
        retryTriageId,
        ticketFindingPayload(retryFindingId, 'explicit dead retry'),
        1,
      ),
    'rejected the request',
  );
  invariant(
    jiraTransport.issueKeyForFinding(retryFindingId) === undefined,
    'fake Jira unexpectedly created an issue before explicit retry',
  );
  runtime = createTicketingRuntime(context, jiraTransport);
  const retryResult = await runtime.service.reconcileTicketCreation(context.auth, retryTriageId, {
    action: 'clear_and_retry',
    confirmedNoIssueExists: true,
  });
  invariant(retryResult.status === 'retry_queued', 'explicit Jira retry was not queued');
  const revivedRetryOutbox = await context.db
    .select()
    .from(outboxEventsTable)
    .where(eq(outboxEventsTable.id, retryDeadEvent.eventId));
  invariant(
    revivedRetryOutbox[0]?.status === 'pending',
    'explicit Jira retry did not revive the exact dead event',
  );

  jiraTransport.setCreateMode(retryFindingId, 'success');
  runtime = createTicketingRuntime(context, jiraTransport);
  await runtime.listener.handleFindingTriageChanged(retryDeadEvent.event);
  invariant(
    jiraTransport.createCount(retryFindingId) === 2 &&
      jiraTransport.issueKeyForFinding(retryFindingId) !== undefined,
    'explicit Jira retry did not create exactly one replacement attempt',
  );
  runtime = createTicketingRuntime(context, jiraTransport);
  await runtime.listener.handleFindingTriageChanged(retryDeadEvent.event);
  invariant(
    jiraTransport.createCount(retryFindingId) === 2,
    'post-restart Jira retry replay duplicated the external create',
  );

  invariant(
    (await runtime.service.getTicketLink(context.ids.primaryOrganizationId, foreignTriageId)) ===
      null,
    'foreign ticket sentinel was visible through the primary tenant service',
  );
  await expectFailure(
    () =>
      runtime.service.reconcileTicketCreation(context.auth, foreignTriageId, {
        action: 'clear_and_retry',
        confirmedNoIssueExists: true,
      }),
    'Unresolved Jira ticket creation intent not found',
  );
  const foreignLinkAfterProbe = await context.db
    .select()
    .from(ticketLinksTable)
    .where(eq(ticketLinksTable.id, foreignTicketLink.id));
  invariant(
    foreignLinkAfterProbe.length === 1 &&
      foreignLinkAfterProbe[0]?.organizationId === context.ids.foreignOrganizationId,
    'cross-tenant reconciliation changed the foreign ticket sentinel',
  );
}

export async function runLifecycleDurabilitySmoke(
  env: ScriptEnvironment = process.env,
  log: (message: string) => void = console.log,
): Promise<void> {
  const config = resolveLifecycleSmokeConfig(env);
  log(formatDatabaseTarget(config.databaseTarget));
  log(`Connection: ${config.databaseTarget.redactedConnectionString}`);
  log(`Lifecycle smoke instance: ${config.instance}`);

  const pool = new Pool(buildLifecyclePoolConfig(config));
  const db = drizzle(pool, { schema: databaseSchema });
  const repositoryDb = db as unknown as NodePgDatabase;
  const ids = buildIdentifiers();
  const ledger = new LifecycleSmokeResourceLedger([
    ids.primaryOrganizationId,
    ids.foreignOrganizationId,
  ]);
  const auth: AuthContext = {
    userId: ids.actorId,
    organizationId: ids.primaryOrganizationId,
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'local',
  };
  const auditRepository = new AuditLogRepository(repositoryDb);
  const auditService = new AuditLogService(auditRepository);
  const context: SmokeContext = {
    pool,
    db,
    repositoryDb,
    ids,
    ledger,
    auth,
    auditRepository,
    auditService,
    channelRepository: new NotificationChannelRepository(repositoryDb),
    deliveryRepository: new NotificationDeliveryRepository(repositoryDb),
    outboxRepository: new OutboxRepository(repositoryDb),
    log,
  };

  try {
    await executeLifecycleSmokePlan({
      verifyCheckedSchema: async () => {
        log('[lifecycle-durability] verifying checked migration ledger and schema');
        await verifyCheckedSchema(pool);
      },
      runAuditScenario: () => runAuditScenario(context),
      runNotificationScenario: () => runNotificationScenario(context),
      runTicketingScenario: () => runTicketingScenario(context),
      cleanup: async () => {
        log('[lifecycle-durability] removing exact lifecycle fixture IDs');
        await cleanupLifecycleFixtures(pool, ledger.snapshot());
      },
    });
    log('[lifecycle-durability] PostgreSQL lifecycle durability smoke passed');
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  runLifecycleDurabilitySmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
