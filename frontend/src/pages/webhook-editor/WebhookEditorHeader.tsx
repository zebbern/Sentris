import { CheckCircle2, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SaveButton } from '@/components/ui/save-button';
import { cn } from '@/lib/utils';
import type { WebhookConfiguration } from '@sentris/shared';
import type { WebhookEditorTab, WebhookFormState } from './webhookEditorTypes';

interface WebhookEditorHeaderProps {
  form: WebhookFormState;
  webhook: WebhookConfiguration | null;
  isNew: boolean;
  isSaving: boolean;
  isDirty: boolean;
  activeTab: WebhookEditorTab;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onBack: () => void;
  onCopyPath: (path: string) => void;
}

export function WebhookEditorHeader({
  form,
  webhook,
  isNew,
  isSaving,
  isDirty,
  activeTab,
  onNameChange,
  onSave,
  onDelete,
  onBack,
  onCopyPath,
}: WebhookEditorHeaderProps) {
  const readOnlyTitle = activeTab !== 'editor';
  const webhookPath = webhook?.webhookPath;

  return (
    <div
      className={cn(
        'min-h-[56px] md:min-h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        'flex items-center justify-between px-3 md:px-4 py-2 gap-3 md:gap-4 shrink-0 z-10',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Webhooks
          </button>
          {readOnlyTitle || isNew ? (
            <h1 className="truncate text-base font-semibold md:text-lg">
              {form.name || 'New Webhook'}
            </h1>
          ) : (
            <Input
              value={form.name}
              onChange={(e) => onNameChange(e.target.value)}
              className="h-8 min-w-0 flex-1 max-w-md border-transparent px-1 text-base font-semibold hover:border-input focus:border-input md:text-lg"
              aria-label="Webhook name"
            />
          )}
        </div>
        {webhookPath ? (
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <code className="truncate rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
              {webhookPath}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label="Copy webhook path"
              onClick={() => onCopyPath(webhookPath)}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          !isNew && (
            <p className="mt-1 text-xs text-muted-foreground">Unsaved configuration</p>
          )
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isNew ? (
          <SaveButton
            onClick={onSave}
            isSaving={isSaving}
            isDirty={isDirty || isNew}
            disabled={!form.workflowId}
            label="Create"
          />
        ) : (
          <>
            {isDirty || isSaving ? (
              <SaveButton
                onClick={onSave}
                isSaving={isSaving}
                isDirty={isDirty}
                disabled={!form.workflowId}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-2 border-emerald-200 dark:border-emerald-700"
                aria-label="All changes synced"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Synced
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete webhook"
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
