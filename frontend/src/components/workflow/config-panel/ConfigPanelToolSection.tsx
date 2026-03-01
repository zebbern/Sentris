import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import type { ToolSchemaField } from './types';

export interface ConfigPanelToolSectionProps {
  componentName: string;
  componentSlug: string;
  componentDescription: string;
  toolProviderName?: string;
  toolProviderDescription?: string;
  toolSchemaFields: ToolSchemaField[];
  toolSchemaJson: string | null;
}

export function ConfigPanelToolSection({
  componentName,
  componentSlug,
  componentDescription,
  toolProviderName,
  toolProviderDescription,
  toolSchemaFields,
  toolSchemaJson,
}: ConfigPanelToolSectionProps) {
  return (
    <CollapsibleSection title="Tool" defaultOpen={true}>
      <div className="space-y-3 mt-2">
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono">
              {toolProviderName ?? componentSlug}
            </Badge>
            <span className="text-xs font-semibold text-foreground">{componentName}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {toolProviderDescription ?? componentDescription}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase text-muted-foreground">Arguments</div>
          {toolSchemaFields.length > 0 ? (
            <div className="space-y-2">
              {toolSchemaFields.map((field) => (
                <div key={field.id} className="rounded-md border bg-background/60 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{field.id}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {field.type}
                    </Badge>
                    {field.required && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono text-destructive border-destructive/40"
                      >
                        required
                      </Badge>
                    )}
                  </div>
                  {field.description && (
                    <p className="text-xs text-muted-foreground mt-1">{field.description}</p>
                  )}
                  {(field.defaultValue !== undefined || field.enumValues) && (
                    <div className="mt-2 text-[11px] text-muted-foreground space-y-1">
                      {field.defaultValue !== undefined && (
                        <div>
                          Default:{' '}
                          <span className="font-mono text-foreground">
                            {JSON.stringify(field.defaultValue)}
                          </span>
                        </div>
                      )}
                      {field.enumValues && (
                        <div>
                          Enum:{' '}
                          <span className="font-mono text-foreground">
                            {field.enumValues.map((value) => JSON.stringify(value)).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No tool schema available for this node.
            </p>
          )}
        </div>

        {toolSchemaJson && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase text-muted-foreground">Raw Schema</div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/20 text-foreground p-3 rounded-md border border-border shadow-sm min-h-[40px] max-h-[300px] overflow-y-auto">
              {toolSchemaJson}
            </pre>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
