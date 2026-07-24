import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const scopes = pgTable(
  'scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    description: text('description'),
    domains: text('domains').array().notNull().default([]),
    repos: text('repos').array().notNull().default([]),
    ipRanges: text('ip_ranges').array().notNull().default([]),
    runtimeValues: jsonb('runtime_values').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: varchar('created_by', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('scopes_org_idx').on(table.organizationId),
    orgNameUnique: uniqueIndex('scopes_org_name_uidx').on(table.organizationId, table.name),
  }),
);

export type ScopeRecord = typeof scopes.$inferSelect;
export type NewScopeRecord = typeof scopes.$inferInsert;
