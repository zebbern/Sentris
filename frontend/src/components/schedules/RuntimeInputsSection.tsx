import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RuntimeInputDefinition } from './scheduleTypes';
import { normalizeRuntimeInputType } from './scheduleTypes';

interface RuntimeInputsSectionProps {
  workflowId: string;
  workflowLoading: boolean;
  runtimeInputs: RuntimeInputDefinition[];
  runtimeValues: Record<string, unknown>;
  runtimeErrors: Record<string, string>;
  uploading: Record<string, boolean>;
  formSeed: number;
  onRuntimeInputChange: (input: RuntimeInputDefinition, value: unknown) => void;
  onFileUpload: (inputId: string, file: File) => void;
}

function RuntimeInputField({
  input,
  currentValue,
  error,
  uploadingState,
  onRuntimeInputChange,
  onFileUpload,
}: {
  input: RuntimeInputDefinition;
  currentValue: unknown;
  error: string | undefined;
  uploadingState: boolean;
  onRuntimeInputChange: (input: RuntimeInputDefinition, value: unknown) => void;
  onFileUpload: (inputId: string, file: File) => void;
}) {
  const type = normalizeRuntimeInputType(input.type);

  switch (type) {
    case 'file':
      return (
        <div className="space-y-2">
          <Label htmlFor={input.id} className="text-sm font-medium">
            {input.label}
            {input.required ? <span className="text-destructive ml-1">*</span> : null}
          </Label>
          <Input
            id={input.id}
            type="file"
            disabled={uploadingState}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onFileUpload(input.id, file);
              }
            }}
          />
          {uploadingState ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading file…
            </p>
          ) : null}
          {currentValue && typeof currentValue === 'string' ? (
            <p className="text-xs text-emerald-600 font-mono break-all">
              Stored file ID: {currentValue}
            </p>
          ) : null}
          {input.description ? (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    case 'json':
      return (
        <div className="space-y-2">
          <Label htmlFor={input.id} className="text-sm font-medium">
            {input.label}
            {input.required ? <span className="text-destructive ml-1">*</span> : null}
          </Label>
          <Textarea
            id={input.id}
            rows={4}
            className={cn('font-mono', error && 'border-destructive')}
            defaultValue={
              typeof currentValue === 'string'
                ? currentValue
                : currentValue != null
                  ? JSON.stringify(currentValue, null, 2)
                  : ''
            }
            onBlur={(event) => onRuntimeInputChange(input, event.target.value)}
          />
          {input.description ? (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    case 'array':
      return (
        <div className="space-y-2">
          <Label htmlFor={input.id} className="text-sm font-medium">
            {input.label}
            {input.required ? <span className="text-destructive ml-1">*</span> : null}
          </Label>
          <Textarea
            id={input.id}
            rows={3}
            className={cn('font-mono', error && 'border-destructive')}
            placeholder='["value-1", "value-2"] or comma-separated text'
            defaultValue={
              typeof currentValue === 'string'
                ? currentValue
                : Array.isArray(currentValue)
                  ? JSON.stringify(currentValue)
                  : ''
            }
            onBlur={(event) => onRuntimeInputChange(input, event.target.value)}
          />
          {input.description ? (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    default:
      return (
        <div className="space-y-2">
          <Label htmlFor={input.id} className="text-sm font-medium">
            {input.label}
            {input.required ? <span className="text-destructive ml-1">*</span> : null}
          </Label>
          <Input
            id={input.id}
            type={type === 'number' ? 'number' : 'text'}
            defaultValue={
              typeof currentValue === 'string' || typeof currentValue === 'number'
                ? String(currentValue)
                : ''
            }
            className={error ? 'border-destructive' : ''}
            placeholder={type === 'number' ? '0' : undefined}
            onBlur={(event) => onRuntimeInputChange(input, event.target.value)}
          />
          {input.description ? (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
  }
}

export function RuntimeInputsSection({
  workflowId,
  workflowLoading,
  runtimeInputs,
  runtimeValues,
  runtimeErrors,
  uploading,
  formSeed,
  onRuntimeInputChange,
  onFileUpload,
}: RuntimeInputsSectionProps) {
  const runtimeContent = (() => {
    if (!workflowId) {
      return (
        <p className="text-sm text-muted-foreground">
          Select a workflow above to load its Entry Point inputs.
        </p>
      );
    }
    if (workflowLoading) {
      return (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Entry Point inputs…
        </p>
      );
    }
    if (runtimeInputs.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          This workflow does not define runtime inputs. Scheduled runs will execute without
          additional payload.
        </p>
      );
    }
    return (
      <div className="grid gap-4">
        {runtimeInputs.map((input) => (
          <div key={`${input.id}-${formSeed}`}>
            <RuntimeInputField
              input={input}
              currentValue={runtimeValues[input.id]}
              error={runtimeErrors[input.id]}
              uploadingState={uploading[input.id] ?? false}
              onRuntimeInputChange={onRuntimeInputChange}
              onFileUpload={onFileUpload}
            />
          </div>
        ))}
      </div>
    );
  })();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Entry Point inputs</h3>
          <p className="text-xs text-muted-foreground">
            Provide the payload this schedule should reuse each time it runs.
          </p>
        </div>
        {runtimeInputs.length > 0 ? (
          <Badge variant="outline">{runtimeInputs.length} inputs</Badge>
        ) : null}
      </div>
      {runtimeContent}
    </section>
  );
}
