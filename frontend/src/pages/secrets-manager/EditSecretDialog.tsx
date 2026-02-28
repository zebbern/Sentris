import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EditFormState } from './types';
import { SECRET_NAME_MAX_LENGTH } from './types';
import { validateSecretName } from './helpers';

export interface EditSecretDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  editFormState: EditFormState;
  onChange: (
    field: keyof EditFormState,
  ) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  editError: string | null;
  disableEditing: boolean;
  isEditing: boolean;
}

export function EditSecretDialog({
  isOpen,
  onOpenChange,
  editFormState,
  onChange,
  onSubmit,
  editError,
  disableEditing,
  isEditing,
}: EditSecretDialogProps) {
  const isEditValid = useMemo(() => {
    return validateSecretName(editFormState.name) === null;
  }, [editFormState.name]);

  const editNameError = useMemo(() => {
    if (editFormState.name.length === 0) return null;
    return validateSecretName(editFormState.name);
  }, [editFormState.name]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit secret metadata</DialogTitle>
          <DialogDescription>
            Update the name, description, tags, or provide a new value to rotate this secret.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label htmlFor="edit-secret-name" className="text-sm font-medium">
              Secret name
            </label>
            <Input
              id="edit-secret-name"
              value={editFormState.name}
              onChange={onChange('name')}
              disabled={disableEditing}
              maxLength={SECRET_NAME_MAX_LENGTH}
              required
              aria-required="true"
              aria-invalid={editNameError ? true : undefined}
              aria-describedby={
                editNameError ? 'edit-name-error' : editError ? 'edit-secret-error' : undefined
              }
            />
            {editNameError && (
              <p id="edit-name-error" className="text-xs text-destructive" role="alert">
                {editNameError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-secret-description" className="text-sm font-medium">
              Description
              <span className="text-muted-foreground"> (optional)</span>
            </label>
            <Input
              id="edit-secret-description"
              value={editFormState.description}
              onChange={onChange('description')}
              disabled={disableEditing}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-secret-tags" className="text-sm font-medium">
              Tags
              <span className="text-muted-foreground"> (comma separated)</span>
            </label>
            <Input
              id="edit-secret-tags"
              value={editFormState.tags}
              onChange={onChange('tags')}
              disabled={disableEditing}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-secret-value" className="text-sm font-medium">
              New secret value<span className="text-muted-foreground"> (optional)</span>
            </label>
            <Textarea
              id="edit-secret-value"
              value={editFormState.value}
              onChange={onChange('value')}
              disabled={disableEditing}
              rows={4}
              placeholder="Provide only if you want to rotate the secret"
            />
            <p className="text-xs text-muted-foreground">
              The plaintext encrypts immediately. Leave blank to keep the current value.
            </p>
          </div>

          {editError && (
            <p id="edit-secret-error" className="text-sm text-destructive" role="alert">
              {editError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isEditing}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isEditValid || disableEditing}>
              {isEditing ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
