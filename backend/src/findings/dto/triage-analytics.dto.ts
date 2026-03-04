import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ANALYTICS_PERIODS = ['7d', '30d', '90d'] as const;

export const AnalyticsPeriodQuerySchema = z.object({
  period: z.enum(ANALYTICS_PERIODS),
});

export class AnalyticsPeriodQueryDto extends createZodDto(AnalyticsPeriodQuerySchema) {}

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const TopAssigneesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export class TopAssigneesQueryDto extends createZodDto(TopAssigneesQuerySchema) {}
