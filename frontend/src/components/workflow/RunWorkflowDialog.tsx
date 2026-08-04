import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { logger } from '@/lib/logger';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, CheckCircle2, ExternalLink, Play, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useScopes } from '@/hooks/queries/useScopeQueries';
import { ReadinessSummary } from '@/features/agent-readiness/ReadinessSummary';
import type { AgentReadinessRow } from '@/features/agent-readiness/readiness';
import { mergeScopeValues } from './scopeInputMapping';

type RuntimeInputType =
  | 'file'
  | 'text'
  | 'number'
  | 'json'
  | 'array'
  | 'string'
  | 'secret'
  | 'boolean';
type NormalizedRuntimeInputType = Exclude<RuntimeInputType, 'string'>;

const normalizeRuntimeInputType = (type: RuntimeInputType): NormalizedRuntimeInputType =>
  type === 'string' ? 'text' : type;

const hasRuntimeInputValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export interface RuntimeInputDefinition {
  id: string;
  label: string;
  type: RuntimeInputType;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

interface RunWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtimeInputs: RuntimeInputDefinition[];
  onRun: (inputs: Record<string, unknown>, scopeId?: string | null) => void;
  initialValues?: Record<string, unknown>;
  initialScopeId?: string | null;
  readinessRows?: readonly AgentReadinessRow[];
  readinessIssues?: readonly string[];
  readinessPending?: boolean;
  readinessError?: string | null;
  configurationHref?: string;
}

export function RunWorkflowDialog({
  open,
  onOpenChange,
  runtimeInputs,
  onRun,
  initialValues = {},
  initialScopeId = null,
  readinessRows,
  readinessIssues = [],
  readinessPending = false,
  readinessError = null,
  configurationHref,
}: RunWorkflowDialogProps) {
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formSeed, setFormSeed] = useState(0);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const { data: scopes = [], isLoading: isLoadingScopes, error: scopesError } = useScopes();
  const requestedScope = initialScopeId
    ? scopes.find((scope) => scope.id === initialScopeId)
    : undefined;
  const isRequestedScopeUnavailable = Boolean(initialScopeId && !requestedScope);
  const hasReadiness = readinessRows !== undefined;
  const readinessBlocksRun = Boolean(
    readinessPending ||
    readinessError ||
    readinessIssues.length > 0 ||
    readinessRows?.some((row) => row.blocksExecution),
  );

  // Reset inputs when dialog opens
  useEffect(() => {
    if (open) {
      // Unwrap single-element arrays for non-array input types (fixes rerun pre-fill)
      const unwrapped = { ...(initialValues ?? {}) };
      for (const input of runtimeInputs) {
        const value = unwrapped[input.id];
        if (
          input.type !== 'array' &&
          input.type !== 'json' &&
          Array.isArray(value) &&
          value.length === 1
        ) {
          unwrapped[input.id] = value[0];
        }
      }
      setInputs(
        requestedScope ? mergeScopeValues(unwrapped, requestedScope, runtimeInputs) : unwrapped,
      );
      setUploading({});
      setErrors({});
      setFormSeed((seed) => seed + 1);
      setSelectedScopeId(initialScopeId ?? null);
    }
  }, [initialScopeId, initialValues, open, requestedScope, runtimeInputs]);

  const handleFileUpload = async (inputId: string, file: File) => {
    setUploading((prev) => ({ ...prev, [inputId]: true }));
    setErrors((prev) => ({ ...prev, [inputId]: '' }));

    try {
      const formData = new FormData();
      formData.append('file', file);

      const fileData = await api.files.upload(file);
      setInputs((prev) => ({ ...prev, [inputId]: fileData.id }));
    } catch (error: unknown) {
      logger.error('File upload failed:', error);
      setErrors((prev) => ({
        ...prev,
        [inputId]: error instanceof Error ? error.message : 'Upload failed',
      }));
    } finally {
      setUploading((prev) => ({ ...prev, [inputId]: false }));
    }
  };

  const handleInputChange = (inputId: string, value: unknown, type: RuntimeInputType) => {
    setErrors((prev) => ({ ...prev, [inputId]: '' }));
    const normalizedType = normalizeRuntimeInputType(type);

    // Parse based on type
    let parsedValue = value;
    if (normalizedType === 'number') {
      parsedValue = value ? parseFloat(value as string) : undefined;
    } else if (normalizedType === 'boolean') {
      parsedValue = value === true;
    } else if (normalizedType === 'array') {
      const textValue = typeof value === 'string' ? value : '';
      const trimmedValue = textValue.trim();

      if (trimmedValue === '') {
        parsedValue = undefined;
      } else {
        try {
          const parsed = JSON.parse(trimmedValue);
          if (Array.isArray(parsed)) {
            parsedValue = parsed;
          } else {
            throw new Error('Value is not an array');
          }
        } catch {
          const fallback = textValue
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

          if (fallback.length === 0) {
            setErrors((prev) => ({
              ...prev,
              [inputId]: 'Enter comma-separated values or a JSON array',
            }));
            return;
          }

          parsedValue = fallback;
        }
      }
    } else if (normalizedType === 'json') {
      try {
        parsedValue = value ? JSON.parse(value as string) : undefined;
      } catch (_error: unknown) {
        setErrors((prev) => ({
          ...prev,
          [inputId]: 'Invalid JSON format',
        }));
        return;
      }
    }

    setInputs((prev) => ({ ...prev, [inputId]: parsedValue }));
  };

  const handlePrefillFromScope = (value: string) => {
    const scope = scopes.find((s) => s.id === value);
    if (!scope) return;
    setInputs(mergeScopeValues(inputs, scope, runtimeInputs));
    setFormSeed((seed) => seed + 1);
    setSelectedScopeId(scope.id);
  };

  const handleRun = () => {
    if (isRequestedScopeUnavailable) {
      return;
    }

    // Validate required inputs
    const newErrors: Record<string, string> = {};
    for (const input of runtimeInputs) {
      if (input.required && !hasRuntimeInputValue(inputs[input.id])) {
        newErrors[input.id] = 'This field is required';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onRun(inputs, selectedScopeId);
    onOpenChange(false);
  };

  const renderInput = (input: RuntimeInputDefinition) => {
    const hasError = !!errors[input.id];
    const isUploading = uploading[input.id];
    const inputType = normalizeRuntimeInputType(input.type);

    switch (inputType) {
      case 'file':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id}>
              {input.label}
              {input.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                id={input.id}
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileUpload(input.id, file);
                  }
                }}
                disabled={isUploading}
                className={hasError ? 'border-destructive' : ''}
              />
              {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {inputs[input.id] != null && (
              <p className="text-xs text-green-600 dark:text-green-400">
                ✓ File uploaded:{' '}
                {
                  (typeof inputs[input.id] === 'string'
                    ? inputs[input.id]
                    : String(inputs[input.id])) as React.ReactNode
                }
              </p>
            )}
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );

      case 'json':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id}>
              {input.label}
              {input.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Textarea
              id={input.id}
              placeholder='{"key": "value"}'
              onChange={(e) => handleInputChange(input.id, e.target.value, inputType)}
              className={cn('max-h-[120px] overflow-y-auto', hasError && 'border-destructive')}
              rows={2}
              defaultValue={
                typeof inputs[input.id] === 'string'
                  ? (inputs[input.id] as string)
                  : inputs[input.id] != null
                    ? JSON.stringify(inputs[input.id], null, 2)
                    : ''
              }
            />
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );

      case 'array':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id}>
              {input.label}
              {input.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Textarea
              id={input.id}
              placeholder='value1, value2 or ["value1", "value2"]'
              onChange={(e) => handleInputChange(input.id, e.target.value, input.type)}
              className={cn(
                'font-mono max-h-[120px] overflow-y-auto',
                hasError && 'border-destructive',
              )}
              rows={2}
              defaultValue={
                typeof inputs[input.id] === 'string'
                  ? (inputs[input.id] as string)
                  : Array.isArray(inputs[input.id])
                    ? JSON.stringify(inputs[input.id])
                    : ''
              }
            />
            <p className="text-xs text-muted-foreground">
              Enter comma-separated values or provide a JSON array to pass structured data.
            </p>
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );

      case 'number':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id}>
              {input.label}
              {input.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={input.id}
              type="number"
              placeholder="Enter a number"
              onChange={(e) => handleInputChange(input.id, e.target.value, inputType)}
              className={hasError ? 'border-destructive' : ''}
              defaultValue={
                typeof inputs[input.id] === 'number' || typeof inputs[input.id] === 'string'
                  ? (inputs[input.id] as string | number)
                  : ''
              }
            />
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );

      case 'boolean':
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id={input.id}
                checked={inputs[input.id] === true}
                onCheckedChange={(checked) =>
                  handleInputChange(input.id, checked === true, inputType)
                }
              />
              <Label htmlFor={input.id}>
                {input.label}
                {input.required && <span className="text-destructive ml-1">*</span>}
              </Label>
            </div>
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );

      case 'secret':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id}>
              {input.label}
              {input.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={input.id}
              type="password"
              placeholder="Enter secret value"
              onChange={(e) => handleInputChange(input.id, e.target.value, inputType)}
              className={hasError ? 'border-destructive' : ''}
              defaultValue={
                inputs[input.id] !== undefined && inputs[input.id] !== null
                  ? String(inputs[input.id])
                  : ''
              }
            />
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );

      case 'text':
      default:
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id}>
              {input.label}
              {input.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Textarea
              id={input.id}
              placeholder="Enter text"
              onChange={(e) => handleInputChange(input.id, e.target.value, inputType)}
              className={cn(
                'font-mono max-h-[120px] overflow-y-auto',
                hasError && 'border-destructive',
              )}
              rows={2}
              defaultValue={
                inputs[input.id] !== undefined && inputs[input.id] !== null
                  ? String(inputs[input.id])
                  : ''
              }
            />
            {input.description && (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            )}
            {hasError && <p className="text-xs text-destructive">{errors[input.id]}</p>}
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run Workflow</DialogTitle>
          <DialogDescription>
            {runtimeInputs.length > 0
              ? 'Provide the required inputs to start the workflow.'
              : 'Click Run to start the workflow execution.'}
          </DialogDescription>
        </DialogHeader>

        {hasReadiness ? (
          <section aria-label="Run readiness" className="space-y-2">
            <p className="text-xs font-medium text-foreground">Run readiness</p>
            {readinessPending ? (
              <p className="flex items-center gap-2 rounded-md border p-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking the saved version and its dependencies…
              </p>
            ) : null}
            {readinessError ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {readinessError}
              </p>
            ) : null}
            {!readinessPending && !readinessError && readinessRows.length > 0 ? (
              <ReadinessSummary rows={readinessRows} />
            ) : null}
            {!readinessPending && !readinessError && readinessIssues.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                <p className="font-medium">Resolve configuration before running</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {readinessIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!readinessPending &&
            !readinessError &&
            readinessRows.length === 0 &&
            readinessIssues.length === 0 ? (
              <p className="flex items-center gap-2 rounded-md border p-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                Configuration and dependencies are ready.
              </p>
            ) : null}
            {readinessBlocksRun && configurationHref ? (
              <Button asChild type="button" variant="outline" size="sm" className="h-7 gap-1.5">
                <Link to={configurationHref}>
                  Open in Builder
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </section>
        ) : null}

        {initialScopeId && !requestedScope && (
          <div
            role={isLoadingScopes ? 'status' : 'alert'}
            className="rounded-md border border-destructive/40 p-3 text-sm"
          >
            {isLoadingScopes
              ? 'Resolving launch target…'
              : `Launch target is unavailable: ${
                  scopesError instanceof Error
                    ? scopesError.message
                    : 'the requested target was not found'
                }`}
          </div>
        )}

        {scopes.length > 0 && (
          <div className="space-y-2 pt-2">
            <Label htmlFor="prefill-from-target">
              {runtimeInputs.length > 0 ? 'Prefill from target' : 'Run against target'}
            </Label>
            <Select value={selectedScopeId ?? ''} onValueChange={handlePrefillFromScope}>
              <SelectTrigger id="prefill-from-target">
                <SelectValue placeholder="Prefill from a saved target…" />
              </SelectTrigger>
              <SelectContent>
                {scopes.map((scope) => (
                  <SelectItem key={scope.id} value={scope.id}>
                    {scope.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {runtimeInputs.length > 0
                ? 'Fill matching inputs (domains, repos, IPs) from a saved target.'
                : 'Associate this run with a saved target for history, assets, and findings.'}
            </p>
          </div>
        )}

        {runtimeInputs.length > 0 && (
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            {runtimeInputs.map((input) => (
              <div key={`${input.id}-${formSeed}`}>{renderInput(input)}</div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRun}
            className="gap-2"
            disabled={isRequestedScopeUnavailable || readinessBlocksRun}
          >
            <Play className="h-4 w-4" />
            Run Workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
