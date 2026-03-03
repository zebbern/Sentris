import {
  index,
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';

export const secrets = pgTable(
  'secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 191 }).notNull().unique(),
    description: text('description'),
    tags: jsonb('tags').$type<string[] | null>().default(null),
    organizationId: varchar('organization_id', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('secrets_organization_id_idx').on(table.organizationId),
  }),
);

export const secretVersions = pgTable(
  'secret_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    secretId: uuid('secret_id')
      .notNull()
      .references(() => secrets.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    encryptionKeyId: varchar('encryption_key_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: varchar('created_by', { length: 191 }),
    organizationId: varchar('organization_id', { length: 191 }),
    isActive: boolean('is_active').notNull().default(false),
  },
  (table) => ({
    secretIdx: index('secret_versions_secret_id_idx').on(table.secretId),
  }),
);

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;

export type SecretVersion = typeof secretVersions.$inferSelect;
export type NewSecretVersion = typeof secretVersions.$inferInsert;
