import { httpGet, getAuthHeaders, API_V1_URL } from './client';

export interface FindingItem {
  id: string;
  timestamp: string;
  severity?: string;
  name?: string;
  asset_key?: string;
  workflow_name?: string;
  workflow_id?: string;
  run_id?: string;
  component_id?: string;
  node_ref?: string;
  raw?: Record<string, unknown>;
}

/** Full detail response — same as FindingItem but `raw` is always present. */
export interface FindingDetailResponse extends FindingItem {
  raw: Record<string, unknown>;
}

export interface FindingsResponse {
  items: FindingItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FindingsQueryParams {
  page?: number;
  pageSize?: number;
  severity?: string;
  search?: string;
  sortOrder?: 'asc' | 'desc';
  workflowId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FindingsExportParams {
  severity?: string;
  search?: string;
  format: 'csv' | 'json';
  limit?: number;
  workflowId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FindingsStatsResponse {
  severityCounts: { severity: string; count: number }[];
  total: number;
}

export interface FindingsStatsParams {
  severity?: string;
  search?: string;
  workflowId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const findingsApi = {
  list: async (params: FindingsQueryParams = {}): Promise<FindingsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params.componentId) searchParams.set('componentId', params.componentId);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);

    const qs = searchParams.toString();
    const path = qs ? `/findings?${qs}` : '/findings';
    return httpGet<FindingsResponse>(path);
  },

  get: async (id: string): Promise<FindingDetailResponse> => {
    return httpGet<FindingDetailResponse>(`/findings/${id}`);
  },

  exportFindings: async (params: FindingsExportParams): Promise<Blob> => {
    const searchParams = new URLSearchParams();
    searchParams.set('format', params.format);
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params.componentId) searchParams.set('componentId', params.componentId);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/findings/export?${searchParams.toString()}`, {
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Export failed' }));
      throw new Error(error.message || 'Export failed');
    }
    return response.blob();
  },

  getStats: async (params: FindingsStatsParams = {}): Promise<FindingsStatsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params.componentId) searchParams.set('componentId', params.componentId);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);

    const qs = searchParams.toString();
    const path = qs ? `/findings/stats?${qs}` : '/findings/stats';
    return httpGet<FindingsStatsResponse>(path);
  },
};
