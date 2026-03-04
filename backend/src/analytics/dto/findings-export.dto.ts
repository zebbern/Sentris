import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FindingsExportQuerySchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  search: z.string().max(200).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['csv', 'json']).default('json'),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  workflowId: z.string().max(200).optional(),
  componentId: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export class FindingsExportQueryDto extends createZodDto(FindingsExportQuerySchema) {}
