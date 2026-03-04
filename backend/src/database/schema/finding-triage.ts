import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Finding triage lifecycle status enum.
 * Represents the vulnerability lifecycle state machine:
 *   new → triaged → in_progress → fixed → verified (terminal)
 *   Any non-terminal state can transition to wont_fix or accepted_risk.
 *   wont_fix / accepted_risk can reopen to triaged.
 */
export const findingTriageStatusEnum = pgEnum('finding_triage_status', [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'verified',
  'wont_fix',
  'accepted_risk',
]);

/**
 * Finding triage table — stores the current triage state for each finding.
 * One record per (organization, OpenSearch finding) pair.
 */
export const findingTriageTable = pgTable(
  'finding_triage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    findingOpensearchId: varchar('finding_opensearch_id', { length: 512 }).notNull(),
    status: findingTriageStatusEnum('status').notNull().default('new'),
    assigneeUserId: varchar('assignee_user_id', { length: 191 }),
    severityOverride: varchar('severity_override', { length: 32 }),
    notes: text('notes'),
    slaDeadline: timestamp('sla_deadline', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgFindingIdx: uniqueIndex('finding_triage_org_finding_idx').on(
      table.organizationId,
      table.findingOpensearchId,
    ),
    statusIdx: index('finding_triage_status_idx').on(table.organizationId, table.status),
    assigneeIdx: index('finding_triage_assignee_idx').on(
      table.organizationId,
      table.assigneeUserId,
    ),
    orgCreatedAtIdx: index('finding_triage_org_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    orgSeverityCreatedAtIdx: index('finding_triage_org_severity_created_at_idx').on(
      table.organizationId,
      table.severityOverride,
      table.createdAt,
    ),
  }),
);

/**
 * Finding triage events table — audit log of all triage changes.
 * Every status change, assignment, severity override, or note creates an event.
 */
export const findingTriageEventsTable = pgTable(
  'finding_triage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    findingTriageId: uuid('finding_triage_id')
      .notNull()
      .references(() => findingTriageTable.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    fieldChanged: varchar('field_changed', { length: 64 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    userId: varchar('user_id', { length: 191 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    triageCreatedAtIdx: index('finding_triage_events_triage_idx').on(
      table.findingTriageId,
      table.createdAt,
    ),
  }),
);

// Type exports
export type FindingTriageRecord = typeof findingTriageTable.$inferSelect;
export type FindingTriageInsert = typeof findingTriageTable.$inferInsert;
export type FindingTriageEventRecord = typeof findingTriageEventsTable.$inferSelect;
export type FindingTriageEventInsert = typeof findingTriageEventsTable.$inferInsert;
