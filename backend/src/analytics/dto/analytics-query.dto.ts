import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AnalyticsQueryRequestSchema = z.object({
  query: z.record(z.string(), z.unknown()).optional(),
  size: z.number().int().nonnegative().max(1000).optional(),
  from: z.number().int().nonnegative().max(10000).optional(),
  aggs: z.record(z.string(), z.unknown()).optional(),
});

export class AnalyticsQueryRequestDto extends createZodDto(AnalyticsQueryRequestSchema) {}

export class AnalyticsQueryResponseDto {
  @ApiProperty({
    description: 'Total number of matching documents',
    example: 100,
  })
  total!: number;

  @ApiProperty({
    description: 'Search hits',
    type: 'array',
    items: { type: 'object' },
  })
  hits!: {
    _id: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch hit source is untyped
    _source: Record<string, any>;
    _score?: number;
  }[];

  @ApiProperty({
    description: 'Aggregation results',
    required: false,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch aggregation result is untyped
  aggregations?: Record<string, any>;
}
