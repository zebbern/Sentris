import { createZodDto } from 'nestjs-zod';
import { FindingDataAvailabilitySchema } from '@sentris/shared';
import { z } from 'zod';

export const ScopeFindingsSummarySchema = z.object({
  availability: FindingDataAvailabilitySchema,
  total: z.number(),
  bySeverity: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    info: z.number(),
    none: z.number(),
  }),
});

export type ScopeFindingsSummary = z.infer<typeof ScopeFindingsSummarySchema>;

export class ScopeFindingsSummaryResponse extends createZodDto(ScopeFindingsSummarySchema) {}
