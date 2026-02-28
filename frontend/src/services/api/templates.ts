import { getAuthHeaders, API_V1_URL } from './client';

export const templatesApi = {
  list: async (params?: { category?: string; search?: string; tags?: string[] }) => {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set('category', params.category);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.tags) searchParams.set('tags', params.tags.join(','));

    const headers = await getAuthHeaders();
    const response = await fetch(
      `${API_V1_URL}/templates${searchParams.toString() ? `?${searchParams.toString()}` : ''}`,
      { headers },
    );

    if (!response.ok) throw new Error('Failed to fetch templates');
    return response.json();
  },

  get: async (id: string) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/${id}`, { headers });
    if (!response.ok) throw new Error('Failed to fetch template');
    return response.json();
  },

  getCategories: async () => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/categories`, { headers });
    if (!response.ok) throw new Error('Failed to fetch categories');
    return response.json();
  },

  getTags: async () => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/tags`, { headers });
    if (!response.ok) throw new Error('Failed to fetch tags');
    return response.json();
  },

  publish: async (data: {
    workflowId: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
  }) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/publish`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: 'Failed to publish template' }));
      throw new Error(errorData.message || 'Failed to publish template');
    }

    return response.json();
  },

  use: async (
    templateId: string,
    data: { workflowName: string; secretMappings?: Record<string, string> },
  ) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/${templateId}/use`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to use template' }));
      throw new Error(errorData.message || 'Failed to use template');
    }

    return response.json();
  },

  sync: async () => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/sync`, {
      method: 'POST',
      headers,
    });

    if (!response.ok) throw new Error('Failed to sync templates');
    return response.json();
  },

  getMySubmissions: async () => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/my`, { headers });
    if (!response.ok) throw new Error('Failed to fetch submissions');
    return response.json();
  },

  getSubmissions: async () => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/submissions`, { headers });
    if (!response.ok) throw new Error('Failed to fetch submissions');
    return response.json();
  },
};
