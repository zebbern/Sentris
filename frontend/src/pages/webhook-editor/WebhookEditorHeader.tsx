import { ArrowLeft, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SaveButton } from '@/components/ui/save-button';
import { cn } from '@/lib/utils';
import type { WebhookConfiguration } from '@sentris/shared';
import type { WebhookFormState } from './webhookEditorTypes';

interface WebhookEditorHeaderProps {
  form: WebhookFormState;
  webhook: WebhookConfiguration | null;
  isNew: boolean;
  isSaving: boolean;
  isDirty: boolean;
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
  onNameChange,
  onSave,
  onDelete,
  onBack,
  onCopyPath,
}: WebhookEditorHeaderProps) {
  return (
    <div
      className={cn(
        'h-[56px] md:h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        'flex items-center justify-between px-3 md:px-4 gap-2 md:gap-4 shrink-0 z-10',
      )}
    >
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium hidden sm:inline">Webhooks</span>
        </Button>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Input
              value={form.name}
              onChange={(e) => onNameChange(e.target.value)}
              className="h-7 text-lg font-semibold border-transparent hover:border-input focus:border-input px-1 w-[300px]"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {webhook?.webhookPath ? (
              <div className="flex items-center gap-1.5">
                <code className="bg-muted px-1 rounded">{webhook.webhookPath}</code>
                <Copy
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => onCopyPath(webhook.webhookPath)}
                />
              </div>
            ) : (
              'Unsaved Configuration'
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SaveButton
          onClick={onSave}
          isSaving={isSaving}
          isDirty={isDirty || isNew}
          disabled={!form.workflowId}
          label={isNew ? 'Create' : undefined}
        />
        {!isNew && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete webhook"
            onClick={onDelete}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
