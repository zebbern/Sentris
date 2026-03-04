# Agent: database

## Purpose

Create Drizzle ORM schema definitions for the `notification_channels` and `notification_deliveries` tables, and register them in the schema barrel export.

## Skills

Load before starting: database-patterns

## Subtasks

- [x] Create `backend/src/database/schema/notification-channels.ts` with the `notificationChannelsTable` definition: id (uuid PK, defaultRandom), organizationId (varchar 191, notNull), name (text, notNull), type (text, notNull, typed as `'slack' | 'email' | 'pagerduty'`), config (jsonb, notNull), status (text, notNull, default `'active'`, typed as `'active' | 'inactive'`), events (jsonb, notNull, typed as `string[]`), createdBy (varchar 191), createdAt (timestamp with timezone, defaultNow, notNull), updatedAt (timestamp with timezone, defaultNow, notNull)
- [x] Add composite index `notification_channels_org_created_at_idx` on `(organizationId, createdAt)` to `notificationChannelsTable`
- [x] Create `notificationDeliveriesTable` in the same file: id (uuid PK, defaultRandom), channelId (uuid, notNull, FK → notificationChannelsTable.id with onDelete cascade), runId (text), eventType (text, notNull), status (text, notNull, default `'pending'`, typed as `'pending' | 'sent' | 'failed'`), payload (jsonb, notNull), errorMessage (text), createdAt (timestamp with timezone, defaultNow, notNull), sentAt (timestamp with timezone)
- [x] Add index `notification_deliveries_channel_created_at_idx` on `(channelId, createdAt)` and index `notification_deliveries_run_id_idx` on `(runId)` to `notificationDeliveriesTable`
- [x] Export inferred types: `NotificationChannelRecord`, `NotificationChannelInsert`, `NotificationDeliveryRecord`, `NotificationDeliveryInsert`
- [x] Add `export * from './notification-channels'` to `backend/src/database/schema/index.ts`
- [ ] Run `bun --cwd backend run migration:push` to verify schema pushes cleanly (or dry-run if instance is not running) — skipped: constraint says DO NOT run migration

## Notes

- Follow the exact pattern from `backend/src/database/schema/webhooks.ts` for table structure, index definitions, and type exports.
- Use `drizzle-orm/pg-core` imports matching the existing pattern.
- The `config` JSONB field stores type-specific configuration (Slack: `{ webhookUrl: string }`). Type it as `Record<string, unknown>` at the schema level — strict typing happens in Zod DTOs.
- The `events` JSONB field stores an array of event type strings (e.g., `['run.completed', 'run.failed']`).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
