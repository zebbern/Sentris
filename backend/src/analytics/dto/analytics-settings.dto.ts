import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { SubscriptionTier } from '../../database/schema/organization-settings';

export type { SubscriptionTier };

export const TIER_LIMITS: Record<SubscriptionTier, { name: string; maxRetentionDays: number }> = {
  free: { name: 'Free', maxRetentionDays: 30 },
  pro: { name: 'Pro', maxRetentionDays: 90 },
  enterprise: { name: 'Enterprise', maxRetentionDays: 365 },
};

export class AnalyticsSettingsResponseDto {
  @ApiProperty({
    description: 'Organization ID',
    example: 'org_abc123',
  })
  organizationId!: string;

  @ApiProperty({
    description: 'Subscription tier',
    enum: ['free', 'pro', 'enterprise'],
    example: 'free',
  })
  subscriptionTier!: SubscriptionTier;

  @ApiProperty({
    description: 'Data retention period in days',
    example: 30,
  })
  analyticsRetentionDays!: number;

  @ApiProperty({
    description: 'Maximum retention days allowed for this tier',
    example: 30,
  })
  maxRetentionDays!: number;

  @ApiProperty({
    description: 'Timestamp when settings were created',
    example: '2026-01-20T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when settings were last updated',
    example: '2026-01-20T00:00:00.000Z',
  })
  updatedAt!: Date;
}

export const UpdateAnalyticsSettingsSchema = z.object({
  analyticsRetentionDays: z.number().int().min(1).max(365).optional(),
  subscriptionTier: z.enum(['free', 'pro', 'enterprise']).optional(),
});

export class UpdateAnalyticsSettingsDto extends createZodDto(UpdateAnalyticsSettingsSchema) {}
