import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FINDING_TRIAGE_STATUSES } from './triage-update.dto';

export const BulkTriageSchema = z
  .object({
    findingIds: z.array(z.string().max(512)).min(1).max(100),
    status: z.enum(FINDING_TRIAGE_STATUSES).optional(),
    assigneeUserId: z.string().max(191).optional(),
    comment: z.string().max(2_000).optional(),
  })
  .refine((data) => data.status !== undefined || data.assigneeUserId !== undefined, {
    message: 'At least one of status or assigneeUserId must be provided',
  });

export class BulkTriageDto extends createZodDto(BulkTriageSchema) {}

export const BulkTriageResultItemSchema = z.object({
  findingId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const BulkTriageResponseSchema = z.object({
  results: z.array(BulkTriageResultItemSchema),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
});

export type BulkTriageResponse = z.infer<typeof BulkTriageResponseSchema>;
