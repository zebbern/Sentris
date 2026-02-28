import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PublishTemplateSchema = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  author: z.string(),
});

export class PublishTemplateDto extends createZodDto(PublishTemplateSchema) {}

export const UseTemplateSchema = z.object({
  workflowName: z.string().min(1),
  secretMappings: z.record(z.string(), z.string()).optional(),
});

export class UseTemplateDto extends createZodDto(UseTemplateSchema) {}
