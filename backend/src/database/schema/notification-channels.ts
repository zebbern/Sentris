import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const notificationChannelsTable = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().$type<'slack' | 'discord' | 'email' | 'pagerduty'>(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().default('active').$type<'active' | 'inactive'>(),
    events: jsonb('events').notNull().$type<string[]>(),
    createdBy: varchar('created_by', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedAtIdx: index('notification_channels_org_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const notificationDeliveriesTable = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => notificationChannelsTable.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    eventType: text('event_type').notNull(),
    status: text('status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'sending' | 'sent' | 'failed' | 'unknown'>(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sendingStartedAt: timestamp('sending_started_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    responseStatus: smallint('response_status'),
    responseBody: text('response_body'),
    outboxEventId: uuid('outbox_event_id'),
  },
  (table) => ({
    channelCreatedAtIdx: index('notification_deliveries_channel_created_at_idx').on(
      table.channelId,
      table.createdAt,
    ),
    runIdIdx: index('notification_deliveries_run_id_idx').on(table.runId),
    channelOutboxEventIdx: uniqueIndex('notification_deliveries_channel_outbox_event_idx').on(
      table.channelId,
      table.outboxEventId,
    ),
    resolvedRetentionIdx: index('notification_deliveries_resolved_retention_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status} IN ('sent', 'failed')`),
  }),
);

export type NotificationChannelRecord = typeof notificationChannelsTable.$inferSelect;
export type NotificationChannelInsert = typeof notificationChannelsTable.$inferInsert;
export type NotificationDeliveryRecord = typeof notificationDeliveriesTable.$inferSelect;
export type NotificationDeliveryInsert = typeof notificationDeliveriesTable.$inferInsert;
