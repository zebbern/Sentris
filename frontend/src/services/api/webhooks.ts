import type { components } from '@sentris/backend-client';
import type {
  WebhookConfiguration,
  WebhookDelivery,
  TestWebhookScriptResponse,
} from '@sentris/shared';
import { apiClient, type ApiResponse } from './client';

export const webhooksApi = {
  list: async (): Promise<WebhookConfiguration[]> => {
    const response = await apiClient.listWebhookConfigurations();
    if (response.error) throw new Error('Failed to fetch webhook configurations');
    return (response.data || []) as WebhookConfiguration[];
  },

  get: async (id: string): Promise<WebhookConfiguration> => {
    const response = (await apiClient.getWebhookConfiguration(
      id,
    )) as ApiResponse<WebhookConfiguration>;
    if (response.error || !response.data) {
      const errorBody = response.error as Record<string, unknown> | undefined;
      const statusCode = errorBody?.statusCode ?? errorBody?.status;
      const message = errorBody?.message;
      if (statusCode === 404 || (typeof message === 'string' && message.includes('not found'))) {
        throw new Error('Webhook not found');
      }
      throw new Error('Failed to fetch webhook configuration');
    }
    return response.data as WebhookConfiguration;
  },

  create: async (payload: Partial<WebhookConfiguration>): Promise<WebhookConfiguration> => {
    const response = await apiClient.createWebhookConfiguration(
      payload as components['schemas']['CreateWebhookRequestDto'],
    );
    if (response.error) throw new Error('Failed to create webhook configuration');
    return response.data as WebhookConfiguration;
  },

  update: async (
    id: string,
    payload: Partial<WebhookConfiguration>,
  ): Promise<WebhookConfiguration> => {
    const response = await apiClient.updateWebhookConfiguration(
      id,
      payload as components['schemas']['UpdateWebhookRequestDto'],
    );
    if (response.error) throw new Error('Failed to update webhook configuration');
    return response.data as WebhookConfiguration;
  },

  delete: async (id: string) => {
    const response = await apiClient.deleteWebhookConfiguration(id);
    if (response.error) throw new Error('Failed to delete webhook configuration');
  },

  testScript: async (payload: {
    script: string;
    payload: Record<string, unknown>;
    headers: Record<string, string>;
  }): Promise<TestWebhookScriptResponse> => {
    const response = await apiClient.testWebhookScript({
      parsingScript: payload.script,
      testPayload: payload.payload,
      testHeaders: payload.headers,
    });
    if (response.error) throw new Error('Failed to test webhook script');
    return response.data as TestWebhookScriptResponse;
  },

  listDeliveries: async (id: string): Promise<WebhookDelivery[]> => {
    const response = await apiClient.listDeliveries(id);
    if (response.error) throw new Error('Failed to fetch webhook deliveries');
    return (response.data || []) as WebhookDelivery[];
  },
};
