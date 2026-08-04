import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export type AgentConversationTurnStatus = 'queued' | 'running' | 'completed' | 'failed';

export const agentConversationTurnsTable = pgTable(
  'agent_conversation_turns',
  {
    id: uuid('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    agentRunId: text('agent_run_id').notNull(),
    sourceAgentRunId: text('source_agent_run_id').notNull(),
    turnIndex: integer('turn_index').notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    workflowRunId: text('workflow_run_id').notNull(),
    nodeRef: text('node_ref').notNull(),
    prompt: text('prompt').notNull(),
    sourceStateFileId: uuid('source_state_file_id').notNull(),
    sourceStateRootFileId: uuid('source_state_root_file_id').notNull(),
    temporalWorkflowId: text('temporal_workflow_id').notNull(),
    temporalRunId: text('temporal_run_id'),
    status: varchar('status', { length: 32 })
      .$type<AgentConversationTurnStatus>()
      .notNull()
      .default('queued'),
    responseText: text('response_text'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    conversationTurnUnique: uniqueIndex('agent_conversation_turns_conversation_turn_uidx').on(
      table.conversationId,
      table.turnIndex,
    ),
    agentRunUnique: uniqueIndex('agent_conversation_turns_agent_run_uidx').on(table.agentRunId),
    temporalWorkflowUnique: uniqueIndex('agent_conversation_turns_temporal_workflow_uidx').on(
      table.temporalWorkflowId,
    ),
    activeConversationUnique: uniqueIndex('agent_conversation_turns_active_conversation_uidx')
      .on(table.conversationId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    conversationCreatedIndex: index('agent_conversation_turns_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export type AgentConversationTurnRecord = typeof agentConversationTurnsTable.$inferSelect;
export type AgentConversationTurnInsert = typeof agentConversationTurnsTable.$inferInsert;
