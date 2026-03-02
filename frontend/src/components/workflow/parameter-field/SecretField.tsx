import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { queryKeys } from '@/lib/queryKeys';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import type { InputMapping } from '@/schemas/node';

interface SecretFieldProps {
  value: string | undefined;
  onChange: (value: unknown) => void;
  connectedInput?: InputMapping;
  isDisabledForConnection: boolean;
}

/**
 * SecretField — Secret reference selector with auto-migration from legacy
 * name-based references to ID-based references.
 */
export function SecretField({
  value,
  onChange,
  connectedInput,
  isDisabledForConnection,
}: SecretFieldProps) {
  const queryClient = useQueryClient();
  const { data: secrets = [], error: secretsQueryError } = useSecrets();
  const secretsError = secretsQueryError?.message ?? null;
  const isReceivingInput = Boolean(connectedInput);

  // Auto-migrate legacy name-based references to ID-based
  useEffect(() => {
    if (isReceivingInput) return;
    if (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      secrets.length > 0 &&
      !secrets.some((secret) => secret.id === value)
    ) {
      const matchingSecret = secrets.find((secret) => secret.name === value);
      if (matchingSecret) {
        onChange(matchingSecret.id);
      }
    }
  }, [secrets, value, onChange, isReceivingInput]);

  const connectionLabel =
    connectedInput?.source && connectedInput?.output
      ? `${connectedInput.source}.${connectedInput.output}`
      : connectedInput?.source;

  return (
    <div className="space-y-3">
      {isReceivingInput && (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Receiving input from upstream node
          {connectionLabel ? ` (${connectionLabel})` : ''}. Disconnect the mapping to edit manually.
        </div>
      )}
      {isDisabledForConnection && (
        <p className="text-xs text-muted-foreground">
          Using a stored GitHub connection, so the OAuth client secret is managed automatically.
        </p>
      )}

      {secretsError && <p className="text-sm text-destructive">{secretsError}</p>}

      <SecretSelect
        aria-label="Select a secret"
        value={typeof value === 'string' ? value : ''}
        onChange={(nextValue) => {
          if (isReceivingInput) return;
          const valueToSet =
            nextValue === undefined || nextValue === '' || nextValue === null
              ? undefined
              : nextValue;
          onChange(valueToSet);
        }}
        disabled={isReceivingInput || isDisabledForConnection}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all() });
        }}
      />

      <p className="text-xs text-muted-foreground opacity-70">
        Secrets are resolved at runtime. Only the secret reference is stored in the workflow.
      </p>
    </div>
  );
}
