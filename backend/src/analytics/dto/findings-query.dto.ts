import { createZodDto } from 'nestjs-zod';
import {
  FINDING_TRIAGE_STATUSES,
  FindingDataAvailabilitySchema,
  FindingObservationSeveritySchema,
} from '@sentris/shared';
import { z } from 'zod';

const findingTriageStatusSet = new Set<string>(FINDING_TRIAGE_STATUSES);

export const FindingTriageStatusFilterSchema = z
  .string()
  .max(200)
  .superRefine((value, ctx) => {
    const statuses = value.split(',');
    if (
      statuses.some((status) => !findingTriageStatusSet.has(status)) ||
      new Set(statuses).size !== statuses.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Triage statuses must be valid, unique comma-separated values',
      });
    }
  });

export const FindingFilterSchema = z.object({
  severity: FindingObservationSeveritySchema.optional(),
  search: z.string().max(200).optional(),
  workflowId: z.string().max(200).optional(),
  runId: z.string().max(200).optional(),
  scopeId: z.string().max(200).optional(),
  componentId: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  triageStatus: FindingTriageStatusFilterSchema.optional(),
  assigneeUserId: z.string().max(191).optional(),
});

export const FindingsQuerySchema = FindingFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  paginationMode: z.enum(['offset', 'cursor']).default('offset'),
  cursor: z.string().min(1).max(16_384).optional(),
});

export class FindingsQueryDto extends createZodDto(FindingsQuerySchema) {}

export const FindingItemSchema = z.object({
  id: z.string(),
  schemaCompatibility: z.enum(['canonical', 'legacy', 'invalid']).optional(),
  timestamp: z.string(),
  severity: z.string().optional(),
  name: z.string().optional(),
  asset_key: z.string().optional(),
  workflow_name: z.string().optional(),
  workflow_id: z.string().optional(),
  run_id: z.string().optional(),
  scope_id: z.string().optional(),
  component_id: z.string().optional(),
  node_ref: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  triage: z
    .object({
      status: z.string(),
      assigneeUserId: z.string().nullable(),
      severityOverride: z.string().nullable(),
      notes: z.string().nullable(),
      updatedAt: z.string(),
      projectionVersion: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional(),
});

export type FindingItem = z.infer<typeof FindingItemSchema>;

export class FindingItemDto extends createZodDto(FindingItemSchema) {}

export const FindingProjectionHealthSchema = z.object({
  availability: z.enum(['available', 'degraded']),
  completedAt: z.string().datetime().nullable(),
  reconciledThrough: z.string().datetime().nullable(),
  reason: z
    .enum([
      'not_reconciled',
      'reconciliation_in_progress',
      'reconciliation_failed',
      'authoritative_updates_pending',
      'watermark_missing',
      'observation_index_rebuilt',
      'watermark_mismatch',
      'projection_events_pending',
      'health_check_failed',
    ])
    .nullable(),
});

export const FindingSchemaCoverageSchema = z.object({
  canonical: z.number().int().nonnegative(),
  legacy: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
});

export const FindingsResponseSchema = z
  .object({
    items: z.array(FindingItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    availability: FindingDataAvailabilitySchema,
    paginationMode: z.enum(['offset', 'cursor']).default('offset'),
    currentCursor: z.string().nullable().default(null),
    nextCursor: z.string().nullable().default(null),
    projectionHealth: FindingProjectionHealthSchema.optional(),
    schemaCoverage: FindingSchemaCoverageSchema,
    degradedReasons: z.array(z.string().min(1).max(100)).default([]),
  })
  .superRefine((response, ctx) => {
    if (response.paginationMode === 'cursor' && response.currentCursor === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentCursor'],
        message: 'Cursor pagination requires a signed current cursor',
      });
    }
  });

export class FindingsResponseDto extends createZodDto(FindingsResponseSchema) {}
