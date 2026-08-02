import {
  LLM_PROVIDER_CATALOG,
  LLM_PROVIDER_IDS,
  getRecommendedLlmModel,
  isLlmModelProvider,
} from '@sentris/shared';
import { KeyRound, SlidersHorizontal } from 'lucide-react';

import { SecretSelect } from '@/components/inputs/SecretSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getDefaultBaseUrl, type OperatorModelDraft } from './operatorModelDraft';

interface OperatorModelFormProps {
  value: OperatorModelDraft;
  onChange: (next: OperatorModelDraft) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function OperatorModelForm({
  value,
  onChange,
  disabled = false,
  compact = false,
}: OperatorModelFormProps) {
  const provider = LLM_PROVIDER_CATALOG[value.provider];

  const handleProviderChange = (next: string) => {
    if (!isLlmModelProvider(next)) return;
    onChange({
      ...value,
      provider: next,
      modelId: getRecommendedLlmModel(next),
      baseUrl: getDefaultBaseUrl(next),
    });
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="operator-provider" className="text-xs text-muted-foreground">
            Provider
          </Label>
          <Select value={value.provider} onValueChange={handleProviderChange} disabled={disabled}>
            <SelectTrigger id="operator-provider" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LLM_PROVIDER_IDS.map((providerId) => (
                <SelectItem key={providerId} value={providerId}>
                  {LLM_PROVIDER_CATALOG[providerId].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="operator-model" className="text-xs text-muted-foreground">
            Model
          </Label>
          <Select
            value={value.modelId}
            onValueChange={(modelId) => onChange({ ...value, modelId })}
            disabled={disabled}
          >
            <SelectTrigger id="operator-model" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {provider.models.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          Stored credential
        </Label>
        <SecretSelect
          value={value.apiKeySecretId}
          onChange={(apiKeySecretId) => onChange({ ...value, apiKeySecretId })}
          placeholder={`Select a ${provider.label} API key`}
          aria-label="Operator API key secret"
          clearable={false}
          disabled={disabled}
        />
      </div>

      <details className="group rounded-md border border-border/70 bg-muted/10 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Advanced provider settings
        </summary>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="operator-base-url" className="text-xs text-muted-foreground">
            Base URL (optional)
          </Label>
          <Input
            id="operator-base-url"
            value={value.baseUrl}
            onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
            placeholder={getDefaultBaseUrl(value.provider) || 'Use the provider default'}
            className="h-9"
            disabled={disabled}
          />
        </div>
      </details>
    </div>
  );
}
