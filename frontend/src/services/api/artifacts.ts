import type { ArtifactDestination } from '@shipsec/shared';
import { apiClient, getAuthHeaders, API_BASE_URL, API_V1_URL, type ApiResponse } from './client';

export interface ArtifactListFilters {
  workflowId?: string;
  componentId?: string;
  destination?: ArtifactDestination;
  search?: string;
  limit?: number;
}

export const artifactsApi = {
  list: async (filters?: ArtifactListFilters) => {
    const response = (await apiClient.listArtifacts(filters)) as ApiResponse<{
      artifacts: unknown[];
    }>;
    if (response.error) {
      throw new Error('Failed to fetch artifacts');
    }
    return response.data || { artifacts: [] };
  },

  download: async (id: string): Promise<Blob> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/artifacts/${id}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to download artifact');
    }
    return await response.blob();
  },

  delete: async (id: string): Promise<void> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/artifacts/${id}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to delete artifact');
    }
  },
};
