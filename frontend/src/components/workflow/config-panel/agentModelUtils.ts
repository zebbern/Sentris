import {
  AGENT_MODEL_OPTIONS_BY_PROVIDER,
  DEFAULT_AGENT_MODEL_BY_COMPONENT,
  isClaudeEffortLevel,
  type AgentModelProvider,
  type ClaudeEffortLevel,
} from './agentModelOptions';

export type ClaudeAuthMode = 'api_key' | 'subscription_oauth';

export interface AgentModelConfigValue {
  provider: AgentModelProvider;
  modelId: string;
  authMode?: ClaudeAuthMode;
  apiKeySecretId?: string;
  apiKey?: string;
  oauthTokenSecretId?: string;
  effort?: ClaudeEffortLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isClaudeAuthMode(value: unknown): value is ClaudeAuthMode {
  return value === 'api_key' || value === 'subscription_oauth';
}

export function isAgentModelProvider(value: unknown): value is AgentModelProvider {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'openrouter' ||
    value === 'zai-coding-plan'
  );
}

function normalizeAuthMode(value: unknown, componentId: string): ClaudeAuthMode {
  if (componentId !== 'core.ai.claude-code') {
    return 'api_key';
  }
  return isClaudeAuthMode(value) ? value : 'api_key';
}

export function normalizeAgentModelConfig(
  value: unknown,
  componentId: string,
): AgentModelConfigValue {
  const defaults =
    DEFAULT_AGENT_MODEL_BY_COMPONENT[componentId] ??
    DEFAULT_AGENT_MODEL_BY_COMPONENT['core.ai.opencode'];

  if (!isRecord(value)) {
    return {
      ...defaults,
      ...(componentId === 'core.ai.claude-code'
        ? { authMode: normalizeAuthMode(undefined, componentId), effort: 'default' }
        : {}),
    };
  }

  const provider = isAgentModelProvider(value.provider) ? value.provider : defaults.provider;
  const modelOptions = AGENT_MODEL_OPTIONS_BY_PROVIDER[provider];
  const modelIdFromValue = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  // Accept any non-empty model id (live-fetched or custom), not just curated options.
  const modelId = modelIdFromValue || modelOptions[0]?.value || defaults.modelId;

  const authMode = normalizeAuthMode(value.authMode, componentId);
  const effort: ClaudeEffortLevel =
    componentId === 'core.ai.claude-code' && isClaudeEffortLevel(value.effort)
      ? value.effort
      : 'default';

  const apiKeySecretId =
    typeof value.apiKeySecretId === 'string' && value.apiKeySecretId.trim().length > 0
      ? value.apiKeySecretId.trim()
      : undefined;
  const apiKey =
    typeof value.apiKey === 'string' && value.apiKey.trim().length > 0
      ? value.apiKey.trim()
      : undefined;
  const oauthTokenSecretId =
    typeof value.oauthTokenSecretId === 'string' && value.oauthTokenSecretId.trim().length > 0
      ? value.oauthTokenSecretId.trim()
      : undefined;

  const base: AgentModelConfigValue = {
    provider,
    modelId,
    ...(componentId === 'core.ai.claude-code' ? { authMode, effort } : {}),
  };

  if (authMode === 'subscription_oauth') {
    return {
      ...base,
      ...(oauthTokenSecretId ? { oauthTokenSecretId } : {}),
    };
  }

  return {
    ...base,
    ...(apiKeySecretId ? { apiKeySecretId } : {}),
    ...(apiKey && !apiKeySecretId ? { apiKey } : {}),
  };
}

export function isManualAgentModelValue(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const provider = value.provider;
  const modelId = value.modelId;
  if (!isAgentModelProvider(provider) || typeof modelId !== 'string' || modelId.trim() === '') {
    return false;
  }

  const authMode = isClaudeAuthMode(value.authMode) ? value.authMode : 'api_key';

  if (authMode === 'subscription_oauth') {
    return (
      typeof value.oauthTokenSecretId === 'string' && value.oauthTokenSecretId.trim().length > 0
    );
  }

  const hasSecret =
    typeof value.apiKeySecretId === 'string' && value.apiKeySecretId.trim().length > 0;
  const hasInlineKey = typeof value.apiKey === 'string' && value.apiKey.trim().length > 0;
  return hasSecret || hasInlineKey;
}

export function buildAgentModelOverride(
  config: AgentModelConfigValue,
  componentId: string,
): AgentModelConfigValue {
  const normalized = normalizeAgentModelConfig(config, componentId);
  const authMode = normalized.authMode ?? 'api_key';
  const effortFragment =
    componentId === 'core.ai.claude-code' && normalized.effort && normalized.effort !== 'default'
      ? { effort: normalized.effort }
      : {};

  if (componentId === 'core.ai.claude-code' && authMode === 'subscription_oauth') {
    return {
      provider: normalized.provider,
      modelId: normalized.modelId,
      authMode: 'subscription_oauth',
      ...effortFragment,
      ...(normalized.oauthTokenSecretId
        ? { oauthTokenSecretId: normalized.oauthTokenSecretId }
        : {}),
    };
  }

  if (normalized.apiKeySecretId) {
    return {
      provider: normalized.provider,
      modelId: normalized.modelId,
      ...(componentId === 'core.ai.claude-code' ? { authMode: 'api_key' as const } : {}),
      ...effortFragment,
      apiKeySecretId: normalized.apiKeySecretId,
    };
  }

  if (normalized.apiKey) {
    return {
      provider: normalized.provider,
      modelId: normalized.modelId,
      ...(componentId === 'core.ai.claude-code' ? { authMode: 'api_key' as const } : {}),
      ...effortFragment,
      apiKey: normalized.apiKey,
    };
  }

  return {
    provider: normalized.provider,
    modelId: normalized.modelId,
    ...(componentId === 'core.ai.claude-code' ? { authMode } : {}),
    ...effortFragment,
  };
}
