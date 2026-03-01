import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { humanizeApiError } from '@/lib/humanizeApiError';
import type { CreateApiKeyInput } from '@/schemas/apiKey';
import { useCreateApiKey, useApiKeyUiStore } from '@/hooks/queries/useApiKeyQueries';
import { useToast } from '@/components/ui/use-toast';
import { SecretKeyDisplay } from './SecretKeyDisplay';
import { INITIAL_FORM, API_KEY_NAME_MAX_LENGTH } from './types';

export interface CreateApiKeyDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  canManageKeys: boolean;
  onCopy: (text: string) => void;
}

export function CreateApiKeyDialog({
  isOpen,
  onOpenChange,
  canManageKeys,
  onCopy,
}: CreateApiKeyDialogProps) {
  const { toast } = useToast();
  const createApiKeyMutation = useCreateApiKey();
  const lastCreatedKey = useApiKeyUiStore((state) => state.lastCreatedKey);
  const clearLastCreatedKey = useApiKeyUiStore((state) => state.clearLastCreatedKey);

  const [formState, setFormState] = useState<CreateApiKeyInput>(INITIAL_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const isFormValid = useMemo(() => {
    const trimmedName = formState.name.trim();
    return trimmedName.length >= 1 && trimmedName.length <= API_KEY_NAME_MAX_LENGTH;
  }, [formState.name]);

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setFormState(INITIAL_FORM);
      setCreateError(null);
      setNameError(null);
      clearLastCreatedKey();
    }
  };

  const handleInputChange = (field: keyof CreateApiKeyInput, value: string | undefined) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePermissionChange = (
    category: 'workflows' | 'runs' | 'audit',
    action: string,
    checked: boolean,
  ) => {
    setFormState((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [category]: {
          ...(prev.permissions[category] as Record<string, boolean>),
          [action]: checked,
        },
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageKeys) return;

    const trimmedName = formState.name.trim();
    if (!trimmedName) {
      setNameError('API key name is required.');
      return;
    }
    if (trimmedName.length > API_KEY_NAME_MAX_LENGTH) {
      setNameError(`API key name must be ${API_KEY_NAME_MAX_LENGTH} characters or fewer.`);
      return;
    }

    setCreateError(null);
    setNameError(null);
    setIsSubmitting(true);

    try {
      await createApiKeyMutation.mutateAsync({
        ...formState,
        name: trimmedName,
        description: formState.description?.trim() || undefined,
      });
      toast({ title: 'Key created', description: 'API Key created successfully.' });
    } catch (err: unknown) {
      const message = humanizeApiError(err);
      setCreateError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create new API Key</DialogTitle>
          <DialogDescription>
            Create a new API key to access Sentris programmatically.
          </DialogDescription>
        </DialogHeader>

        {lastCreatedKey ? (
          <SecretKeyDisplay
            secretKey={lastCreatedKey}
            onCopy={onCopy}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. CI/CD Runner"
                value={formState.name}
                onChange={(e) => {
                  handleInputChange('name', e.target.value);
                  if (nameError) setNameError(null);
                }}
                maxLength={API_KEY_NAME_MAX_LENGTH}
                required
                aria-required="true"
                aria-invalid={!!nameError}
                aria-describedby={
                  nameError
                    ? 'create-apikey-name-error'
                    : createError
                      ? 'create-api-key-error'
                      : undefined
                }
              />
              {nameError && (
                <p id="create-apikey-name-error" className="text-sm text-destructive" role="alert">
                  {nameError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Input
                id="description"
                placeholder="What is this key used for?"
                value={formState.description || ''}
                onChange={(e) => handleInputChange('description', e.target.value)}
                maxLength={500}
              />
            </div>

            <div className="space-y-3">
              <Label>Permissions</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border p-3 rounded-md">
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground font-semibold">
                    Workflows
                  </Label>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="perm-wf-run"
                      checked={formState.permissions.workflows.run}
                      onCheckedChange={(checked) =>
                        handlePermissionChange('workflows', 'run', checked as boolean)
                      }
                    />
                    <Label htmlFor="perm-wf-run" className="font-normal text-sm">
                      Run Workflows
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="perm-wf-list"
                      checked={formState.permissions.workflows.list}
                      onCheckedChange={(checked) =>
                        handlePermissionChange('workflows', 'list', checked as boolean)
                      }
                    />
                    <Label htmlFor="perm-wf-list" className="font-normal text-sm">
                      List Workflows
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="perm-wf-read"
                      checked={formState.permissions.workflows.read}
                      onCheckedChange={(checked) =>
                        handlePermissionChange('workflows', 'read', checked as boolean)
                      }
                    />
                    <Label htmlFor="perm-wf-read" className="font-normal text-sm">
                      Read Workflows
                    </Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground font-semibold">
                    Runs
                  </Label>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="perm-run-read"
                      checked={formState.permissions.runs.read}
                      onCheckedChange={(checked) =>
                        handlePermissionChange('runs', 'read', checked as boolean)
                      }
                    />
                    <Label htmlFor="perm-run-read" className="font-normal text-sm">
                      Read Runs
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="perm-run-cancel"
                      checked={formState.permissions.runs.cancel}
                      onCheckedChange={(checked) =>
                        handlePermissionChange('runs', 'cancel', checked as boolean)
                      }
                    />
                    <Label htmlFor="perm-run-cancel" className="font-normal text-sm">
                      Cancel Runs
                    </Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground font-semibold">
                    Audit
                  </Label>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="perm-audit-read"
                      checked={formState.permissions.audit.read}
                      onCheckedChange={(checked) =>
                        handlePermissionChange('audit', 'read', checked as boolean)
                      }
                    />
                    <Label htmlFor="perm-audit-read" className="font-normal text-sm">
                      Read Audit Logs
                    </Label>
                  </div>
                </div>
              </div>
            </div>

            {createError && (
              <p id="create-api-key-error" className="text-sm text-destructive" role="alert">
                {createError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!isFormValid || isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Key'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
