import { describe, expect, it } from 'bun:test';
import type { InputPort } from '@/schemas/component';
import { manualValueProvidedForInput } from '../useNodeValidation';

const llmInput: InputPort = {
  id: 'chatModel',
  label: 'Chat model',
  editor: 'llm-provider',
  required: true,
  connectionType: { kind: 'contract', name: 'core.ai.llm-provider.v1' },
};

describe('manualValueProvidedForInput', () => {
  it('keeps generic and OpenCode subscription OAuth model values unfilled by default', () => {
    const inputOverrides = {
      chatModel: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        authMode: 'subscription_oauth',
        oauthTokenSecretId: 'oauth-secret-1',
      },
    };

    expect(manualValueProvidedForInput(llmInput, false, inputOverrides)).toBe(false);
  });

  it('accepts a mapped Claude Code OAuth secret only when explicitly supported', () => {
    expect(
      manualValueProvidedForInput(
        llmInput,
        false,
        {
          chatModel: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-6',
            authMode: 'subscription_oauth',
            oauthTokenSecretId: 'oauth-secret-1',
          },
        },
        ['api_key', 'subscription_oauth'],
      ),
    ).toBe(true);
  });

  it('retains API-key model validation by default', () => {
    expect(
      manualValueProvidedForInput(llmInput, false, {
        chatModel: {
          provider: 'openai',
          modelId: 'gpt-5.6-terra',
          apiKeySecretId: 'secret-1',
        },
      }),
    ).toBe(true);
  });
});
