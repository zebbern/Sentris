import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { FindingFilterSchema } from './findings-query.dto';

export const FindingsExportQuerySchema = FindingFilterSchema.extend({
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['csv', 'json']).default('json'),
  // No implicit result cap. Callers may set an explicit bounded limit; PIT
  // pagination handles complete exports beyond OpenSearch's 10k result window.
  limit: z.coerce.number().int().min(1).max(1_000_000).optional(),
});

export class FindingsExportQueryDto extends createZodDto(FindingsExportQuerySchema) {}
