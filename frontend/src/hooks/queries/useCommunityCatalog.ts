import { useMutation, useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import {
  CommunityCatalogSchema,
  buildCommunityTemplateRawUrl,
  getCommunityTemplatesIndexUrl,
  type CommunityCatalog,
} from '@/schemas/communityCatalog';
import type { Template } from '@/types/templates';

const COMMUNITY_CATALOG_STALE_MS = 60 * 60 * 1000; // 1 hour

export async function fetchCommunityCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<CommunityCatalog> {
  const indexUrl = getCommunityTemplatesIndexUrl();
  const response = await fetchImpl(indexUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to load community catalog (${response.status})`);
  }

  const json: unknown = await response.json();
  const parsed = CommunityCatalogSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Community catalog failed validation');
  }

  return parsed.data;
}

async function fetchCommunityTemplateJson(templatePath: string): Promise<Record<string, unknown>> {
  const rawUrl = buildCommunityTemplateRawUrl(templatePath);
  const response = await fetch(rawUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to load community template (${response.status})`);
  }

  const json: unknown = await response.json();
  if (!json || typeof json !== 'object') {
    throw new Error('Community template has invalid shape');
  }

  return json as Record<string, unknown>;
}

export function useCommunityCatalog(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.templates.communityCatalog(),
    // Wrap so TanStack Query's context is not passed as fetchImpl
    queryFn: () => fetchCommunityCatalog(),
    staleTime: COMMUNITY_CATALOG_STALE_MS,
    gcTime: COMMUNITY_CATALOG_STALE_MS * 2,
    enabled: options?.enabled,
    retry: 1,
  });
}

export function useCommunityTemplateJson(templatePath: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.templates.communityTemplateJson(templatePath ?? '__none__'),
    queryFn: templatePath ? () => fetchCommunityTemplateJson(templatePath) : skipToken,
    staleTime: COMMUNITY_CATALOG_STALE_MS,
  });
}

export function useImportCommunityTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id?: string; templatePath?: string }) =>
      api.templates.importCommunity(payload) as Promise<Template>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates.root() });
      qc.invalidateQueries({ queryKey: queryKeys.templates.categories() });
    },
  });
}

export type { CommunityCatalog, CommunityCatalogEntry } from '@/schemas/communityCatalog';
