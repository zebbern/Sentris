import { getAuthHeaders, API_V1_URL } from './client';
import type { TemplateSubmission } from '@/types/templates';

export interface PublishTemplateInput {
  workflowId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
}

export interface PublishTemplateResponse {
  submission: TemplateSubmission;
  validation: {
    valid: boolean;
    errors: string[];
  };
  requiredSecrets: { name: string; type: string; description?: string; placeholder?: string }[];
  removedSecrets: string[];
  manifest: Record<string, unknown>;
  graph: Record<string, unknown>;
}

export interface TemplateRepoInfo {
  owner: string;
  repo: string;
  branch: string;
}

export interface TemplateRevalidationResponse {
  auditId: string;
  templateId: string;
  templateName: string;
  status: 'started';
  command: string;
  outputDir: string;
}

export interface TemplateRevalidationJobStatus extends Omit<
  TemplateRevalidationResponse,
  'status'
> {
  requestedBy: string | null;
  organizationId: string | null;
  status: 'started' | 'completed';
  startedAt: string;
  outputFiles: {
    marker: string;
    stdout: string;
    stderr: string;
    reportJson: string;
    reportMarkdown: string;
  };
  report: {
    generatedAt?: string;
    resultCount: number;
    recommendations: string[];
    terminalStatuses: string[];
  } | null;
}

export type TemplateRevalidationLogStream = 'stdout' | 'stderr';

export interface TemplateRevalidationJobLog {
  auditId: string;
  stream: TemplateRevalidationLogStream;
  content: string;
  bytes: number;
  maxBytes: number;
  truncated: boolean;
}

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

  getRepoInfo: async (): Promise<TemplateRepoInfo> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/repo-info`, { headers });
    if (!response.ok) throw new Error('Failed to fetch template repository info');
    return response.json();
  },

  publish: async (data: PublishTemplateInput): Promise<PublishTemplateResponse> => {
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

  revalidate: async (templateId: string): Promise<TemplateRevalidationResponse> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/${templateId}/revalidate`, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: 'Failed to revalidate template' }));
      throw new Error(errorData.message || 'Failed to revalidate template');
    }

    return response.json();
  },

  getRevalidationJob: async (auditId: string): Promise<TemplateRevalidationJobStatus> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/templates/revalidations/${auditId}`, { headers });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: 'Failed to fetch template revalidation status' }));
      throw new Error(errorData.message || 'Failed to fetch template revalidation status');
    }

    return response.json();
  },

  listRevalidationJobs: async (limit = 5): Promise<TemplateRevalidationJobStatus[]> => {
    const headers = await getAuthHeaders();
    const searchParams = new URLSearchParams({ limit: String(limit) });
    const response = await fetch(
      `${API_V1_URL}/templates/revalidations?${searchParams.toString()}`,
      { headers },
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: 'Failed to fetch template revalidation history' }));
      throw new Error(errorData.message || 'Failed to fetch template revalidation history');
    }

    return response.json();
  },

  getRevalidationJobLog: async (
    auditId: string,
    params: { stream?: TemplateRevalidationLogStream; maxBytes?: number } = {},
  ): Promise<TemplateRevalidationJobLog> => {
    const headers = await getAuthHeaders();
    const searchParams = new URLSearchParams();
    searchParams.set('stream', params.stream ?? 'stderr');
    if (params.maxBytes !== undefined) {
      searchParams.set('maxBytes', String(params.maxBytes));
    }

    const response = await fetch(
      `${API_V1_URL}/templates/revalidations/${auditId}/log?${searchParams.toString()}`,
      { headers },
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: 'Failed to fetch template revalidation log' }));
      throw new Error(errorData.message || 'Failed to fetch template revalidation log');
    }

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
