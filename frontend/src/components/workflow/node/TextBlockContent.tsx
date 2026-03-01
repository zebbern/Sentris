import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/ui/markdown';
import { useReactFlow } from 'reactflow';
import { useWorkflowStore } from '@/store/workflowStore';
import type { FrontendNodeData } from '@/schemas/node';

export interface TextBlockContentProps {
  id: string;
  content: string;
}

/**
 * Renders text-block node content: either a MarkdownView preview or a placeholder prompt.
 */
export function TextBlockContent({ id, content }: TextBlockContentProps) {
  const { setNodes } = useReactFlow();
  const markDirty = useWorkflowStore((s) => s.markDirty);

  const handleEdit = (next: string) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const currentConfig = (n.data as FrontendNodeData).config || {
          params: {},
          inputOverrides: {},
        };
        return {
          ...n,
          data: {
            ...n.data,
            config: {
              ...currentConfig,
              params: { ...currentConfig.params, content: next },
            },
          },
        };
      }),
    );
    markDirty();
  };

  if (content.length > 0) {
    return (
      <MarkdownView
        content={content}
        dataTestId="text-block-content"
        className={cn(
          'w-full rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-3 overflow-x-hidden overflow-y-auto break-words',
          'prose prose-base dark:prose-invert max-w-none text-foreground',
          'flex-1 min-h-0',
        )}
        onEdit={handleEdit}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm text-muted-foreground leading-relaxed',
        'flex-1 min-h-0',
      )}
      data-testid="text-block-content"
    >
      Add notes in the configuration panel to share context with teammates.
    </div>
  );
}
