import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export type OutboxEventStatus = 'pending' | 'processing' | 'completed' | 'dead';

export const outboxEventsTable = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 512 }).notNull(),
    dedupeKey: varchar('dedupe_key', { length: 512 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 16 })
      .$type<OutboxEventStatus>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 191 }),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dedupeKeyIdx: uniqueIndex('outbox_events_dedupe_key_idx').on(table.dedupeKey),
    claimIdx: index('outbox_events_claim_idx').on(table.status, table.availableAt, table.createdAt),
    leaseIdx: index('outbox_events_lease_idx').on(table.status, table.lockedAt),
    orgDeadIdx: index('outbox_events_org_dead_idx').on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    orgEventStatusIdx: index('outbox_events_org_event_status_idx').on(
      table.organizationId,
      table.eventType,
      table.status,
    ),
    telemetryRetentionIdx: index('outbox_events_telemetry_retention_idx')
      .on(table.eventType, table.createdAt, table.id)
      .where(
        sql`${table.status} = 'completed' AND ${table.eventType} IN ('telemetry.kafka.ingested.v1', 'telemetry.kafka.publish.v1')`,
      ),
    statusCheck: check(
      'outbox_events_status_check',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'dead')`,
    ),
    attemptsCheck: check(
      'outbox_events_attempts_check',
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0`,
    ),
  }),
);

export type OutboxEventRecord = typeof outboxEventsTable.$inferSelect;
export type OutboxEventInsert = typeof outboxEventsTable.$inferInsert;
