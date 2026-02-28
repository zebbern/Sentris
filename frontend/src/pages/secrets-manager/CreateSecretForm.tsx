import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from './types';
import { SECRET_NAME_MAX_LENGTH } from './types';
import { validateSecretName } from './helpers';

export interface CreateSecretFormProps {
  formState: FormState;
  onChange: (
    field: keyof FormState,
  ) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  formError: string | null;
  isFormValid: boolean;
  disableCreate: boolean;
  isSubmitting: boolean;
}

export function CreateSecretForm({
  formState,
  onChange,
  onSubmit,
  formError,
  isFormValid,
  disableCreate,
  isSubmitting,
}: CreateSecretFormProps) {
  const createNameError = useMemo(() => {
    if (formState.name.length === 0) return null;
    return validateSecretName(formState.name);
  }, [formState.name]);

  return (
    <div className="border rounded-lg bg-card p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg md:text-xl font-semibold mb-1">Add a new secret</h2>
        <p className="text-xs md:text-sm text-muted-foreground">
          Secret values are encrypted at rest. The plaintext you provide here is only used during
          creation.
        </p>
      </div>

      <form className="space-y-3 md:space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label htmlFor="secret-name" className="text-sm font-medium">
            Secret name
          </label>
          <Input
            id="secret-name"
            placeholder="ex: shodan-api-key"
            value={formState.name}
            onChange={onChange('name')}
            disabled={disableCreate}
            maxLength={SECRET_NAME_MAX_LENGTH}
            required
            aria-required="true"
            aria-invalid={createNameError ? true : undefined}
            aria-describedby={
              createNameError ? 'create-name-error' : formError ? 'create-secret-error' : undefined
            }
          />
          {createNameError && (
            <p id="create-name-error" className="text-sm text-destructive" role="alert">
              {createNameError}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="secret-description" className="text-sm font-medium">
            Description
            <span className="text-muted-foreground"> (optional)</span>
          </label>
          <Input
            id="secret-description"
            placeholder="Describe how this secret is used"
            value={formState.description}
            onChange={onChange('description')}
            disabled={disableCreate}
            maxLength={500}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="secret-tags" className="text-sm font-medium">
            Tags
            <span className="text-muted-foreground"> (comma separated)</span>
          </label>
          <Input
            id="secret-tags"
            placeholder="prod, security, reconnaissance"
            value={formState.tags}
            onChange={onChange('tags')}
            disabled={disableCreate}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="secret-value" className="text-sm font-medium">
            Secret value
          </label>
          <Textarea
            id="secret-value"
            placeholder="Paste the secret value"
            value={formState.value}
            onChange={onChange('value')}
            disabled={disableCreate}
            rows={4}
            required
            aria-required="true"
            aria-describedby={formError ? 'create-secret-error' : undefined}
          />
          <p className="text-xs text-muted-foreground">
            The plaintext is never shown again after creation.
          </p>
        </div>

        {formError && (
          <p id="create-secret-error" className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        )}

        <Button type="submit" disabled={!isFormValid || disableCreate}>
          {isSubmitting ? 'Saving…' : 'Create secret'}
        </Button>
      </form>
    </div>
  );
}
