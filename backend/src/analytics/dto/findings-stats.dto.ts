import { createZodDto } from 'nestjs-zod';
import { FindingDataAvailabilitySchema } from '@sentris/shared';
import { z } from 'zod';
import {
  FindingFilterSchema,
  FindingProjectionHealthSchema,
  FindingSchemaCoverageSchema,
} from './findings-query.dto';

export const SeverityCountSchema = z.object({
  severity: z.string(),
  count: z.number().int().nonnegative(),
});

export const FindingsStatsResponseSchema = z.object({
  severityCounts: z.array(SeverityCountSchema),
  total: z.number().int().nonnegative(),
  availability: FindingDataAvailabilitySchema,
  projectionHealth: FindingProjectionHealthSchema.optional(),
  schemaCoverage: FindingSchemaCoverageSchema,
});

export type FindingsStatsResponse = z.infer<typeof FindingsStatsResponseSchema>;

export class FindingsStatsResponseDto extends createZodDto(FindingsStatsResponseSchema) {}

export const FindingsStatsQuerySchema = FindingFilterSchema;

export class FindingsStatsQueryDto extends createZodDto(FindingsStatsQuerySchema) {}
