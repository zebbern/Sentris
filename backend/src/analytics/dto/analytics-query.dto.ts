import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AnalyticsQueryRequestSchema = z.object({
  query: z.record(z.string(), z.unknown()).optional(),
  size: z.number().int().nonnegative().max(1000).optional(),
  from: z.number().int().nonnegative().max(10000).optional(),
  aggs: z.record(z.string(), z.unknown()).optional(),
});

export class AnalyticsQueryRequestDto extends createZodDto(AnalyticsQueryRequestSchema) {}

export const AnalyticsQueryResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  hits: z.array(
    z.object({
      _id: z.string(),
      _source: z.record(z.string(), z.any()),
      _score: z.number().optional(),
    }),
  ),
  aggregations: z.record(z.string(), z.any()).optional(),
});

export class AnalyticsQueryResponseDto extends createZodDto(AnalyticsQueryResponseSchema) {}
