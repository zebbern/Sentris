import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RuntimeInputDefinition } from './scheduleTypes';
import { normalizeRuntimeInputType } from './scheduleTypes';
import { FieldHintLabel } from './FieldHintLabel';

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

function RuntimeInputLabel({ input }: { input: RuntimeInputDefinition }) {
  return (
    <FieldHintLabel htmlFor={input.id} hint={input.description || undefined}>
      {input.label}
      {input.required ? <span className="ml-1 text-destructive">*</span> : null}
    </FieldHintLabel>
  );
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
        <div className="space-y-1.5">
          <RuntimeInputLabel input={input} />
          <Input
            id={input.id}
            type="file"
            className="h-9"
            disabled={uploadingState}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onFileUpload(input.id, file);
              }
            }}
          />
          {uploadingState ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading file…
            </p>
          ) : null}
          {currentValue && typeof currentValue === 'string' ? (
            <p className="break-all font-mono text-xs text-emerald-600">
              Stored file ID: {currentValue}
            </p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    case 'json':
      return (
        <div className="space-y-1.5">
          <RuntimeInputLabel input={input} />
          <Textarea
            id={input.id}
            rows={3}
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
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    case 'array':
      return (
        <div className="space-y-1.5">
          <RuntimeInputLabel input={input} />
          <Textarea
            id={input.id}
            rows={2}
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
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    case 'boolean':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Checkbox
              id={input.id}
              checked={currentValue === true}
              onCheckedChange={(checked) => onRuntimeInputChange(input, checked === true)}
            />
            <RuntimeInputLabel input={input} />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      );
    default:
      return (
        <div className="space-y-1.5">
          <RuntimeInputLabel input={input} />
          <Input
            id={input.id}
            type={type === 'number' ? 'number' : 'text'}
            className={cn('h-9', error && 'border-destructive')}
            defaultValue={
              typeof currentValue === 'string' || typeof currentValue === 'number'
                ? String(currentValue)
                : ''
            }
            placeholder={type === 'number' ? '0' : undefined}
            onBlur={(event) => onRuntimeInputChange(input, event.target.value)}
          />
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
        <p className="text-xs text-muted-foreground">
          Select a workflow to load Entry Point inputs.
        </p>
      );
    }
    if (workflowLoading) {
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading Entry Point inputs…
        </p>
      );
    }
    if (runtimeInputs.length === 0) {
      return (
        <p className="text-xs text-muted-foreground">
          No runtime inputs defined — runs will execute without extra payload.
        </p>
      );
    }
    return (
      <div className="grid gap-3">
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
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldHintLabel
          as="heading"
          hint="Provide the payload this schedule should reuse each time it runs."
        >
          Entry Point inputs
        </FieldHintLabel>
        {runtimeInputs.length > 0 ? (
          <Badge variant="outline" className="text-[11px]">
            {runtimeInputs.length} inputs
          </Badge>
        ) : null}
      </div>
      {runtimeContent}
    </section>
  );
}
