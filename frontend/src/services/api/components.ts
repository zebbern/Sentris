import { apiClient, getAuthHeaders, API_V1_URL } from './client';

export const componentsApi = {
  list: async () => {
    const response = await apiClient.listComponents();
    if (response.error) throw new Error('Failed to fetch components');
    return response.data || [];
  },

  get: async (slug: string) => {
    const response = await apiClient.getComponent(slug);
    if (response.error) throw new Error('Failed to fetch component');
    return response.data;
  },

  resolvePorts: async (id: string, params: Record<string, unknown>) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/components/${id}/resolve-ports`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error('Failed to resolve ports');
    }
    return await response.json();
  },
};
