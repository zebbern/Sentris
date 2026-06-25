import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';

export type AgentSkillFileMap = Record<string, string>;

/**
 * Org-scoped agent skill bundles for OpenCode / Claude Code agents.
 * Each skill is a folder (SKILL.md plus supporting files) stored as a path->content map.
 */
export const agentSkills = pgTable(
  'agent_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    description: text('description'),
    content: text('content').notNull(),
    files: jsonb('files').$type<AgentSkillFileMap>().notNull().default({}),
    tags: text('tags').array().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: varchar('created_by', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('agent_skills_org_idx').on(table.organizationId),
    enabledIdx: index('agent_skills_enabled_idx').on(table.enabled),
    orgSlugUnique: uniqueIndex('agent_skills_org_slug_uidx').on(table.organizationId, table.slug),
  }),
);

export type AgentSkillRecord = typeof agentSkills.$inferSelect;
export type NewAgentSkillRecord = typeof agentSkills.$inferInsert;
