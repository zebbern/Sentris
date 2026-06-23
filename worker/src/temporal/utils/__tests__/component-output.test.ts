import { describe, expect, it } from 'bun:test';
import { componentRegistry } from '@sentris/component-sdk';
import { maskSecretInputs } from '../component-output';
import '../../../components/ai/claude-code-agent';

describe('maskSecretInputs', () => {
  it('masks nested LLM credential fields on model port', () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) {
      throw new Error('claude-code component not registered');
    }

    const masked = maskSecretInputs(component, {
      task: 'Investigate',
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        authMode: 'subscription_oauth',
        oauthToken: 'secret-token',
        oauthTokenSecretId: 'secret-id',
        apiKey: 'sk-ant-should-mask',
      },
    }) as Record<string, unknown>;

    const model = masked.model as Record<string, unknown>;
    expect(model.oauthToken).toBe('***');
    expect(model.oauthTokenSecretId).toBe('***');
    expect(model.apiKey).toBe('***');
    expect(model.provider).toBe('anthropic');
    expect(model.modelId).toBe('claude-sonnet-4-6');
    expect(masked.task).toBe('Investigate');
  });
});
