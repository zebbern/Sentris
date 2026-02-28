import { httpGet, httpPut } from './client';

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface AnalyticsSettingsResponse {
  organizationId: string;
  subscriptionTier: SubscriptionTier;
  analyticsRetentionDays: number;
  maxRetentionDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAnalyticsSettingsInput {
  analyticsRetentionDays?: number;
  subscriptionTier?: SubscriptionTier;
}

export const analyticsSettingsApi = {
  get: async (): Promise<AnalyticsSettingsResponse> => {
    return httpGet<AnalyticsSettingsResponse>('/analytics/settings');
  },

  update: async (data: UpdateAnalyticsSettingsInput): Promise<AnalyticsSettingsResponse> => {
    return httpPut<AnalyticsSettingsResponse>('/analytics/settings', data);
  },
};
