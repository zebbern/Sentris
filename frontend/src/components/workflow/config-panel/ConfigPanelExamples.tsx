import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';

export interface ConfigPanelExamplesProps {
  exampleItems: string[];
}

export function ConfigPanelExamples({ exampleItems }: ConfigPanelExamplesProps) {
  if (exampleItems.length === 0) {
    return null;
  }

  return (
    <CollapsibleSection title="Examples" count={exampleItems.length} defaultOpen={false}>
      <div className="space-y-0 mt-2">
        {exampleItems.map((exampleText, index) => {
          const commandMatch = exampleText.match(/`([^`]+)`/);
          const command = commandMatch?.[1]?.trim();
          const description = commandMatch
            ? exampleText
                .replace(commandMatch[0], '')
                .replace(/^[\s\u2013\u2014-]+/, '')
                .trim()
            : exampleText.trim();

          return (
            <div
              key={`${exampleText}-${index}`}
              className={cn('py-3', index > 0 && 'border-t border-border')}
            >
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
                  {index + 1}.
                </span>
                <div className="flex-1 space-y-1.5">
                  {command && (
                    <code className="block w-full overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] font-mono">
                      {command}
                    </code>
                  )}
                  {description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
