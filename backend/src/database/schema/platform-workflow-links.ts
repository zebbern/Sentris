import { index, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const platformWorkflowLinksTable = pgTable(
  'platform_workflow_links',
  {
    id: uuid('id').defaultRandom().notNull(),
    workflowId: uuid('workflow_id').notNull(),
    platformAgentId: varchar('platform_agent_id', { length: 191 }).notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    agentIdx: index('platform_workflow_links_agent_idx').on(table.platformAgentId),
    orgIdx: index('platform_workflow_links_org_idx').on(table.organizationId),
  }),
);

export type PlatformWorkflowLinkRecord = typeof platformWorkflowLinksTable.$inferSelect;
