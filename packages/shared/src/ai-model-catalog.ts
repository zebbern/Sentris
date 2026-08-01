export const LLM_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'zai-coding-plan',
] as const;

export type LlmModelProvider = (typeof LLM_PROVIDER_IDS)[number];

export interface LlmModelOption {
  readonly label: string;
  readonly value: string;
}

export interface LlmProviderCatalogEntry {
  readonly label: string;
  readonly recommendedModelId: string;
  readonly models: readonly LlmModelOption[];
  readonly defaultBaseUrl?: string;
}

export const LLM_PROVIDER_CATALOG = {
  anthropic: {
    label: 'Anthropic',
    recommendedModelId: 'claude-sonnet-5',
    models: [
      { label: 'Claude Opus 5', value: 'claude-opus-5' },
      { label: 'Claude Sonnet 5', value: 'claude-sonnet-5' },
      { label: 'Claude Fable 5', value: 'claude-fable-5' },
      { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
    ],
  },
  openai: {
    label: 'OpenAI',
    recommendedModelId: 'gpt-5.6-terra',
    models: [
      { label: 'GPT-5.6 Sol', value: 'gpt-5.6-sol' },
      { label: 'GPT-5.6 Terra', value: 'gpt-5.6-terra' },
      { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna' },
    ],
  },
  gemini: {
    label: 'Gemini',
    recommendedModelId: 'gemini-3.6-flash',
    models: [
      { label: 'Gemini 3.6 Flash', value: 'gemini-3.6-flash' },
      { label: 'Gemini 3.5 Flash', value: 'gemini-3.5-flash' },
      { label: 'Gemini 3.5 Flash-Lite', value: 'gemini-3.5-flash-lite' },
      { label: 'Gemini 3.1 Pro (Preview)', value: 'gemini-3.1-pro-preview' },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    recommendedModelId: 'openrouter/auto',
    models: [{ label: 'OpenRouter Auto', value: 'openrouter/auto' }],
  },
  'zai-coding-plan': {
    label: 'Z.AI Coding Plan',
    recommendedModelId: 'glm-5.1',
    defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    models: [
      { label: 'GLM-5.1', value: 'glm-5.1' },
      { label: 'GLM-5', value: 'glm-5' },
      { label: 'GLM-5 Turbo', value: 'glm-5-turbo' },
      { label: 'GLM-4.7', value: 'glm-4.7' },
    ],
  },
} as const satisfies Record<LlmModelProvider, LlmProviderCatalogEntry>;

export function isLlmModelProvider(value: unknown): value is LlmModelProvider {
  return typeof value === 'string' && LLM_PROVIDER_IDS.includes(value as LlmModelProvider);
}

export function getRecommendedLlmModel(provider: LlmModelProvider): string {
  return LLM_PROVIDER_CATALOG[provider].recommendedModelId;
}
