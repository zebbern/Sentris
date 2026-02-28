import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { SubscriptionTier } from '../../database/schema/organization-settings';

export type { SubscriptionTier };

export const TIER_LIMITS: Record<SubscriptionTier, { name: string; maxRetentionDays: number }> = {
  free: { name: 'Free', maxRetentionDays: 30 },
  pro: { name: 'Pro', maxRetentionDays: 90 },
  enterprise: { name: 'Enterprise', maxRetentionDays: 365 },
};

export const AnalyticsSettingsResponseSchema = z.object({
  organizationId: z.string(),
  subscriptionTier: z.enum(['free', 'pro', 'enterprise']),
  analyticsRetentionDays: z.number().int(),
  maxRetentionDays: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export class AnalyticsSettingsResponseDto extends createZodDto(AnalyticsSettingsResponseSchema) {}

export const UpdateAnalyticsSettingsSchema = z.object({
  analyticsRetentionDays: z.number().int().min(1).max(365).optional(),
  subscriptionTier: z.enum(['free', 'pro', 'enterprise']).optional(),
});

export class UpdateAnalyticsSettingsDto extends createZodDto(UpdateAnalyticsSettingsSchema) {}
