import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  ConfigurationError,
  ComponentRetryPolicy,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@sentris/component-sdk';
import { LLMProviderSchema, type LlmProviderConfig } from '@sentris/contracts';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? '';

const inputSchema = inputs({
  apiKey: port(
    z
      .string()
      .min(1, 'API key is required')
      .describe('Resolved Anthropic API key supplied via a Secret Loader node.'),
    {
      label: 'API Key',
      description: 'Connect the Secret Loader output containing the Anthropic API key.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const outputSchema = outputs({
  chatModel: port(LLMProviderSchema(), {
    label: 'LLM Provider Config',
    description:
      'Portable provider payload (provider, model, overrides) for wiring into AI Agent or one-shot nodes.',
  }),
});

const parameterSchema = parameters({
  model: param(
    z
      .string()
      .default(DEFAULT_MODEL)
      .describe('Anthropic Claude model identifier (e.g., claude-sonnet-4-6).'),
    {
      label: 'Model',
      editor: 'select',
      options: [
        { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
        { label: 'Claude Opus 4.8', value: 'claude-opus-4-8' },
        { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
      ],
      description: 'Anthropic Claude model to emit.',
    },
  ),
  apiBaseUrl: param(
    z
      .string()
      .default(DEFAULT_BASE_URL)
      .describe('Optional override for the Anthropic API base URL.'),
    {
      label: 'API Base URL',
      editor: 'text',
      description: 'Override for the Anthropic API base URL (leave blank for default).',
    },
  ),
});

// Retry policy for provider configuration - no retries needed for config validation
const anthropicProviderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1, // Provider config is deterministic, no retry needed
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.provider.anthropic',
  label: 'Anthropic Provider',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: anthropicProviderRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Emits an Anthropic Claude provider configuration for downstream AI components.',
  ui: {
    slug: 'anthropic-provider',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description:
      'Normalize Anthropic credentials and model selection into a reusable provider config.',
    icon: 'Settings',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
  },
  async execute({ inputs, params }, context) {
    const { model, apiBaseUrl } = params;
    const { apiKey } = inputs;

    const effectiveApiKey = apiKey.trim();
    if (!effectiveApiKey) {
      throw new ConfigurationError('Anthropic API key is required but was not provided.', {
        configKey: 'apiKey',
      });
    }

    const trimmedBaseUrl = apiBaseUrl?.trim() ? apiBaseUrl.trim() : process.env.ANTHROPIC_BASE_URL;

    context.logger.info(`[AnthropicProvider] Emitting config for model ${model}`);

    return {
      chatModel: {
        provider: 'anthropic',
        modelId: model,
        apiKey: effectiveApiKey,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
      } satisfies LlmProviderConfig,
    };
  },
});

componentRegistry.register(definition);
