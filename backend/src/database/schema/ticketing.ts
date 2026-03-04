import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { findingTriageTable } from './finding-triage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** AES-256-GCM encrypted field stored as JSONB (same shape as integration_tokens). */
export interface EncryptedField {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
}

/** JSONB stored in the `config` column of `ticketing_connections`. */
export interface TicketingConnectionConfig {
  projectKey: string;
  issueTypeId: string;
  statusMapping: Record<string, string>;
  autoCreateOnStatuses: string[];
}

// ---------------------------------------------------------------------------
// ticketing_connections
// ---------------------------------------------------------------------------

export const ticketingConnectionsTable = pgTable(
  'ticketing_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull().default('jira'),

    // Encrypted tokens (AES-256-GCM, encrypted at service layer)
    accessToken: jsonb('access_token').$type<EncryptedField>().notNull(),
    refreshToken: jsonb('refresh_token').$type<EncryptedField | null>().default(null),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

    // Jira Cloud site identifier
    cloudId: varchar('cloud_id', { length: 128 }),

    // Connection-specific configuration
    config: jsonb('config')
      .$type<TicketingConnectionConfig>()
      .notNull()
      .default({} as TicketingConnectionConfig),

    // HMAC verification secret for inbound webhooks
    webhookSecret: varchar('webhook_secret', { length: 256 }),

    createdBy: varchar('created_by', { length: 191 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgProviderUidx: uniqueIndex('ticketing_connections_org_provider_uidx').on(
      table.organizationId,
      table.provider,
    ),
    orgIdx: index('ticketing_connections_org_idx').on(table.organizationId),
  }),
);

// ---------------------------------------------------------------------------
// ticket_links
// ---------------------------------------------------------------------------

export const ticketLinksTable = pgTable(
  'ticket_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    findingTriageId: uuid('finding_triage_id')
      .notNull()
      .references(() => findingTriageTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull().default('jira'),
    externalId: varchar('external_id', { length: 128 }).notNull(),
    externalUrl: text('external_url').notNull(),
    syncStatus: varchar('sync_status', { length: 16 }).notNull().default('synced'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    triageProviderUidx: uniqueIndex('ticket_links_triage_provider_uidx').on(
      table.findingTriageId,
      table.provider,
    ),
    orgProviderIdx: index('ticket_links_org_provider_idx').on(table.organizationId, table.provider),
    externalIdIdx: index('ticket_links_external_id_idx').on(table.externalId),
  }),
);

// ---------------------------------------------------------------------------
// Record & Insert type aliases
// ---------------------------------------------------------------------------

export type TicketingConnectionRecord = typeof ticketingConnectionsTable.$inferSelect;
export type TicketingConnectionInsert = typeof ticketingConnectionsTable.$inferInsert;
export type TicketLinkRecord = typeof ticketLinksTable.$inferSelect;
export type TicketLinkInsert = typeof ticketLinksTable.$inferInsert;
