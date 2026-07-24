import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import type { Scope } from '@/types/scopes';
import { useTargetEditorState } from './useTargetEditorState';
import type { TargetEditorMode } from './useTargetEditorState';

export type { TargetEditorMode } from './useTargetEditorState';

interface TargetEditorDialogProps {
  open: boolean;
  mode: TargetEditorMode;
  scope?: Scope | null;
  onClose: () => void;
  onSaved?: (scope: Scope, mode: TargetEditorMode) => void;
}

export function TargetEditorDialog(props: TargetEditorDialogProps) {
  const { open, mode, onClose } = props;

  const { form, formError, submitting, handleFieldChange, handleSubmit } =
    useTargetEditorState(props);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create target' : 'Edit target'}</DialogTitle>
          <DialogDescription>
            Save a scope of domains, repos, and IP ranges to run templates against.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Name</Label>
            <Input
              value={form.name}
              onChange={(event) => handleFieldChange('name', event.target.value)}
              placeholder="Example Corp"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Description</Label>
            <Textarea
              value={form.description}
              onChange={(event) => handleFieldChange('description', event.target.value)}
              rows={3}
              placeholder="Optional context for other operators."
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Domains</Label>
            <Textarea
              value={form.domains}
              onChange={(event) => handleFieldChange('domains', event.target.value)}
              rows={3}
              placeholder="one per line"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Repos</Label>
            <Textarea
              value={form.repos}
              onChange={(event) => handleFieldChange('repos', event.target.value)}
              rows={3}
              placeholder="one per line"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">IP ranges</Label>
            <Textarea
              value={form.ipRanges}
              onChange={(event) => handleFieldChange('ipRanges', event.target.value)}
              rows={3}
              placeholder="one per line"
            />
          </div>

          {formError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </>
            ) : (
              'Save target'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
