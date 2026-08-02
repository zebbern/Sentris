import { describe, expect, it, vi } from 'bun:test';

import {
  createSentrisLanguageModel,
  resolveSentrisProviderBaseUrl,
  type SentrisModelFactories,
} from '../model-factory';

function factories() {
  const chat = vi.fn((modelId: string) => ({ kind: 'chat', modelId }));
  const openAIModel = vi.fn((modelId: string) => ({ kind: 'openai', modelId }));
  const createOpenAI = vi.fn(() => Object.assign(openAIModel, { chat }));
  const googleModel = vi.fn((modelId: string) => ({ kind: 'gemini', modelId }));
  const createGoogleGenerativeAI = vi.fn(() => googleModel);
  const anthropicModel = vi.fn((modelId: string) => ({ kind: 'anthropic', modelId }));
  const createAnthropic = vi.fn(() => anthropicModel);

  return {
    implementations: {
      createOpenAI,
      createGoogleGenerativeAI,
      createAnthropic,
    } as unknown as SentrisModelFactories,
    createOpenAI,
    createGoogleGenerativeAI,
    createAnthropic,
    openAIModel,
    chat,
    googleModel,
    anthropicModel,
  };
}

describe('Sentris model factory', () => {
  it('uses the OpenAI-compatible chat endpoint for OpenRouter', () => {
    const mocks = factories();

    const model = createSentrisLanguageModel(
      {
        provider: 'openrouter',
        modelId: 'openrouter/auto',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      'secret',
      mocks.implementations,
    );

    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'secret',
      baseURL: 'https://openrouter.ai/api/v1',
      name: 'openrouter',
    });
    expect(mocks.chat).toHaveBeenCalledWith('openrouter/auto');
    expect(model).toEqual({ kind: 'chat', modelId: 'openrouter/auto' } as any);
  });

  it('keeps Gemini and Anthropic on their native providers', () => {
    const mocks = factories();

    createSentrisLanguageModel(
      { provider: 'gemini', modelId: 'gemini-test', projectId: 'project-a' },
      'gemini-key',
      mocks.implementations,
    );
    createSentrisLanguageModel(
      { provider: 'anthropic', modelId: 'claude-test', baseUrl: 'https://anthropic.test' },
      'anthropic-key',
      mocks.implementations,
    );

    expect(mocks.createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'gemini-key',
      projectId: 'project-a',
    });
    expect(mocks.googleModel).toHaveBeenCalledWith('gemini-test');
    expect(mocks.createAnthropic).toHaveBeenCalledWith({
      apiKey: 'anthropic-key',
      baseURL: 'https://anthropic.test',
    });
    expect(mocks.anthropicModel).toHaveBeenCalledWith('claude-test');
  });

  it('resolves product defaults without overriding an explicit base URL', () => {
    expect(resolveSentrisProviderBaseUrl('zai-coding-plan', undefined, {})).toBe(
      'https://api.z.ai/api/coding/paas/v4',
    );
    expect(resolveSentrisProviderBaseUrl('openrouter', undefined, {})).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect(
      resolveSentrisProviderBaseUrl('openai', ' https://proxy.example.test/v1 ', {
        OPENAI_BASE_URL: 'https://ignored.example.test',
      }),
    ).toBe('https://proxy.example.test/v1');
  });
});
