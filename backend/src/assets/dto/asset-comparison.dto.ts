import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AssetResponseSchema } from './assets.dto';

export const AssetRunComparisonQuerySchema = z
  .object({
    baselineRunId: z.string().trim().min(1),
    currentRunId: z.string().trim().min(1),
  })
  .refine((value) => value.baselineRunId !== value.currentRunId, {
    message: 'Choose two different runs to compare',
  });

export class AssetRunComparisonQuery extends createZodDto(AssetRunComparisonQuerySchema) {}

const AssetRunCoverageSchema = z.object({
  completedComponents: z.array(z.string()),
  failedComponents: z.array(z.string()),
});

const AssetRunComparisonItemSchema = z.object({
  assetType: AssetResponseSchema.shape.assetType,
  assetValue: z.string(),
  sourceComponentIds: z.array(z.string()),
  baselineObserved: z.boolean(),
  currentObserved: z.boolean(),
  observationStatus: z.enum(['observed', 'not-observed', 'not-scanned']),
  change: z.enum(['new', 'unchanged', 'missing']),
});

export const AssetRunComparisonResponseSchema = z.object({
  scopeId: z.string().uuid(),
  workflowId: z.string().uuid(),
  baselineRunId: z.string(),
  currentRunId: z.string(),
  baselineCoverage: AssetRunCoverageSchema,
  currentCoverage: AssetRunCoverageSchema,
  summary: z.object({
    observed: z.number().int().nonnegative(),
    notObserved: z.number().int().nonnegative(),
    notScanned: z.number().int().nonnegative(),
  }),
  items: z.array(AssetRunComparisonItemSchema),
});

export class AssetRunComparisonResponse extends createZodDto(AssetRunComparisonResponseSchema) {}
