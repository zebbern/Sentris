import type { components } from '@shipsec/backend-client';
import { apiClient } from './client';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];
type CreateApiKeyResponseDto = components['schemas']['CreateApiKeyResponseDto'];
type CreateApiKeyDto = components['schemas']['CreateApiKeyDto'];
type UpdateApiKeyDto = components['schemas']['UpdateApiKeyDto'];

export const apiKeysApi = {
  list: async (): Promise<ApiKeyResponseDto[]> => {
    const response = await apiClient.listApiKeys();
    if (response.error) throw new Error('Failed to fetch API keys');
    return response.data || [];
  },

  get: async (id: string): Promise<ApiKeyResponseDto> => {
    const response = await apiClient.getApiKey(id);
    if (response.error) throw new Error('Failed to fetch API key');
    if (!response.data) throw new Error('API key not found');
    return response.data;
  },

  create: async (input: CreateApiKeyDto): Promise<CreateApiKeyResponseDto> => {
    const response = await apiClient.createApiKey(input);
    if (response.error) throw new Error('Failed to create API key');
    if (!response.data) throw new Error('API key creation failed');
    return response.data;
  },

  update: async (id: string, input: UpdateApiKeyDto): Promise<ApiKeyResponseDto> => {
    const response = await apiClient.updateApiKey(id, input);
    if (response.error) throw new Error('Failed to update API key');
    if (!response.data) throw new Error('API key update failed');
    return response.data;
  },

  revoke: async (id: string): Promise<ApiKeyResponseDto> => {
    const response = await apiClient.revokeApiKey(id);
    if (response.error) throw new Error('Failed to revoke API key');
    if (!response.data) throw new Error('API key revocation failed');
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    const response = await apiClient.deleteApiKey(id);
    if (response.error) throw new Error('Failed to delete API key');
  },
};
