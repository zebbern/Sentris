import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export type AgentSkillFileMap = Record<string, string>;

export interface AgentSkillResponse {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  content: string;
  files: AgentSkillFileMap;
  fileCount: number;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredAgentSkill {
  slug: string;
  name: string;
  description: string | null;
  sourceRoot: string;
  relativePath: string;
  fileCount: number;
  imported: boolean;
  existingSkillId?: string;
}

export interface ImportAgentSkillsResult {
  imported: AgentSkillResponse[];
  skipped: Array<{ slug: string; reason: string }>;
}

export interface CreateAgentSkillInput {
  name: string;
  slug: string;
  description?: string;
  content?: string;
  files?: AgentSkillFileMap;
  tags?: string[];
  enabled?: boolean;
}

export interface UpdateAgentSkillInput {
  name?: string;
  slug?: string;
  description?: string | null;
  content?: string;
  files?: AgentSkillFileMap;
  tags?: string[];
  enabled?: boolean;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getApiAuthHeaders();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function useAgentSkills(enabledOnly = false) {
  const query = enabledOnly ? '?enabledOnly=true' : '';
  return useQuery({
    queryKey: queryKeys.agentSkills.all(enabledOnly),
    queryFn: () => apiRequest<AgentSkillResponse[]>(`/api/v1/agent-skills${query}`),
    staleTime: 120_000,
  });
}

export function useDiscoverAgentSkills() {
  return useQuery({
    queryKey: queryKeys.agentSkills.discovered(),
    queryFn: () => apiRequest<DiscoveredAgentSkill[]>('/api/v1/agent-skills/discover'),
    staleTime: 30_000,
  });
}

function invalidateAgentSkillQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all(false) });
  qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all(true) });
  qc.invalidateQueries({ queryKey: queryKeys.agentSkills.discovered() });
}

export function useCreateAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentSkillInput) =>
      apiRequest<AgentSkillResponse>('/api/v1/agent-skills', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAgentSkillQueries(qc);
    },
  });
}

export function useUpdateAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAgentSkillInput }) =>
      apiRequest<AgentSkillResponse>(`/api/v1/agent-skills/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAgentSkillQueries(qc);
    },
  });
}

export function useDeleteAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/api/v1/agent-skills/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      invalidateAgentSkillQueries(qc);
    },
  });
}

export function useImportDiscoveredAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      items: Array<{ slug: string; sourceRoot: string }>;
      overwrite?: boolean;
    }) =>
      apiRequest<ImportAgentSkillsResult>('/api/v1/agent-skills/import-discovered', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAgentSkillQueries(qc);
    },
  });
}

export function useImportAgentSkillZip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, overwrite }: { file: File; overwrite?: boolean }) => {
      const headers = await getApiAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);
      const query = overwrite ? '?overwrite=true' : '';
      const response = await fetch(`${API_BASE_URL}/api/v1/agent-skills/import-zip${query}`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Import failed' }));
        throw new Error(error.message || `Import failed: ${response.status}`);
      }
      return response.json() as Promise<ImportAgentSkillsResult>;
    },
    onSuccess: () => {
      invalidateAgentSkillQueries(qc);
    },
  });
}
