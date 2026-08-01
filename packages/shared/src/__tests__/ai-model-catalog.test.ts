import { describe, expect, test } from 'bun:test';

import {
  getRecommendedLlmModel,
  isLlmModelProvider,
  LLM_PROVIDER_CATALOG,
  LLM_PROVIDER_IDS,
} from '../ai-model-catalog.js';

const EXPECTED_CATALOG = {
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
} as const;

describe('LLM_PROVIDER_CATALOG', () => {
  test('exposes the current curated provider catalog exactly', () => {
    expect(LLM_PROVIDER_CATALOG).toEqual(EXPECTED_CATALOG);
  });

  test('has a usable recommendation for every provider', () => {
    for (const provider of LLM_PROVIDER_IDS) {
      const entry = LLM_PROVIDER_CATALOG[provider];
      expect(entry.label).not.toBe('');
      expect(entry.models.some((model) => model.value === entry.recommendedModelId)).toBe(true);
      expect(getRecommendedLlmModel(provider)).toBe(entry.recommendedModelId);
      expect(isLlmModelProvider(provider)).toBe(true);
    }
    expect(isLlmModelProvider('unknown')).toBe(false);
  });
});
