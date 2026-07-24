import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { scopes } from './scopes';

export const assetTypeEnum = pgEnum('asset_type', [
  'subdomain',
  'host',
  'ip-address',
  'open-port',
  'http-probe',
  'dns-record',
  'crawled-url',
  'url',
]);

export const assetInventory = pgTable(
  'asset_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'cascade' }),
    assetType: assetTypeEnum('asset_type').notNull(),
    assetValue: varchar('asset_value', { length: 1024 }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    firstSeenRunId: text('first_seen_run_id'),
    lastSeenRunId: text('last_seen_run_id'),
    sourceComponentId: varchar('source_component_id', { length: 191 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('asset_inventory_org_idx').on(table.organizationId),
    scopeIdx: index('asset_inventory_scope_idx').on(table.scopeId),
    dedupUnique: uniqueIndex('asset_inventory_org_scope_type_value_uidx').on(
      table.organizationId,
      table.scopeId,
      table.assetType,
      table.assetValue,
    ),
    scopeLastSeenIdx: index('asset_inventory_scope_lastseen_idx').on(
      table.scopeId,
      table.lastSeenAt,
    ),
  }),
);

export type AssetRecord = typeof assetInventory.$inferSelect;
export type NewAssetRecord = typeof assetInventory.$inferInsert;
