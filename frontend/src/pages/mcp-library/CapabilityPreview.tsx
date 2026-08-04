import type {
  JsonValue,
  McpSavedServerPreviewRequest,
  McpSavedServerPreviewResponse,
} from '@sentris/shared';
import { Loader2, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePreviewMcpCapability } from '@/hooks/queries/useMcpServerQueries';

interface PreviewVariable {
  name: string;
  description?: string;
  required?: boolean;
}

interface CapabilityPreviewProps {
  serverId: string;
  variables?: PreviewVariable[];
  buildRequest: (argumentsByName: Record<string, string>) => McpSavedServerPreviewRequest;
}

export function CapabilityPreview({
  serverId,
  variables = [],
  buildRequest,
}: CapabilityPreviewProps) {
  const preview = usePreviewMcpCapability(serverId);
  const [argumentsByName, setArgumentsByName] = useState<Record<string, string>>({});
  const missingRequired = variables.some(
    (variable) => variable.required && !argumentsByName[variable.name]?.trim(),
  );

  const runPreview = () => {
    const suppliedArguments = Object.fromEntries(
      Object.entries(argumentsByName).filter(([, value]) => value.length > 0),
    );
    preview.mutate(buildRequest(suppliedArguments));
  };

  return (
    <div className="mt-3 border-t pt-3">
      {variables.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {variables.map((variable) => (
            <label key={variable.name} className="space-y-1 text-xs">
              <span className="font-medium">
                {variable.name}
                {variable.required ? ' *' : ''}
              </span>
              <Input
                className="h-8 font-mono text-xs"
                value={argumentsByName[variable.name] ?? ''}
                placeholder={variable.description ?? `Value for ${variable.name}`}
                onChange={(event) => {
                  preview.reset();
                  setArgumentsByName((current) => ({
                    ...current,
                    [variable.name]: event.target.value,
                  }));
                }}
              />
            </label>
          ))}
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={preview.isPending || missingRequired}
        onClick={runPreview}
      >
        {preview.isPending ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="mr-2 h-3.5 w-3.5" />
        )}
        {preview.isPending ? 'Loading preview…' : 'Preview'}
      </Button>

      {preview.error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {preview.error.message}
        </div>
      )}
      {preview.data && <PreviewResult result={preview.data} />}
    </div>
  );
}

function PreviewResult({ result }: { result: McpSavedServerPreviewResponse }) {
  const output = isRecord(result.output) ? result.output : null;
  const items =
    result.kind === 'resource'
      ? Array.isArray(output?.contents)
        ? output.contents
        : []
      : Array.isArray(output?.messages)
        ? output.messages
        : [];

  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-3 text-muted-foreground">
        <span>{result.kind === 'resource' ? 'Resource content' : 'Prompt messages'}</span>
        <code className="max-w-[70%] truncate" title={result.target}>
          {result.target}
        </code>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="rounded border bg-background p-2">
              {result.kind === 'prompt' && isRecord(item) && typeof item.role === 'string' && (
                <div className="mb-1 font-medium capitalize text-muted-foreground">{item.role}</div>
              )}
              {renderPreviewContent(
                result.kind === 'prompt' && isRecord(item) ? item.content : item,
              )}
            </div>
          ))}
        </div>
      ) : (
        renderPreviewContent(result.output)
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">Raw response</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2">
          {JSON.stringify(result.output, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function renderPreviewContent(value: JsonValue | undefined): ReactNode {
  if (typeof value === 'string') return <p className="whitespace-pre-wrap break-words">{value}</p>;
  if (isRecord(value)) {
    if (typeof value.text === 'string') {
      return <p className="whitespace-pre-wrap break-words">{value.text}</p>;
    }
    if (typeof value.blob === 'string') {
      return (
        <p className="text-muted-foreground">Binary content ({value.blob.length} encoded chars)</p>
      );
    }
  }
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
