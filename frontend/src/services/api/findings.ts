import { httpGet } from './client';

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
}

export const findingsApi = {
  list: async (params: FindingsQueryParams = {}): Promise<FindingsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const qs = searchParams.toString();
    const path = qs ? `/findings?${qs}` : '/findings';
    return httpGet<FindingsResponse>(path);
  },
};
