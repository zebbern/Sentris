import {
  LLM_PROVIDER_CATALOG,
  getRecommendedLlmModel,
  type LlmModelProvider,
  type LlmProviderCatalogEntry,
  type OperatorModelConfig,
} from '@sentris/shared';

export interface OperatorModelDraft {
  provider: LlmModelProvider;
  modelId: string;
  apiKeySecretId?: string;
  baseUrl: string;
}

export function getDefaultBaseUrl(provider: LlmModelProvider): string {
  const entry: LlmProviderCatalogEntry = LLM_PROVIDER_CATALOG[provider];
  return entry.defaultBaseUrl ?? '';
}

export function createDefaultOperatorModelDraft(): OperatorModelDraft {
  const provider: LlmModelProvider = 'gemini';
  return {
    provider,
    modelId: getRecommendedLlmModel(provider),
    apiKeySecretId: undefined,
    baseUrl: getDefaultBaseUrl(provider),
  };
}

export function modelConfigToDraft(model: OperatorModelConfig): OperatorModelDraft {
  return {
    provider: model.provider,
    modelId: model.modelId,
    apiKeySecretId: model.apiKeySecretId,
    baseUrl: model.baseUrl ?? '',
  };
}

export function draftToModelConfig(draft: OperatorModelDraft): OperatorModelConfig | null {
  if (!draft.apiKeySecretId) return null;
  return {
    provider: draft.provider,
    modelId: draft.modelId.trim(),
    apiKeySecretId: draft.apiKeySecretId,
    baseUrl: draft.baseUrl.trim() || null,
  };
}
