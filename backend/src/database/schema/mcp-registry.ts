import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
  integer,
} from 'drizzle-orm/pg-core';

/**
 * Registry catalog — cached entries from the Docker MCP Registry.
 * Global table (not org-scoped). Populated by the sync service.
 */
export const registryCatalog = pgTable(
  'registry_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 191 }).notNull().unique(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    serverType: varchar('server_type', { length: 32 }).notNull(), // 'server' | 'remote'
    category: varchar('category', { length: 64 }),
    tags: jsonb('tags').$type<string[]>().default([]),
    iconUrl: text('icon_url'),
    sourceUrl: text('source_url'),
    dockerImage: varchar('docker_image', { length: 512 }),
    remoteConfig: jsonb('remote_config')
      .$type<{
        transportType: 'streamable-http' | 'sse';
        url: string;
        headers?: Record<string, string>;
      } | null>()
      .default(null),
    configSchema: jsonb('config_schema')
      .$type<{
        secrets?: { name: string; env: string; example?: string }[];
        env?: { name: string; example?: string; value?: string }[];
        parameters?: Record<string, unknown>;
      } | null>()
      .default(null),
    runConfig: jsonb('run_config')
      .$type<{
        command?: string[];
        volumes?: string[];
        env?: Record<string, string>;
      } | null>()
      .default(null),
    oauthConfig: jsonb('oauth_config')
      .$type<
        | {
            provider: string;
            secret?: string;
            env?: string;
          }[]
        | null
      >()
      .default(null),
    isFeatured: boolean('is_featured').notNull().default(false),
    registryCommitSha: varchar('registry_commit_sha', { length: 64 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    categoryIdx: index('registry_catalog_category_idx').on(table.category),
    serverTypeIdx: index('registry_catalog_server_type_idx').on(table.serverType),
    featuredIdx: index('registry_catalog_featured_idx').on(table.isFeatured),
  }),
);

/**
 * Sync state tracker — stores the last tree SHA and sync metadata.
 * Single-row table (id='default').
 */
export const registrySyncState = pgTable('registry_sync_state', {
  id: varchar('id', { length: 64 }).primaryKey().default('default'),
  lastTreeSha: varchar('last_tree_sha', { length: 64 }),
  lastCommitSha: varchar('last_commit_sha', { length: 64 }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: varchar('last_sync_status', { length: 32 }),
  serversSynced: integer('servers_synced').default(0),
  serversAdded: integer('servers_added').default(0),
  serversRemoved: integer('servers_removed').default(0),
  serversUpdated: integer('servers_updated').default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type RegistryCatalogRecord = typeof registryCatalog.$inferSelect;
export type NewRegistryCatalogRecord = typeof registryCatalog.$inferInsert;
export type RegistrySyncStateRecord = typeof registrySyncState.$inferSelect;
