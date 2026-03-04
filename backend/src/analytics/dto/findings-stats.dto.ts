import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SeverityCountSchema = z.object({
  severity: z.string(),
  count: z.number().int().nonnegative(),
});

export const FindingsStatsResponseSchema = z.object({
  severityCounts: z.array(SeverityCountSchema),
  total: z.number().int().nonnegative(),
});

export type FindingsStatsResponse = z.infer<typeof FindingsStatsResponseSchema>;

export class FindingsStatsResponseDto extends createZodDto(FindingsStatsResponseSchema) {}

export const FindingsStatsQuerySchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  search: z.string().max(200).optional(),
  workflowId: z.string().max(200).optional(),
  componentId: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export class FindingsStatsQueryDto extends createZodDto(FindingsStatsQuerySchema) {}
