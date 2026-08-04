import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AgentFollowUpRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(32_000),
  })
  .strict();

export class AgentFollowUpRequestDto extends createZodDto(AgentFollowUpRequestSchema) {}
