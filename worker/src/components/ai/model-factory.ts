import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { LlmProviderConfig } from '@sentris/contracts';
import { LLM_PROVIDER_CATALOG, type LlmModelProvider } from '@sentris/shared';

export interface SentrisLanguageModelConfig {
  provider: LlmModelProvider;
  modelId: string;
  baseUrl?: string | null;
  headers?: Record<string, string>;
  projectId?: string;
  openAICompatibleChat?: boolean;
}

export interface SentrisModelFactories {
  createOpenAI: typeof createOpenAI;
  createGoogleGenerativeAI: typeof createGoogleGenerativeAI;
  createAnthropic: typeof createAnthropic;
}

const DEFAULT_FACTORIES: SentrisModelFactories = {
  createOpenAI,
  createGoogleGenerativeAI,
  createAnthropic,
};

export function resolveSentrisProviderBaseUrl(
  provider: LlmModelProvider,
  explicitBaseUrl?: string | null,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = explicitBaseUrl?.trim();
  if (explicit) return explicit;

  switch (provider) {
    case 'openai':
      return env.OPENAI_BASE_URL?.trim() || undefined;
    case 'anthropic':
      return env.ANTHROPIC_BASE_URL?.trim() || undefined;
    case 'gemini':
      return env.GEMINI_BASE_URL?.trim() || undefined;
    case 'openrouter':
      return env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
    case 'zai-coding-plan':
      return env.ZAI_BASE_URL?.trim() || LLM_PROVIDER_CATALOG['zai-coding-plan'].defaultBaseUrl;
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
    }
  }
}

/** Canonical AI SDK model construction for Sentris API-key providers. */
export function createSentrisLanguageModel(
  config: SentrisLanguageModelConfig | LlmProviderConfig,
  apiKey: string,
  factories: SentrisModelFactories = DEFAULT_FACTORIES,
): LanguageModel {
  if (config.provider === 'gemini') {
    const client = factories.createGoogleGenerativeAI({
      apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...('projectId' in config && config.projectId ? { projectId: config.projectId } : {}),
    });
    return client(config.modelId);
  }

  if (config.provider === 'anthropic') {
    const client = factories.createAnthropic({
      apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    return client(config.modelId);
  }

  const useOpenAICompatibleChat =
    config.provider === 'openrouter' ||
    ('openAICompatibleChat' in config && config.openAICompatibleChat === true);
  const client = factories.createOpenAI({
    apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...('headers' in config && config.headers ? { headers: config.headers } : {}),
    ...(useOpenAICompatibleChat ? { name: 'openrouter' } : {}),
  });

  return useOpenAICompatibleChat ? client.chat(config.modelId) : client(config.modelId);
}
