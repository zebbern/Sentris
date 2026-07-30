import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { toTitleCase } from './types';
import { PreviewSection } from './PreviewSection';

export interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  onPreview: (template: Template) => void;
  canUse: boolean;
  recommended?: boolean;
}

export function TemplateCard({
  template,
  onUse,
  onPreview,
  canUse,
  recommended = false,
}: TemplateCardProps) {
  return (
    <article
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl',
        'border border-border bg-card shadow-sm dark:bg-zinc-900',
        'transition-colors duration-200 ease-out',
        'hover:border-border/80 hover:bg-muted/20 dark:hover:border-white/10',
      )}
    >
      <PreviewSection
        graph={template.graph}
        category={template.category}
        onPreviewClick={() => onPreview(template)}
        interactive={false}
        heightClass="h-44"
        className="rounded-none"
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {recommended && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Sparkles className="h-3 w-3" />
            Recommended starter
          </span>
        )}

        <div>
          <h3 className="text-lg font-semibold leading-tight tracking-tight">
            <button
              type="button"
              aria-label={`View ${toTitleCase(template.name)} template details`}
              onClick={() => onPreview(template)}
              className="line-clamp-1 text-left text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              title={template.name}
            >
              {toTitleCase(template.name)}
            </button>
          </h3>

          {template.description && (
            <p
              className="mt-1.5 line-clamp-2 text-sm text-muted-foreground"
              title={template.description}
            >
              {template.description}
            </p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
              title={template.author || 'Sentris'}
            >
              {(template.author || 'Sentris').charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {template.author || 'Sentris'}
            </span>
          </div>

          <Button
            size="sm"
            className="h-8 shrink-0 gap-1.5 rounded-full px-3"
            onClick={(e) => {
              e.stopPropagation();
              onUse(template);
            }}
            disabled={!canUse}
          >
            Configure &amp; Run
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:bg-zinc-900">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}
