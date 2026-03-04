import { integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * SLA policies table — configurable per-organization severity→deadline mappings.
 * One row per (organization, severity) pair defines the deadline in hours for that severity level.
 */
export const slaPoliciesTable = pgTable(
  'sla_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    severity: varchar('severity', { length: 32 }).notNull(),
    deadlineHours: integer('deadline_hours').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSeverityUidx: uniqueIndex('sla_policies_org_severity_uidx').on(
      table.organizationId,
      table.severity,
    ),
  }),
);

// Type exports
export type SlaPolicyRecord = typeof slaPoliciesTable.$inferSelect;
export type SlaPolicyInsert = typeof slaPoliciesTable.$inferInsert;
