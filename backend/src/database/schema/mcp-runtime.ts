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
export type McpInvocationOperationKind = 'tool-call' | 'resource-read' | 'prompt-get';

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
    operationKind: varchar('operation_kind', { length: 32 }).$type<McpInvocationOperationKind>(),
    operationTarget: text('operation_target'),
    toolName: varchar('tool_name', { length: 128 }),
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
    operationKindCheck: check(
      'mcp_invocations_operation_kind_check',
      sql`${table.operationKind} IN ('tool-call', 'resource-read', 'prompt-get')`,
    ),
    operationTargetCheck: check(
      'mcp_invocations_operation_target_check',
      sql`char_length(${table.operationTarget}) >= 1 AND char_length(${table.operationTarget}) <= 8192`,
    ),
    operationIdentityCheck: check(
      'mcp_invocations_operation_identity_check',
      sql`${table.operationKind} IS NULL AND ${table.operationTarget} IS NULL OR ${table.operationKind} IS NOT NULL AND ${table.operationTarget} IS NOT NULL`,
    ),
    toolProjectionCheck: check(
      'mcp_invocations_tool_projection_check',
      sql`${table.operationKind} IS NULL AND ${table.operationTarget} IS NULL AND ${table.toolName} IS NOT NULL OR ${table.operationKind} = 'tool-call' AND ${table.toolName} IS NOT NULL AND ${table.toolName} = ${table.operationTarget} OR ${table.operationKind} <> 'tool-call' AND ${table.toolName} IS NULL`,
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
    runtimeId: uuid('runtime_id'),
    ownerId: text('owner_id'),
    ownerEpoch: uuid('owner_epoch'),
    leaseGeneration: integer('lease_generation'),
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
    leaseGenerationCheck: check(
      'mcp_invocation_attempts_lease_generation_check',
      sql`${table.leaseGeneration} IS NULL OR ${table.leaseGeneration} > 0`,
    ),
    runtimeFenceCheck: check(
      'mcp_invocation_attempts_runtime_fence_check',
      sql`${table.runtimeId} IS NULL AND ${table.ownerId} IS NULL AND ${table.ownerEpoch} IS NULL AND ${table.leaseGeneration} IS NULL OR ${table.runtimeId} IS NOT NULL AND ${table.ownerId} IS NOT NULL AND ${table.ownerEpoch} IS NOT NULL AND ${table.leaseGeneration} IS NOT NULL`,
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
