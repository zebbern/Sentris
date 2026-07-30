import type { ReactNode } from 'react';
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

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

export interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  onPreview: (template: Template) => void;
  canUse: boolean;
  recommended?: boolean;
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

  return (
    <article
      className={cn(
        'group flex flex-col rounded-2xl',
        'bg-card dark:bg-zinc-900',
        'border border-border',
        'shadow-sm',
        'transition-colors duration-200 ease-out',
        'hover:bg-muted/30 hover:border-border/80',
        'dark:hover:border-white/10',
      )}
    >
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div
          className="flex min-h-6 flex-wrap items-center gap-1.5"
          aria-label="Template readiness"
        >
          {recommended && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              Recommended starter
            </span>
          )}
          {liveVerified && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              <CheckCircle2 className="h-3 w-3" />
              Live verified
            </span>
          )}
          {setupLevel === 'no-setup' ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
              title="Runs with only outbound internet — no API keys or Docker images required. You may still enter a target in the run dialog."
            >
              <Zap className="h-3 w-3" />
              No setup required
            </span>
          ) : setupLevel === 'needs-secrets' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <KeyRound className="h-3 w-3" />
              {template.requiredSecrets.length} stored secret
              {template.requiredSecrets.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Wrench className="h-3 w-3" />
              Local tools required
            </span>
          )}
        </div>

        <PreviewSection
          graph={template.graph}
          category={template.category}
          onPreviewClick={() => onPreview(template)}
        />

        <div>
          <h3 className="text-lg font-semibold leading-tight">
            <button
              type="button"
              aria-label={`View ${toTitleCase(template.name)} template details`}
              onClick={() => onPreview(template)}
              className="line-clamp-1 text-left text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

        {(runtimeInputCount > 0 || producesArtifact) && (
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
          </div>
        )}

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
          Configure &amp; Run
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
