import type { components } from '@shipsec/backend-client';
import { apiClient, type ApiResponse } from './client';

type SecretSummaryResponse = components['schemas']['SecretSummaryResponse'];
type SecretValueResponse = components['schemas']['SecretValueResponse'];
type CreateSecretDto = components['schemas']['CreateSecretDto'];
type RotateSecretDto = components['schemas']['RotateSecretDto'];
type UpdateSecretDto = components['schemas']['UpdateSecretDto'];

export const secretsApi = {
  list: async (): Promise<SecretSummaryResponse[]> => {
    const response = await apiClient.listSecrets();
    if (response.error) throw new Error('Failed to fetch secrets');
    return response.data || [];
  },

  create: async (input: CreateSecretDto): Promise<SecretSummaryResponse> => {
    const response = (await apiClient.createSecret(input)) as ApiResponse<SecretSummaryResponse>;
    if (response.error) {
      const err = response.error;
      const msg = typeof err === 'object' ? err.message : err;
      throw new Error(typeof msg === 'string' ? msg : 'Failed to create secret');
    }
    if (!response.data) throw new Error('Secret creation failed');
    return response.data;
  },

  update: async (id: string, input: UpdateSecretDto): Promise<SecretSummaryResponse> => {
    const response = await apiClient.updateSecret(id, input);
    if (response.error) throw new Error('Failed to update secret');
    if (!response.data) throw new Error('Secret update failed');
    return response.data;
  },

  rotate: async (id: string, input: RotateSecretDto): Promise<SecretSummaryResponse> => {
    const response = await apiClient.rotateSecret(id, input);
    if (response.error) throw new Error('Failed to rotate secret');
    if (!response.data) throw new Error('Secret rotation failed');
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    const response = await apiClient.deleteSecret(id);
    if (response.error) throw new Error('Failed to delete secret');
  },

  getValue: async (id: string, version?: number): Promise<SecretValueResponse> => {
    const response = await apiClient.getSecretValue(id, version);
    if (response.error) throw new Error('Failed to fetch secret value');
    if (!response.data) throw new Error('Secret value not found');
    return response.data;
  },
};
