import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimeAgo } from '@/utils/timeFormat';
import {
  ArrowRight,
  CheckCircle2,
  FileOutput,
  KeyRound,
  SlidersHorizontal,
  Sparkles,
  Star,
  Wrench,
  Zap,
} from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { toTitleCase } from './types';
import { PreviewSection } from './PreviewSection';
import {
  getTemplateRuntimeInputCount,
  getTemplateSetupLevel,
  isLiveVerifiedTemplate,
  templateProducesArtifact,
} from './setupLevel';

export interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  onPreview: (template: Template) => void;
  canUse: boolean;
  recommended?: boolean;
}

function StatusDot({ className }: { className?: string }) {
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)} />;
}

export function TemplateCard({
  template,
  onUse,
  onPreview,
  canUse,
  recommended = false,
}: TemplateCardProps) {
  const setupLevel = getTemplateSetupLevel(template);
  const runtimeInputCount = getTemplateRuntimeInputCount(template);
  const producesArtifact = templateProducesArtifact(template);
  const liveVerified = isLiveVerifiedTemplate(template);
  const categoryLower = (template.category || '').toLowerCase();
  const tags = (template.tags || [])
    .filter((tag) => tag.toLowerCase() !== categoryLower)
    .slice(0, 3);

  const setupLabel =
    setupLevel === 'no-setup'
      ? 'No setup required'
      : setupLevel === 'needs-secrets'
        ? `${template.requiredSecrets.length} stored secret${template.requiredSecrets.length === 1 ? '' : 's'}`
        : 'Local tools required';

  const setupTone =
    setupLevel === 'no-setup'
      ? 'text-emerald-600 dark:text-emerald-400'
      : setupLevel === 'needs-secrets'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground';

  const setupDotClass =
    setupLevel === 'no-setup'
      ? 'bg-emerald-500'
      : setupLevel === 'needs-secrets'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/50';

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
        <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {template.updatedAt && (
              <span className="truncate">{formatTimeAgo(template.updatedAt)}</span>
            )}
            {liveVerified ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <StatusDot className="bg-emerald-500" />
                Active
              </span>
            ) : (
              <span className={cn('inline-flex items-center gap-1.5', setupTone)}>
                <StatusDot className={setupDotClass} />
                {setupLabel}
              </span>
            )}
            {liveVerified && (
              <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
                <CheckCircle2 className="h-3 w-3" />
                Live verified
              </span>
            )}
          </div>
          {recommended && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              Recommended starter
            </span>
          )}
        </div>

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
              className="mt-1.5 line-clamp-2 text-sm text-muted-foreground group-hover:line-clamp-3"
              title={template.description}
            >
              {template.description}
            </p>
          )}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Extra info expands on hover */}
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
            'grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100',
            'focus-within:grid-rows-[1fr] focus-within:opacity-100',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {runtimeInputCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <SlidersHorizontal className="h-3 w-3" />
                  {runtimeInputCount} run input{runtimeInputCount === 1 ? '' : 's'}
                </span>
              )}
              {producesArtifact && (
                <span className="inline-flex items-center gap-1">
                  <FileOutput className="h-3 w-3" />
                  Creates a report
                </span>
              )}
              {template.popularity > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3 text-amber-500" />
                  {template.popularity}
                </span>
              )}
              {liveVerified && (
                <span className={cn('inline-flex items-center gap-1', setupTone)}>
                  {setupLevel === 'no-setup' ? (
                    <Zap className="h-3 w-3" />
                  ) : setupLevel === 'needs-secrets' ? (
                    <KeyRound className="h-3 w-3" />
                  ) : (
                    <Wrench className="h-3 w-3" />
                  )}
                  {setupLabel}
                </span>
              )}
            </div>
          </div>
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
