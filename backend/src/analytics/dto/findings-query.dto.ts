import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FindingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  search: z.string().max(200).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  workflowId: z.string().max(200).optional(),
  componentId: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export class FindingsQueryDto extends createZodDto(FindingsQuerySchema) {}

export const FindingItemSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  severity: z.string().optional(),
  name: z.string().optional(),
  asset_key: z.string().optional(),
  workflow_name: z.string().optional(),
  workflow_id: z.string().optional(),
  run_id: z.string().optional(),
  component_id: z.string().optional(),
  node_ref: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export type FindingItem = z.infer<typeof FindingItemSchema>;

export const FindingsResponseSchema = z.object({
  items: z.array(FindingItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

export class FindingsResponseDto extends createZodDto(FindingsResponseSchema) {}
