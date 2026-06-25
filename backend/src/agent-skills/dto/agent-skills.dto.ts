import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AGENT_SKILL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AGENT_SKILL_CONTENT_MAX_BYTES = 256 * 1024;
export const AGENT_SKILL_FILE_MAX_BYTES = 512 * 1024;
export const AGENT_SKILL_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;

export const AgentSkillSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(AGENT_SKILL_SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens');

export const AgentSkillFileMapSchema = z.record(
  z.string().min(1).max(512),
  z.string().max(AGENT_SKILL_FILE_MAX_BYTES),
);

const skillBundleFields = {
  name: z.string().min(1).max(191).optional(),
  slug: AgentSkillSlugSchema.optional(),
  description: z.string().max(2000).nullable().optional(),
  content: z.string().min(1).max(AGENT_SKILL_CONTENT_MAX_BYTES).optional(),
  files: AgentSkillFileMapSchema.optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  enabled: z.boolean().optional(),
};

export const CreateAgentSkillSchema = z
  .object({
    name: z.string().min(1).max(191),
    slug: AgentSkillSlugSchema,
    description: z.string().max(2000).optional(),
    content: z.string().min(1).max(AGENT_SKILL_CONTENT_MAX_BYTES).optional(),
    files: AgentSkillFileMapSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(20).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.content?.trim()) || Boolean(value.files && Object.keys(value.files).length > 0),
    {
      message: 'Either content or files must be provided',
    },
  );

export class CreateAgentSkillDto extends createZodDto(CreateAgentSkillSchema) {}

export const UpdateAgentSkillSchema = z.object(skillBundleFields);

export class UpdateAgentSkillDto extends createZodDto(UpdateAgentSkillSchema) {}

export const AgentSkillResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  content: z.string(),
  files: AgentSkillFileMapSchema,
  fileCount: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class AgentSkillResponse extends createZodDto(AgentSkillResponseSchema) {}

export const AgentSkillBatchItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  content: z.string(),
  files: AgentSkillFileMapSchema,
});

export class AgentSkillBatchItem extends createZodDto(AgentSkillBatchItemSchema) {}

export const DiscoveredAgentSkillSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sourceRoot: z.string(),
  relativePath: z.string(),
  fileCount: z.number().int().nonnegative(),
  imported: z.boolean(),
  existingSkillId: z.string().uuid().optional(),
});

export class DiscoveredAgentSkillResponse extends createZodDto(DiscoveredAgentSkillSchema) {}

export const ImportDiscoveredAgentSkillsSchema = z.object({
  items: z
    .array(
      z.object({
        slug: z.string().regex(AGENT_SKILL_SLUG_PATTERN),
        sourceRoot: z.string().min(1).max(256),
      }),
    )
    .min(1)
    .max(100),
  overwrite: z.boolean().optional(),
});

export class ImportDiscoveredAgentSkillsDto extends createZodDto(
  ImportDiscoveredAgentSkillsSchema,
) {}

export const ImportAgentSkillsResultSchema = z.object({
  imported: z.array(AgentSkillResponseSchema),
  skipped: z.array(
    z.object({
      slug: z.string(),
      reason: z.string(),
    }),
  ),
});

export class ImportAgentSkillsResultResponse extends createZodDto(ImportAgentSkillsResultSchema) {}
