import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { WorkflowDefinition } from '../../dsl/types';
import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export const workflowsTable = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    compiledDefinition: jsonb('compiled_definition')
      .$type<WorkflowDefinition | null>()
      .default(null),
    lastRun: timestamp('last_run', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('workflows_organization_id_idx').on(table.organizationId),
    orgCreatedAtIdx: index('workflows_org_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    updatedAtIdx: index('workflows_updated_at_idx').on(table.updatedAt),
  }),
);
