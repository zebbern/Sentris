import { ExternalLink } from 'lucide-react';
import { MarkdownView } from '@/components/ui/markdown';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';

export interface ConfigPanelDocumentationProps {
  documentation?: string | null;
  documentationUrl?: string | null;
}

export function ConfigPanelDocumentation({
  documentation,
  documentationUrl,
}: ConfigPanelDocumentationProps) {
  if (!documentation && !documentationUrl) {
    return null;
  }

  return (
    <CollapsibleSection title="Documentation" defaultOpen={false}>
      <div className="space-y-0 mt-2">
        {documentationUrl && (
          <div className={cn('py-3', documentation && 'border-b border-border pb-3')}>
            <a
              href={documentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs hover:text-primary transition-colors group"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
              <span className="text-muted-foreground group-hover:text-foreground">
                View external documentation
              </span>
            </a>
          </div>
        )}
        {documentation && (
          <div className="py-3">
            <MarkdownView
              content={documentation}
              dataTestId="component-documentation"
              className={cn(
                'prose prose-sm dark:prose-invert max-w-none',
                'text-foreground prose-headings:text-foreground',
                'prose-p:text-muted-foreground prose-p:text-xs prose-p:leading-relaxed',
                'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
                'prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
                'prose-pre:bg-muted prose-pre:text-xs',
                'prose-ul:text-xs prose-ol:text-xs',
                'prose-li:text-muted-foreground',
              )}
            />
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
