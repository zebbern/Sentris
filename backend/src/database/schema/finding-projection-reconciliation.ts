import { check, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const findingProjectionReconciliationTable = pgTable(
  'finding_projection_reconciliation',
  {
    organizationId: varchar('organization_id', { length: 191 }).primaryKey(),
    cursor: varchar('cursor', { length: 512 }),
    cycleStartedAt: timestamp('cycle_started_at', { withTimezone: true }),
    cycleCutoff: timestamp('cycle_cutoff', { withTimezone: true }),
    checked: integer('checked').notNull().default(0),
    repaired: integer('repaired').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
    reconciledThrough: timestamp('reconciled_through', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    countersCheck: check(
      'finding_projection_reconciliation_counters_check',
      sql`${table.checked} >= 0 AND ${table.repaired} >= 0 AND ${table.failed} >= 0`,
    ),
  }),
);

export type FindingProjectionReconciliationRecord =
  typeof findingProjectionReconciliationTable.$inferSelect;
export type FindingProjectionReconciliationInsert =
  typeof findingProjectionReconciliationTable.$inferInsert;
