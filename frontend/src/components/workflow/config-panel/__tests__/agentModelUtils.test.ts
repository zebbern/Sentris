import { describe, expect, it } from 'bun:test';
import {
  buildAgentModelOverride,
  isManualAgentModelValue,
  normalizeAgentModelConfig,
} from '../agentModelUtils';

describe('agentModelUtils', () => {
  it('normalizes partial model config with defaults', () => {
    expect(normalizeAgentModelConfig(undefined, 'core.ai.claude-code')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'api_key',
      effort: 'default',
    });
  });

  it('treats secret-backed model override as manual value', () => {
    expect(
      isManualAgentModelValue({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKeySecretId: 'secret-1',
      }),
    ).toBe(true);
  });

  it('treats subscription oauth secret as manual value', () => {
    expect(
      isManualAgentModelValue({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        authMode: 'subscription_oauth',
        oauthTokenSecretId: 'oauth-secret-1',
      }),
    ).toBe(true);
  });

  it('persists provider and model even without a secret', () => {
    expect(
      buildAgentModelOverride(
        {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
        },
        'core.ai.claude-code',
      ),
    ).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'api_key',
    });
  });

  it('persists api key secret for api_key auth mode', () => {
    expect(
      buildAgentModelOverride(
        {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          authMode: 'api_key',
          apiKeySecretId: 'secret-1',
        },
        'core.ai.claude-code',
      ),
    ).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'api_key',
      apiKeySecretId: 'secret-1',
    });
  });

  it('persists oauth token secret for subscription auth mode', () => {
    expect(
      buildAgentModelOverride(
        {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          authMode: 'subscription_oauth',
          oauthTokenSecretId: 'oauth-secret-1',
        },
        'core.ai.claude-code',
      ),
    ).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'subscription_oauth',
      oauthTokenSecretId: 'oauth-secret-1',
    });
  });

  it('does not persist api key fields when subscription mode is selected', () => {
    expect(
      normalizeAgentModelConfig(
        {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          authMode: 'subscription_oauth',
          apiKeySecretId: 'should-drop',
          oauthTokenSecretId: 'oauth-secret-1',
        },
        'core.ai.claude-code',
      ),
    ).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'subscription_oauth',
      effort: 'default',
      oauthTokenSecretId: 'oauth-secret-1',
    });
  });

  it('accepts a custom model id not in the curated list', () => {
    expect(
      normalizeAgentModelConfig(
        {
          provider: 'anthropic',
          modelId: 'claude-future-9000',
          authMode: 'api_key',
          apiKeySecretId: 'secret-1',
        },
        'core.ai.claude-code',
      ).modelId,
    ).toBe('claude-future-9000');
  });

  it('persists effort for claude-code when not default', () => {
    expect(
      buildAgentModelOverride(
        {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          authMode: 'api_key',
          apiKeySecretId: 'secret-1',
          effort: 'max',
        },
        'core.ai.claude-code',
      ),
    ).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'api_key',
      effort: 'max',
      apiKeySecretId: 'secret-1',
    });
  });

  it('omits effort when set to default', () => {
    const result = buildAgentModelOverride(
      {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        authMode: 'api_key',
        apiKeySecretId: 'secret-1',
        effort: 'default',
      },
      'core.ai.claude-code',
    );
    expect('effort' in result).toBe(false);
  });
});
