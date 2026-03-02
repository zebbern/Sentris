import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui/use-toast';

// ─── Response Types ──────────────────────────────────────────────────

export interface RegistryCatalogItem {
  name: string;
  displayName: string;
  description: string;
  serverType: 'stdio' | 'http';
  category: string;
  tags: string[];
  iconUrl: string | null;
  sourceUrl: string | null;
  isFeatured: boolean;
  hasSecrets: boolean;
  hasOAuth: boolean;
  isImported: boolean;
}

export interface RegistryConfigSecret {
  name: string;
  description: string;
  required: boolean;
  example?: string;
}

export interface RegistryConfigEnv {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface RegistryCatalogDetail extends RegistryCatalogItem {
  dockerImage: string | null;
  remoteConfig: { url: string; transportType: string; headers?: Record<string, string> } | null;
  configRequirements: {
    secrets: RegistryConfigSecret[];
    env: RegistryConfigEnv[];
  };
  oauthProviders: string[];
  runConfig: Record<string, unknown> | null;
}

export interface RegistryCatalogResponse {
  data: RegistryCatalogItem[];
  pagination: { total: number; limit: number; offset: number };
  categories: string[];
}

export interface RegistryImportRequest {
  registryName: string;
  secrets: Record<string, string>;
  envVars: Record<string, string>;
  enabled: boolean;
  groupId?: string;
}

export interface RegistryImportResponse {
  serverId: string;
  serverName: string;
  transportType: 'http' | 'stdio';
  status: 'imported' | 'already_exists';
}

export interface RegistrySyncStatusResponse {
  status: 'idle' | 'syncing' | 'success' | 'failed' | 'partial';
  lastSyncAt: string | null;
  serversAdded: number;
  serversUpdated: number;
  serversRemoved: number;
  totalServers: number;
  durationMs: number | null;
  error: string | null;
}

// ─── API Helper ──────────────────────────────────────────────────────

async function registryRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getApiAuthHeaders();
  const { signal, ...restOptions } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...restOptions,
    signal,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    const err = new Error(error.message || `Request failed: ${response.status}`);
    (err as Error & { status: number }).status = response.status;
    throw err;
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

// ─── Query Hooks ─────────────────────────────────────────────────────

export interface RegistryCatalogFilters {
  search?: string;
  category?: string;
  serverType?: string;
  featured?: boolean;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/** Browse/search the Docker MCP Registry catalog */
export function useRegistryCatalog(filters?: RegistryCatalogFilters) {
  return useQuery({
    queryKey: queryKeys.mcpRegistry.catalog(filters as Record<string, unknown>),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.category) params.set('category', filters.category);
      if (filters?.serverType) params.set('serverType', filters.serverType);
      if (filters?.featured !== undefined) params.set('featured', String(filters.featured));
      if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.offset) params.set('offset', String(filters.offset));
      const qs = params.toString();
      return registryRequest<RegistryCatalogResponse>(
        `/api/v1/mcp-registry/catalog${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 10 * 60 * 1000, // 10 min — reference data that changes only via daily sync
  });
}

/** Get details for a single registry server */
export function useRegistryCatalogDetail(name: string | null) {
  return useQuery({
    queryKey: queryKeys.mcpRegistry.detail(name ?? ''),
    queryFn: name
      ? () => registryRequest<RegistryCatalogDetail>(`/api/v1/mcp-registry/catalog/${name}`)
      : skipToken,
    staleTime: 10 * 60 * 1000,
  });
}

/** Import a registry server into the MCP Library */
export function useImportRegistryServer() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: RegistryImportRequest) =>
      registryRequest<RegistryImportResponse>('/api/v1/mcp-registry/import', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.catalog() });
      toast({
        title: 'Server imported successfully',
        description: 'The server has been added to your MCP Library.',
        variant: 'success',
      });
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) {
        toast({
          title: 'Already imported',
          description: 'This server is already in your library.',
          variant: 'warning',
        });
      } else {
        toast({
          title: 'Import failed',
          description: error.message || 'Could not import the server. Please try again.',
          variant: 'destructive',
        });
      }
    },
  });
}

/** Get the sync status of the registry */
export function useRegistrySyncStatus() {
  return useQuery({
    queryKey: queryKeys.mcpRegistry.syncStatus(),
    queryFn: () => registryRequest<RegistrySyncStatusResponse>('/api/v1/mcp-registry/sync/status'),
    staleTime: 60 * 1000, // 1 min
  });
}

/** Trigger a manual registry sync (admin only) */
export function useTriggerRegistrySync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      registryRequest<{ status: string }>('/api/v1/mcp-registry/sync', {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.syncStatus() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.catalog() });
    },
  });
}
