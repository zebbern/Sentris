import { apiClient } from './client';

export const humanInputsApi = {
  list: async (filters: {
    status?: 'pending' | 'resolved' | 'expired' | 'cancelled';
    type?: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge';
  }) => {
    const response = await apiClient.listHumanInputs({
      status: filters.status,
      inputType: filters.type,
    });
    if (response.error) throw new Error('Failed to fetch human inputs');
    return response.data || [];
  },

  get: async (id: string) => {
    const response = await apiClient.getHumanInput(id);
    if (response.error) throw new Error('Failed to fetch human input');
    if (!response.data) throw new Error('Human input not found');
    return response.data;
  },

  resolve: async (
    id: string,
    payload: {
      status: 'resolved' | 'rejected';
      responseData?: Record<string, unknown>;
      comment?: string;
    },
  ) => {
    const response = await apiClient.resolveHumanInput(id, {
      responseData: {
        ...payload.responseData,
        resolution: payload.status, // Add explicit resolution field
        comment: payload.comment,
      },
    });
    if (response.error) throw new Error('Failed to resolve human input');
    return response.data;
  },
};
