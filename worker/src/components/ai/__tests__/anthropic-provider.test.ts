import { beforeAll, describe, expect, it } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@sentris/component-sdk';
import type { LlmProviderConfig } from '@sentris/contracts';

interface AnthropicProviderOutput {
  chatModel: LlmProviderConfig;
}

describe('core.provider.anthropic component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  const createContext = () =>
    createExecutionContext({
      runId: 'anthropic-test-run',
      componentRef: 'anthropic-node',
    });

  it('should be registered with correct metadata', () => {
    const component = componentRegistry.get('core.provider.anthropic');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Anthropic Provider');
    expect(component!.category).toBe('ai');
  });

  it('should emit a valid provider config with required inputs', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = await component.execute(
      {
        inputs: { apiKey: 'sk-ant-test-key-123' },
        params: { model: 'claude-sonnet-4-6', apiBaseUrl: '' },
      },
      context,
    );

    expect(result).toEqual({
      chatModel: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test-key-123',
      },
    });
  });

  it('should throw ConfigurationError when API key is empty', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();

    await expect(
      component.execute(
        {
          inputs: { apiKey: '' },
          params: { model: 'claude-sonnet-4-6', apiBaseUrl: '' },
        },
        context,
      ),
    ).rejects.toThrow('Anthropic API key is required but was not provided.');
  });

  it('should throw ConfigurationError when API key is whitespace only', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();

    await expect(
      component.execute(
        {
          inputs: { apiKey: '   ' },
          params: { model: 'claude-sonnet-4-6', apiBaseUrl: '' },
        },
        context,
      ),
    ).rejects.toThrow('Anthropic API key is required but was not provided.');
  });

  it('should use default model when not explicitly provided', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = (await component.execute(
      {
        inputs: { apiKey: 'sk-ant-key' },
        params: { model: 'claude-sonnet-4-6', apiBaseUrl: '' },
      },
      context,
    )) as unknown as AnthropicProviderOutput;

    expect(result.chatModel.modelId).toBe('claude-sonnet-4-6');
  });

  it('should include baseUrl when provided', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = (await component.execute(
      {
        inputs: { apiKey: 'sk-ant-key' },
        params: {
          model: 'claude-sonnet-4-6',
          apiBaseUrl: 'https://custom-api.example.com',
        },
      },
      context,
    )) as unknown as AnthropicProviderOutput;

    expect(result.chatModel).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-key',
      baseUrl: 'https://custom-api.example.com',
    });
  });

  it('should omit baseUrl when it is empty', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = (await component.execute(
      {
        inputs: { apiKey: 'sk-ant-key' },
        params: { model: 'claude-sonnet-4-6', apiBaseUrl: '' },
      },
      context,
    )) as unknown as AnthropicProviderOutput;

    expect(result.chatModel).not.toHaveProperty('baseUrl');
  });

  it('should respect model selection parameter', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = (await component.execute(
      {
        inputs: { apiKey: 'sk-ant-key' },
        params: { model: 'claude-haiku-4-5', apiBaseUrl: '' },
      },
      context,
    )) as unknown as AnthropicProviderOutput;

    expect(result.chatModel.modelId).toBe('claude-haiku-4-5');
    expect(result.chatModel.provider).toBe('anthropic');
  });

  it('should trim whitespace from API key', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = (await component.execute(
      {
        inputs: { apiKey: '  sk-ant-key  ' },
        params: { model: 'claude-sonnet-4-6', apiBaseUrl: '' },
      },
      context,
    )) as unknown as AnthropicProviderOutput;

    expect(result.chatModel.apiKey).toBe('sk-ant-key');
  });

  it('should trim whitespace from baseUrl', async () => {
    const component = componentRegistry.get('core.provider.anthropic');
    if (!component) throw new Error('core.provider.anthropic not registered');

    const context = createContext();
    const result = (await component.execute(
      {
        inputs: { apiKey: 'sk-ant-key' },
        params: {
          model: 'claude-sonnet-4-6',
          apiBaseUrl: '  https://custom.example.com  ',
        },
      },
      context,
    )) as unknown as AnthropicProviderOutput;

    expect(result.chatModel.baseUrl).toBe('https://custom.example.com');
  });
});
