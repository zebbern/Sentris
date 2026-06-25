import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimeAgo } from '@/utils/timeFormat';
import { Star, KeyRound, ArrowRight } from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { toTitleCase } from './types';
import { PreviewSection } from './PreviewSection';

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

export interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  onPreview: (template: Template) => void;
  canUse: boolean;
}

function TemplateCardStats({ template }: { template: Template }) {
  const segments: ReactNode[] = [];

  if (template.author) {
    segments.push(
      <span
        key="author"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
        title={template.author}
      >
        {template.author.charAt(0).toUpperCase()}
      </span>,
    );
  }

  if (template.popularity > 0) {
    segments.push(
      <span key="popularity" className="inline-flex shrink-0 items-center gap-1">
        <Star className="h-3 w-3 text-amber-500" />
        {template.popularity}
      </span>,
    );
  }

  if (template.requiredSecrets && template.requiredSecrets.length > 0) {
    segments.push(
      <span key="secrets" className="inline-flex shrink-0 items-center gap-1">
        <KeyRound className="h-3 w-3" />
        {template.requiredSecrets.length} secret
        {template.requiredSecrets.length !== 1 ? 's' : ''}
      </span>,
    );
  }

  if (template.updatedAt) {
    segments.push(
      <span key="updated" className="truncate">
        Updated {formatTimeAgo(template.updatedAt)}
      </span>,
    );
  }

  if (segments.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">
      {segments.map((segment, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-2">
          {index > 0 && <span className="shrink-0 text-border">&middot;</span>}
          {segment}
        </span>
      ))}
    </div>
  );
}

export function TemplateCard({ template, onUse, onPreview, canUse }: TemplateCardProps) {
  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPreview(template);
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`View ${toTitleCase(template.name)} template details`}
      onClick={() => onPreview(template)}
      onKeyDown={handleCardKeyDown}
      className={cn(
        'group flex flex-col rounded-2xl cursor-pointer',
        'bg-card dark:bg-zinc-900',
        'border border-border',
        'shadow-sm',
        'transition-colors duration-200 ease-out',
        'hover:bg-muted/30 hover:border-border/80',
        'dark:hover:border-white/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <div className="flex flex-1 flex-col gap-4 p-4">
        <PreviewSection
          graph={template.graph}
          category={template.category}
          onPreviewClick={() => onPreview(template)}
        />

        <div>
          <h3
            className="text-lg font-semibold leading-tight text-foreground line-clamp-1"
            title={template.name}
          >
            {toTitleCase(template.name)}
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

        <div className="flex-1" />

        <TemplateCardStats template={template} />

        <Button
          className={cn(
            'h-9 w-full rounded-lg font-medium gap-2',
            'active:scale-[0.98] transition-all duration-200',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onUse(template);
          }}
          disabled={!canUse}
        >
          Use Template
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </Button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card dark:bg-zinc-900 shadow-sm">
      <div className="space-y-4 p-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}
