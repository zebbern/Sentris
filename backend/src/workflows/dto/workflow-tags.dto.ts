import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// --- Request schemas ---

export const SetWorkflowTagsSchema = z.object({
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(100)
        .transform((s) => s.trim().toLowerCase()),
    )
    .max(50)
    .transform((tags) => [...new Set(tags)]),
});

export class SetWorkflowTagsDto extends createZodDto(SetWorkflowTagsSchema) {}

// --- Response schemas ---

export const WorkflowTagsResponseSchema = z.object({
  tags: z.array(z.string()),
});

export class WorkflowTagsResponseDto extends createZodDto(WorkflowTagsResponseSchema) {}

export const TagWithCountSchema = z.object({
  name: z.string(),
  count: z.number().int(),
});

export const AllTagsResponseSchema = z.object({
  tags: z.array(TagWithCountSchema),
});

export class AllTagsResponseDto extends createZodDto(AllTagsResponseSchema) {}
