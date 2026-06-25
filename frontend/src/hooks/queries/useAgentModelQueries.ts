import { skipToken, useQuery } from '@tanstack/react-query';
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export interface AnthropicModelOption {
  id: string;
  label: string;
}

export interface ListAnthropicModelsResponse {
  models: AnthropicModelOption[];
  source: 'live' | 'error';
  error?: string | null;
}

async function fetchAnthropicModels(apiKeySecretId: string): Promise<ListAnthropicModelsResponse> {
  const headers = await getApiAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/ai/anthropic/models`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKeySecretId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `Request failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch Anthropic models accessible to a stored API key secret.
 *
 * Only enabled when an API key secret id is provided (subscription OAuth tokens
 * cannot list models, so callers fall back to the curated list).
 */
export function useAnthropicModels(apiKeySecretId?: string) {
  return useQuery({
    queryKey: apiKeySecretId
      ? queryKeys.ai.anthropicModels(apiKeySecretId)
      : queryKeys.ai.anthropicModels('__none__'),
    queryFn: apiKeySecretId ? () => fetchAnthropicModels(apiKeySecretId) : skipToken,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
