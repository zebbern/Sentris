import { useMemo } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { LeanSelect, type SelectOption } from '@/components/inputs/LeanSelect';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { useAnthropicModels } from '@/hooks/queries/useAgentModelQueries';
import {
  AGENT_MODEL_COMPONENT_IDS,
  AGENT_MODEL_OPTIONS_BY_PROVIDER,
  AGENT_MODEL_PROVIDER_OPTIONS,
  CLAUDE_EFFORT_LEVEL_OPTIONS,
  isClaudeEffortLevel,
  type AgentModelProvider,
  type ClaudeEffortLevel,
} from './agentModelOptions';
import {
  buildAgentModelOverride,
  isClaudeAuthMode,
  normalizeAgentModelConfig,
  type AgentModelConfigValue,
  type ClaudeAuthMode,
} from './agentModelUtils';

export interface AgentModelConfigProps {
  componentId: string;
  modelValue: unknown;
  hasConnection: boolean;
  connectedSummary?: string;
  onChange: (value: unknown) => void;
}

const CLAUDE_AUTH_OPTIONS: SelectOption[] = [
  { label: 'API Key (pay-as-you-go)', value: 'api_key' },
  { label: 'Subscription (Pro/Max)', value: 'subscription_oauth' },
];

const EFFORT_OPTIONS: SelectOption[] = CLAUDE_EFFORT_LEVEL_OPTIONS.map((option) => ({
  label: option.label,
  value: option.value,
  description: option.description,
}));

export function supportsInlineAgentModelConfig(componentId: string): boolean {
  return AGENT_MODEL_COMPONENT_IDS.has(componentId);
}

export function AgentModelConfig({
  componentId,
  modelValue,
  hasConnection,
  connectedSummary,
  onChange,
}: AgentModelConfigProps) {
  if (!supportsInlineAgentModelConfig(componentId)) {
    return null;
  }

  const isClaudeCode = componentId === 'core.ai.claude-code';
  const config = normalizeAgentModelConfig(modelValue, componentId);
  const authMode: ClaudeAuthMode = config.authMode ?? 'api_key';
  const effort: ClaudeEffortLevel = config.effort ?? 'default';

  // Live model fetch is only possible with an API key (Anthropic rejects OAuth on /v1/models).
  const liveFetchSecretId =
    isClaudeCode && authMode === 'api_key' ? config.apiKeySecretId : undefined;
  const modelsQuery = useAnthropicModels(liveFetchSecretId);
  const liveModels = modelsQuery.data?.source === 'live' ? modelsQuery.data.models : [];

  const providerOptions: SelectOption[] = (
    isClaudeCode
      ? AGENT_MODEL_PROVIDER_OPTIONS.filter((option) => option.value === 'anthropic')
      : AGENT_MODEL_PROVIDER_OPTIONS
  ).map((option) => ({ label: option.label, value: option.value }));

  const modelOptions: SelectOption[] = useMemo(() => {
    const merged = new Map<string, SelectOption>();
    if (isClaudeCode) {
      for (const model of liveModels) {
        merged.set(model.id, { label: model.label, value: model.id });
      }
    }
    for (const option of AGENT_MODEL_OPTIONS_BY_PROVIDER[config.provider]) {
      if (!merged.has(option.value)) {
        merged.set(option.value, { label: option.label, value: option.value });
      }
    }
    // Always surface the currently selected id even if it is custom / not listed.
    if (config.modelId && !merged.has(config.modelId)) {
      merged.set(config.modelId, { label: config.modelId, value: config.modelId });
    }
    return Array.from(merged.values());
  }, [isClaudeCode, liveModels, config.provider, config.modelId]);

  const selectedModelLabel =
    modelOptions.find((option) => option.value === config.modelId)?.label ?? config.modelId;

  const applyConfig = (next: AgentModelConfigValue) => {
    onChange(buildAgentModelOverride(next, componentId));
  };

  const handleProviderChange = (provider: string | number | undefined) => {
    if (typeof provider !== 'string' || !isAgentModelProviderValue(provider)) return;
    const models = AGENT_MODEL_OPTIONS_BY_PROVIDER[provider];
    applyConfig({
      ...config,
      provider,
      modelId: models[0]?.value ?? config.modelId,
    });
  };

  const handleModelChange = (modelId: string | number | undefined) => {
    if (typeof modelId !== 'string' || modelId.trim().length === 0) return;
    applyConfig({ ...config, modelId });
  };

  const handleCustomModelChange = (modelId: string) => {
    applyConfig({ ...config, modelId });
  };

  const handleEffortChange = (level: string | number | undefined) => {
    if (typeof level !== 'string' || !isClaudeEffortLevel(level)) return;
    applyConfig({ ...config, effort: level });
  };

  const handleAuthModeChange = (mode: string | number | undefined) => {
    if (typeof mode !== 'string' || !isClaudeAuthMode(mode)) return;
    applyConfig({
      ...config,
      authMode: mode,
      apiKeySecretId: undefined,
      apiKey: undefined,
      oauthTokenSecretId: undefined,
    });
  };

  const handleApiKeySecretChange = (secretId: string | undefined) => {
    applyConfig({
      ...config,
      authMode: 'api_key',
      apiKeySecretId: secretId,
      apiKey: undefined,
      oauthTokenSecretId: undefined,
    });
  };

  const handleOAuthTokenSecretChange = (secretId: string | undefined) => {
    applyConfig({
      ...config,
      authMode: 'subscription_oauth',
      oauthTokenSecretId: secretId,
      apiKeySecretId: undefined,
      apiKey: undefined,
    });
  };

  const hasRequiredCredential =
    authMode === 'subscription_oauth'
      ? Boolean(config.oauthTokenSecretId)
      : Boolean(config.apiKeySecretId);

  const liveFetchFailed =
    Boolean(liveFetchSecretId) &&
    (modelsQuery.data?.source === 'error' || modelsQuery.isError);

  return (
    <CollapsibleSection
      title={isClaudeCode ? 'Model & Authentication' : 'Model & API Key'}
      count={1}
      defaultOpen={true}
    >
      <div className="mt-2 space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Pick a model and credential here, or connect an Anthropic/OpenAI Provider node to the
          Model port on the canvas.
        </p>

        {hasConnection ? (
          <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Using provider connected from {connectedSummary || 'another node'}. Disconnect that
              wire to configure inline.
            </span>
          </div>
        ) : (
          <>
            {!isClaudeCode ? (
              <div className="space-y-1.5">
                <Label htmlFor="agent-model-provider" className="text-xs">
                  Provider
                </Label>
                <LeanSelect
                  value={config.provider}
                  options={providerOptions}
                  onChange={handleProviderChange}
                  placeholder="Select provider"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Provider</span>
                <Badge variant="secondary" className="text-[10px]">
                  Anthropic
                </Badge>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="agent-model-id" className="text-xs">
                Model
              </Label>
              <LeanSelect
                value={config.modelId}
                options={modelOptions}
                onChange={handleModelChange}
                placeholder="Select model"
                selectedLabel={selectedModelLabel}
                loading={isClaudeCode && modelsQuery.isFetching}
                onRefresh={
                  liveFetchSecretId ? () => void modelsQuery.refetch() : undefined
                }
              />
              {isClaudeCode ? (
                <>
                  <Input
                    id="agent-model-custom-id"
                    value={config.modelId}
                    onChange={(event) => handleCustomModelChange(event.target.value)}
                    placeholder="Or type an exact model id (e.g. claude-opus-4-8)"
                    className="h-8 text-xs"
                  />
                  {liveModels.length > 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      Showing {liveModels.length} live models from your API key.
                    </p>
                  ) : liveFetchFailed ? (
                    <p className="text-[10px] text-muted-foreground">
                      Live model list unavailable (subscription tokens cannot list models) —
                      showing curated models. Type an exact id above if needed.
                    </p>
                  ) : authMode === 'subscription_oauth' ? (
                    <p className="text-[10px] text-muted-foreground">
                      Subscription mode cannot list models — pick a curated model or type an exact
                      id.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>

            {isClaudeCode ? (
              <div className="space-y-1.5">
                <Label htmlFor="agent-model-effort" className="text-xs">
                  Effort level
                </Label>
                <LeanSelect
                  value={effort}
                  options={EFFORT_OPTIONS}
                  onChange={handleEffortChange}
                  placeholder="Select effort level"
                />
                <p className="text-[10px] text-muted-foreground">
                  Controls how many tokens Claude spends (capability vs speed/cost). Default uses
                  the model default; pick a level to override via{' '}
                  <code className="text-[10px]">CLAUDE_CODE_EFFORT_LEVEL</code>.
                </p>
              </div>
            ) : null}

            {isClaudeCode ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-model-auth-mode" className="text-xs">
                    Authentication
                  </Label>
                  <LeanSelect
                    value={authMode}
                    options={CLAUDE_AUTH_OPTIONS}
                    onChange={handleAuthModeChange}
                    placeholder="Select authentication method"
                  />
                </div>

                {authMode === 'subscription_oauth' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-model-oauth-secret" className="text-xs">
                      Subscription Token Secret
                    </Label>
                    <SecretSelect
                      value={config.oauthTokenSecretId}
                      onChange={handleOAuthTokenSecretChange}
                      placeholder="Select a secret containing your setup token..."
                    />
                    <p className="text-[10px] text-muted-foreground">
                      On a machine where you are logged in to Claude, run{' '}
                      <code className="text-[10px]">claude setup-token</code> and store the output
                      in a secret. See docs for rotation steps.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-model-secret" className="text-xs">
                      API Key Secret
                    </Label>
                    <SecretSelect
                      value={config.apiKeySecretId}
                      onChange={handleApiKeySecretChange}
                      placeholder="Select a secret containing your API key..."
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Create secrets under Manage → Secrets. The secret value is resolved at run
                      time.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="agent-model-secret" className="text-xs">
                  API Key Secret
                </Label>
                <SecretSelect
                  value={config.apiKeySecretId}
                  onChange={handleApiKeySecretChange}
                  placeholder="Select a secret containing your API key..."
                />
                <p className="text-[10px] text-muted-foreground">
                  Create secrets under Manage → Secrets. The secret value is resolved at run time.
                </p>
              </div>
            )}

            {!hasRequiredCredential ? (
              <div className="flex items-center gap-1.5 text-destructive text-[11px]">
                <AlertCircle className="h-3 w-3" />
                <span>
                  {authMode === 'subscription_oauth'
                    ? 'Subscription token secret is required when not using a provider connection'
                    : 'API key secret is required when not using a provider connection'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-primary text-[11px]">
                <CheckCircle2 className="h-3 w-3" />
                <span>Model configuration ready</span>
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}

function isAgentModelProviderValue(value: string): value is AgentModelProvider {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'openrouter' ||
    value === 'zai-coding-plan'
  );
}
