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

import type {
  CapabilityGrant,
  InvocationManifest,
  McpCapabilityCatalogSnapshot,
} from '@sentris/shared';

export type McpInvocationStatus =
  | 'planned'
  | 'prepared'
  | 'dispatched'
  | 'completed'
  | 'failed'
  | 'ambiguous'
  | 'cancelled';

export type McpInvocationDestination = 'component-activity' | 'mcp-activity';
export type McpInvocationRetryPolicy = 'pre-dispatch-only' | 'reviewed-idempotent';

export const mcpCapabilityGrantsTable = pgTable(
  'mcp_capability_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorityKey: varchar('authority_key', { length: 64 }).notNull().unique(),
    organizationId: varchar('organization_id', { length: 191 }),
    subjectKind: varchar('subject_kind', { length: 32 }).notNull(),
    subjectId: text('subject_id').notNull(),
    grant: jsonb('grant').$type<CapabilityGrant>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    authorityKeyCheck: check(
      'mcp_capability_grants_authority_key_check',
      sql`${table.authorityKey} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);

export const mcpCapabilitySnapshotsTable = pgTable(
  'mcp_capability_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    capabilityGrantId: uuid('capability_grant_id')
      .notNull()
      .unique()
      .references(() => mcpCapabilityGrantsTable.id, { onDelete: 'restrict' }),
    configFingerprint: varchar('config_fingerprint', { length: 64 }).notNull(),
    snapshot: jsonb('snapshot').$type<McpCapabilityCatalogSnapshot>().notNull(),
    invocationManifest: jsonb('invocation_manifest').$type<InvocationManifest>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    configFingerprintCheck: check(
      'mcp_capability_snapshots_config_fingerprint_check',
      sql`${table.configFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);

export const mcpInvocationsTable = pgTable(
  'mcp_invocations',
  {
    invocationId: uuid('invocation_id').primaryKey(),
    runId: text('run_id').notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    capabilityGrantId: uuid('capability_grant_id')
      .notNull()
      .references(() => mcpCapabilityGrantsTable.id, { onDelete: 'restrict' }),
    capabilitySnapshotId: uuid('capability_snapshot_id')
      .notNull()
      .references(() => mcpCapabilitySnapshotsTable.id, { onDelete: 'restrict' }),
    toolName: varchar('tool_name', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    request: jsonb('request').$type<unknown>().notNull(),
    status: varchar('status', { length: 32 }).$type<McpInvocationStatus>().notNull(),
    currentAttemptNumber: integer('current_attempt_number').notNull().default(1),
    result: jsonb('result').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
  },
  (table) => ({
    runCreatedAtIdx: index('mcp_invocations_run_created_at_idx').on(table.runId, table.createdAt),
    organizationCreatedAtIdx: index('mcp_invocations_organization_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    statusUpdatedAtIdx: index('mcp_invocations_status_updated_at_idx').on(
      table.status,
      table.updatedAt,
    ),
    requestHashCheck: check(
      'mcp_invocations_request_hash_check',
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    statusCheck: check(
      'mcp_invocations_status_check',
      sql`${table.status} IN ('planned', 'prepared', 'dispatched', 'completed', 'failed', 'ambiguous', 'cancelled')`,
    ),
    currentAttemptNumberCheck: check(
      'mcp_invocations_current_attempt_number_check',
      sql`${table.currentAttemptNumber} > 0`,
    ),
  }),
);

export const mcpInvocationAttemptsTable = pgTable(
  'mcp_invocation_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invocationId: uuid('invocation_id')
      .notNull()
      .references(() => mcpInvocationsTable.invocationId, { onDelete: 'restrict' }),
    attemptNumber: integer('attempt_number').notNull(),
    sourceId: text('source_id').notNull(),
    destination: varchar('destination', { length: 32 }).$type<McpInvocationDestination>().notNull(),
    retryPolicy: varchar('retry_policy', { length: 32 })
      .$type<McpInvocationRetryPolicy>()
      .notNull(),
    status: varchar('status', { length: 32 }).$type<McpInvocationStatus>().notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    invocationAttemptIdx: uniqueIndex('mcp_invocation_attempts_invocation_attempt_idx').on(
      table.invocationId,
      table.attemptNumber,
    ),
    statusIdx: index('mcp_invocation_attempts_status_idx').on(table.status),
    attemptNumberCheck: check(
      'mcp_invocation_attempts_attempt_number_check',
      sql`${table.attemptNumber} > 0`,
    ),
    destinationCheck: check(
      'mcp_invocation_attempts_destination_check',
      sql`${table.destination} IN ('component-activity', 'mcp-activity')`,
    ),
    retryPolicyCheck: check(
      'mcp_invocation_attempts_retry_policy_check',
      sql`${table.retryPolicy} IN ('pre-dispatch-only', 'reviewed-idempotent')`,
    ),
    statusCheck: check(
      'mcp_invocation_attempts_status_check',
      sql`${table.status} IN ('planned', 'prepared', 'dispatched', 'completed', 'failed', 'ambiguous', 'cancelled')`,
    ),
  }),
);

export type McpCapabilityGrantRecord = typeof mcpCapabilityGrantsTable.$inferSelect;
export type McpCapabilityGrantInsert = typeof mcpCapabilityGrantsTable.$inferInsert;
export type McpCapabilitySnapshotRecord = typeof mcpCapabilitySnapshotsTable.$inferSelect;
export type McpCapabilitySnapshotInsert = typeof mcpCapabilitySnapshotsTable.$inferInsert;
export type McpInvocationRecord = typeof mcpInvocationsTable.$inferSelect;
export type McpInvocationInsert = typeof mcpInvocationsTable.$inferInsert;
export type McpInvocationAttemptRecord = typeof mcpInvocationAttemptsTable.$inferSelect;
export type McpInvocationAttemptInsert = typeof mcpInvocationAttemptsTable.$inferInsert;
