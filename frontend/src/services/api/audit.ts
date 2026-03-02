import type { components } from '@sentris/backend-client';
import { getAuthHeaders, API_V1_URL } from './client';

type ListAuditLogsResponseDto = components['schemas']['ListAuditLogsResponseDto'];

export const auditLogsApi = {
  list: async (query: {
    resourceType?: string;
    resourceId?: string;
    action?: string;
    actorId?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ListAuditLogsResponseDto> => {
    const headers = await getAuthHeaders();
    const url = new URL(`${API_V1_URL}/audit-logs`);

    if (query.resourceType) url.searchParams.set('resourceType', query.resourceType);
    if (query.resourceId) url.searchParams.set('resourceId', query.resourceId);
    if (query.action) url.searchParams.set('action', query.action);
    if (query.actorId) url.searchParams.set('actorId', query.actorId);
    if (query.from) url.searchParams.set('from', query.from);
    if (query.to) url.searchParams.set('to', query.to);
    if (query.cursor) url.searchParams.set('cursor', query.cursor);
    if (query.limit) url.searchParams.set('limit', String(query.limit));

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch audit logs: ${res.status} ${text}`);
    }
    return (await res.json()) as ListAuditLogsResponseDto;
  },

  exportCsv: async (query: {
    resourceType?: string;
    action?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }): Promise<Blob> => {
    const headers = await getAuthHeaders();
    const url = new URL(`${API_V1_URL}/audit-logs/export`);

    if (query.resourceType) url.searchParams.set('resourceType', query.resourceType);
    if (query.action) url.searchParams.set('action', query.action);
    if (query.actorId) url.searchParams.set('actorId', query.actorId);
    if (query.from) url.searchParams.set('from', query.from);
    if (query.to) url.searchParams.set('to', query.to);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to export audit logs: ${res.status} ${text}`);
    }
    return res.blob();
  },
};
