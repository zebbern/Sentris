import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FINDING_TRIAGE_STATUSES } from './triage-update.dto';

export const BulkTriageSchema = z
  .object({
    findingIds: z
      .array(z.string().min(1).max(512))
      .min(1)
      .max(100)
      .refine((findingIds) => new Set(findingIds).size === findingIds.length, {
        message: 'Finding IDs must be unique',
      })
      .meta({ uniqueItems: true }),
    status: z.enum(FINDING_TRIAGE_STATUSES).optional(),
    assigneeUserId: z.string().min(1).max(191).nullable().optional(),
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
