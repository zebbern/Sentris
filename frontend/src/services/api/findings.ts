import { httpGet, httpPatch, httpPost, getAuthHeaders, API_V1_URL } from './client';
import type {
  FindingTriageResponse,
  FindingTriageEventResponse,
  BulkTriageResult,
  UpdateFindingTriage,
  BulkTriage,
} from '@sentris/shared';

export type { FindingTriageResponse, FindingTriageEventResponse, BulkTriageResult };

export interface FindingTriage {
  status: string;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  updatedAt: string;
  projectionVersion?: number;
}

export interface FindingItem {
  id: string;
  timestamp: string;
  severity?: string;
  name?: string;
  asset_key?: string;
  workflow_name?: string;
  workflow_id?: string;
  run_id?: string;
  scope_id?: string;
  component_id?: string;
  node_ref?: string;
  raw?: Record<string, unknown>;
  triage?: FindingTriage | null;
  schemaCompatibility?: 'canonical' | 'legacy' | 'invalid';
}

/** Full detail response — same as FindingItem but `raw` is always present. */
export interface FindingDetailResponse extends FindingItem {
  raw: Record<string, unknown>;
  availability: 'available' | 'degraded';
}

export interface FindingsResponse {
  items: FindingItem[];
  total: number;
  page: number;
  pageSize: number;
  availability: 'available' | 'degraded';
  paginationMode: 'offset' | 'cursor';
  currentCursor: string | null;
  nextCursor: string | null;
  projectionHealth?: FindingProjectionHealth;
  schemaCoverage: FindingSchemaCoverage;
  degradedReasons?: string[];
}

export interface FindingProjectionHealth {
  availability: 'available' | 'degraded';
  completedAt: string | null;
  reconciledThrough: string | null;
  reason: string | null;
}

export interface FindingSchemaCoverage {
  canonical: number;
  legacy: number;
  invalid: number;
}

export interface FindingsQueryParams {
  page?: number;
  pageSize?: number;
  paginationMode?: 'offset' | 'cursor';
  cursor?: string;
  severity?: string;
  search?: string;
  sortOrder?: 'asc' | 'desc';
  workflowId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
  triageStatus?: string;
  assigneeUserId?: string;
  scopeId?: string;
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
  scopeId?: string;
  triageStatus?: string;
  assigneeUserId?: string;
}

export interface FindingsStatsResponse {
  severityCounts: { severity: string; count: number }[];
  total: number;
  availability: 'available' | 'degraded';
  projectionHealth?: FindingProjectionHealth;
  schemaCoverage: FindingSchemaCoverage;
}

export interface FindingsExportResult {
  blob: Blob;
  availability: 'available' | 'degraded' | 'unknown';
  degradedReasons: string[];
  projectionHealthReason: string | null;
  projectionReconciledThrough: string | null;
  schemaCoverage: FindingSchemaCoverage | null;
  headers: Headers;
}

export interface FindingsStatsParams {
  severity?: string;
  search?: string;
  workflowId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
  scopeId?: string;
  triageStatus?: string;
  assigneeUserId?: string;
}

export const findingsApi = {
  list: async (params: FindingsQueryParams = {}): Promise<FindingsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.paginationMode) searchParams.set('paginationMode', params.paginationMode);
    if (params.cursor) searchParams.set('cursor', params.cursor);
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params.componentId) searchParams.set('componentId', params.componentId);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params.triageStatus) searchParams.set('triageStatus', params.triageStatus);
    if (params.assigneeUserId) searchParams.set('assigneeUserId', params.assigneeUserId);
    if (params.scopeId) searchParams.set('scopeId', params.scopeId);

    const qs = searchParams.toString();
    const path = qs ? `/findings?${qs}` : '/findings';
    return httpGet<FindingsResponse>(path);
  },

  get: async (id: string): Promise<FindingDetailResponse> => {
    return httpGet<FindingDetailResponse>(`/findings/${id}`);
  },

  exportFindings: async (params: FindingsExportParams): Promise<FindingsExportResult> => {
    const searchParams = new URLSearchParams();
    searchParams.set('format', params.format);
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params.componentId) searchParams.set('componentId', params.componentId);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params.scopeId) searchParams.set('scopeId', params.scopeId);
    if (params.triageStatus) searchParams.set('triageStatus', params.triageStatus);
    if (params.assigneeUserId) searchParams.set('assigneeUserId', params.assigneeUserId);

    const requestHeaders = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/findings/export?${searchParams.toString()}`, {
      headers: requestHeaders,
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Export failed' }));
      throw new Error(error.message || 'Export failed');
    }
    const responseHeaders = response.headers ?? new Headers();
    const parseCount = (name: string): number | null => {
      const raw = responseHeaders.get(name);
      if (raw === null || !/^\d+$/.test(raw)) return null;
      const value = Number(raw);
      return Number.isSafeInteger(value) ? value : null;
    };
    const canonical = parseCount('X-Sentris-Schema-Canonical');
    const legacy = parseCount('X-Sentris-Schema-Legacy');
    const invalid = parseCount('X-Sentris-Schema-Invalid');
    const availabilityHeader = responseHeaders.get('X-Sentris-Availability');
    const degradedReasons =
      responseHeaders
        .get('X-Sentris-Degraded-Reasons')
        ?.split(',')
        .map((reason) => reason.trim())
        .filter(Boolean) ?? [];

    return {
      blob: await response.blob(),
      availability:
        availabilityHeader === 'available' || availabilityHeader === 'degraded'
          ? availabilityHeader
          : 'unknown',
      degradedReasons,
      projectionHealthReason: responseHeaders.get('X-Sentris-Projection-Health-Reason'),
      projectionReconciledThrough: responseHeaders.get('X-Sentris-Projection-Reconciled-Through'),
      schemaCoverage:
        canonical !== null && legacy !== null && invalid !== null
          ? { canonical, legacy, invalid }
          : null,
      headers: responseHeaders,
    };
  },

  getStats: async (params: FindingsStatsParams = {}): Promise<FindingsStatsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.severity) searchParams.set('severity', params.severity);
    if (params.search) searchParams.set('search', params.search);
    if (params.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params.componentId) searchParams.set('componentId', params.componentId);
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params.scopeId) searchParams.set('scopeId', params.scopeId);
    if (params.triageStatus) searchParams.set('triageStatus', params.triageStatus);
    if (params.assigneeUserId) searchParams.set('assigneeUserId', params.assigneeUserId);

    const qs = searchParams.toString();
    const path = qs ? `/findings/stats?${qs}` : '/findings/stats';
    return httpGet<FindingsStatsResponse>(path);
  },

  updateTriage: async (
    findingId: string,
    data: UpdateFindingTriage,
  ): Promise<FindingTriageResponse> => {
    return httpPatch<FindingTriageResponse>(`/findings/${findingId}/triage`, data);
  },

  bulkTriage: async (data: BulkTriage): Promise<BulkTriageResult> => {
    return httpPost<BulkTriageResult>('/findings/bulk-triage', data);
  },

  getHistory: async (
    findingId: string,
    limit = 50,
  ): Promise<{ events: FindingTriageEventResponse[] }> => {
    const params = new URLSearchParams();
    if (limit !== 50) params.set('limit', String(limit));
    const qs = params.toString();
    const path = qs ? `/findings/${findingId}/history?${qs}` : `/findings/${findingId}/history`;
    return httpGet<{ events: FindingTriageEventResponse[] }>(path);
  },
};
