import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { workflowsTable } from './workflows';

export const workflowTagsTable = pgTable(
  'workflow_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflowsTable.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueWorkflowTag: unique('uq_workflow_tags_workflow_id_name').on(table.workflowId, table.name),
    workflowIdx: index('idx_workflow_tags_workflow_id').on(table.workflowId),
    nameIdx: index('idx_workflow_tags_name').on(table.name),
  }),
);

export type WorkflowTagRecord = typeof workflowTagsTable.$inferSelect;
export type NewWorkflowTag = typeof workflowTagsTable.$inferInsert;
