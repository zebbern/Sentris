import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MarkRunStartedRequestSchema = z.object({
  temporalRunId: z.string().trim().min(1).max(255),
});

export class MarkRunStartedRequestDto extends createZodDto(MarkRunStartedRequestSchema) {}
