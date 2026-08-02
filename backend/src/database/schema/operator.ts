import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type {
  OperatorActionStatus,
  OperatorApprovalMode,
  OperatorCommandEffect,
  OperatorCommandName,
  OperatorMessageRole,
  OperatorSessionStatus,
  OperatorStoredTurnContext,
  OperatorTurnStatus,
} from '@sentris/shared';
import type { AuthRole } from '../../auth/types';

export const operatorSessionsTable = pgTable(
  'operator_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    userId: varchar('user_id', { length: 191 }).notNull(),
    title: varchar('title', { length: 191 }).notNull().default('New Operator session'),
    approvalMode: varchar('approval_mode', { length: 32 })
      .$type<OperatorApprovalMode>()
      .notNull()
      .default('ask'),
    status: varchar('status', { length: 32 })
      .$type<OperatorSessionStatus>()
      .notNull()
      .default('active'),
    modelProvider: varchar('model_provider', { length: 64 }).notNull(),
    modelId: varchar('model_id', { length: 191 }).notNull(),
    apiKeySecretId: uuid('api_key_secret_id').notNull(),
    baseUrl: text('base_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerUpdatedIdx: index('operator_sessions_owner_updated_idx').on(
      table.organizationId,
      table.userId,
      table.updatedAt,
    ),
  }),
);

export const operatorTurnsTable = pgTable(
  'operator_turns',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => operatorSessionsTable.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 32 })
      .$type<OperatorTurnStatus>()
      .notNull()
      .default('queued'),
    temporalWorkflowId: text('temporal_workflow_id'),
    temporalRunId: text('temporal_run_id'),
    actorRoles: jsonb('actor_roles').$type<AuthRole[]>().notNull().default(['MEMBER']),
    context: jsonb('context').$type<OperatorStoredTurnContext>().default(null),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    sessionCreatedIdx: index('operator_turns_session_created_idx').on(
      table.sessionId,
      table.createdAt,
    ),
    temporalWorkflowUnique: uniqueIndex('operator_turns_temporal_workflow_uidx').on(
      table.temporalWorkflowId,
    ),
  }),
);

export const operatorMessagesTable = pgTable(
  'operator_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => operatorSessionsTable.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => operatorTurnsTable.id, { onDelete: 'cascade' }),
    sequence: serial('sequence').notNull(),
    role: varchar('role', { length: 32 }).$type<OperatorMessageRole>().notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionSequenceIdx: index('operator_messages_session_sequence_idx').on(
      table.sessionId,
      table.sequence,
    ),
    turnRoleUnique: uniqueIndex('operator_messages_turn_role_uidx').on(table.turnId, table.role),
    turnIdx: index('operator_messages_turn_idx').on(table.turnId),
  }),
);

export const operatorActionsTable = pgTable(
  'operator_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => operatorSessionsTable.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => operatorTurnsTable.id, { onDelete: 'cascade' }),
    toolCallId: varchar('tool_call_id', { length: 191 }).notNull(),
    commandName: varchar('command_name', { length: 64 }).$type<OperatorCommandName>().notNull(),
    effect: varchar('effect', { length: 32 }).$type<OperatorCommandEffect>().notNull(),
    approvalMode: varchar('approval_mode', { length: 32 }).$type<OperatorApprovalMode>().notNull(),
    approvalRequired: boolean('approval_required').notNull().default(false),
    status: varchar('status', { length: 32 })
      .$type<OperatorActionStatus>()
      .notNull()
      .default('proposed'),
    version: integer('version').notNull().default(0),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<unknown | null>().default(null),
    error: text('error'),
    runId: text('run_id'),
    decidedBy: varchar('decided_by', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    turnToolCallUnique: uniqueIndex('operator_actions_turn_tool_call_uidx').on(
      table.turnId,
      table.toolCallId,
    ),
    sessionCreatedIdx: index('operator_actions_session_created_idx').on(
      table.sessionId,
      table.createdAt,
    ),
    pendingIdx: index('operator_actions_session_status_idx').on(table.sessionId, table.status),
    runIdx: index('operator_actions_run_id_idx').on(table.runId),
  }),
);

export type OperatorSessionRecord = typeof operatorSessionsTable.$inferSelect;
export type OperatorSessionInsert = typeof operatorSessionsTable.$inferInsert;
export type OperatorTurnRecord = typeof operatorTurnsTable.$inferSelect;
export type OperatorTurnInsert = typeof operatorTurnsTable.$inferInsert;
export type OperatorMessageRecord = typeof operatorMessagesTable.$inferSelect;
export type OperatorMessageInsert = typeof operatorMessagesTable.$inferInsert;
export type OperatorActionRecord = typeof operatorActionsTable.$inferSelect;
export type OperatorActionInsert = typeof operatorActionsTable.$inferInsert;
