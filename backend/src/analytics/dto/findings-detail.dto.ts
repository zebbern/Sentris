import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FindingItemSchema } from './findings-query.dto';

export const FindingIdParamSchema = z.object({
  id: z.string().min(1, 'Finding ID is required'),
});

export class FindingIdParamDto extends createZodDto(FindingIdParamSchema) {}

export const FindingDetailResponseSchema = FindingItemSchema.extend({
  raw: z.record(z.string(), z.unknown()),
});

export type FindingDetailResponse = z.infer<typeof FindingDetailResponseSchema>;

export class FindingDetailResponseDto extends createZodDto(FindingDetailResponseSchema) {}
