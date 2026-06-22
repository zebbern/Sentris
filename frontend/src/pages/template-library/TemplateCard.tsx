import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTimeAgo } from '@/utils/timeFormat';
import {
  Eye,
  Star,
  KeyRound,
  ArrowRight,
  AlertTriangle,
  CircleHelp,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { getCategoryStyle, toTitleCase } from './types';
import { PreviewSection } from './PreviewSection';

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

export interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  onPreview: (template: Template) => void;
  onRevalidate?: (template: Template) => void;
  isRevalidating?: boolean;
  canUse: boolean;
}

function getValidationBadge(template: Template) {
  const validation = template.validation;
  if (!validation) return null;

  if (!validation.isCurrent && validation.status !== 'unknown') {
    return {
      label: 'Validation stale',
      Icon: AlertTriangle,
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  }

  if (validation.status === 'live-verified') {
    return {
      label: 'Live verified',
      Icon: ShieldCheck,
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }

  if (validation.status === 'needs-fix' || validation.status === 'needs-review') {
    return {
      label: validation.status === 'needs-fix' ? 'Needs fix' : 'Needs review',
      Icon: AlertTriangle,
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  }

  return {
    label: 'Not live checked',
    Icon: CircleHelp,
    className: 'border-border bg-muted/60 text-muted-foreground',
  };
}

function formatArtifactCount(count: number | null | undefined) {
  if (!count || count < 1) return null;
  return `${count} artifact${count === 1 ? '' : 's'}`;
}

function getValidationAction(template: Template) {
  const validation = template.validation;
  if (!validation) return null;

  const shouldRevalidate =
    validation.status === 'unknown' ||
    !validation.isCurrent ||
    validation.status === 'needs-fix' ||
    validation.status === 'needs-review';

  if (!shouldRevalidate) return null;

  return {
    command: `bun run template-library:audit -- --name ${JSON.stringify(template.name)} --force`,
  };
}

export function TemplateCard({
  template,
  onUse,
  onPreview,
  onRevalidate,
  isRevalidating = false,
  canUse,
}: TemplateCardProps) {
  const catStyle = getCategoryStyle(template.category);
  const CategoryIcon = catStyle.icon;
  const validationBadge = getValidationBadge(template);
  const ValidationIcon = validationBadge?.Icon;
  const validationAction = getValidationAction(template);
  const artifactCount = formatArtifactCount(template.validation?.artifactsCount);

  const filteredTags = useMemo(() => {
    const categoryLower = (template.category || '').toLowerCase();
    return (template.tags || []).filter((t) => t.toLowerCase() !== categoryLower);
  }, [template.category, template.tags]);

  return (
    <article
      className={cn(
        'group flex flex-col rounded-2xl',
        'bg-card dark:bg-zinc-900',
        'border border-border',
        'shadow-sm',
        'transition-all duration-300 ease-out',
        'hover:shadow-lg hover:-translate-y-1',
        'dark:hover:border-white/10',
      )}
    >
      {/* Content wrapper with padding */}
      <div className="flex flex-col flex-1 p-5 md:p-6 gap-6">
        {/* Preview */}
        <PreviewSection graph={template.graph} category={template.category} />

        {/* Header: Category badge + Author */}
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className={cn(
              'text-xs font-medium gap-1 rounded-full px-3 py-1 border',
              catStyle.badge,
            )}
          >
            <CategoryIcon className="h-3 w-3" />
            {template.category || 'Automation'}
          </Badge>

          {template.author && (
            <div className="flex items-center gap-1.5">
              <div className="h-5 w-5 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                {template.author.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                {template.author}
              </span>
            </div>
          )}
        </div>

        {/* Title + Description */}
        <div>
          <h3
            className="text-xl font-semibold text-foreground leading-tight line-clamp-1"
            title={template.name}
          >
            <button
              type="button"
              className="text-left hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              onClick={() => onPreview(template)}
            >
              {toTitleCase(template.name)}
            </button>
          </h3>

          {template.description && (
            <p
              className="text-sm text-muted-foreground mt-2 line-clamp-2"
              title={template.description}
            >
              {template.description}
            </p>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tags & Metadata */}
        <div className="space-y-2.5">
          {/* Tags */}
          {filteredTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filteredTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex items-center px-3 py-1 rounded-full text-xs',
                    'bg-muted text-muted-foreground border border-border',
                  )}
                >
                  {tag}
                </span>
              ))}
              {filteredTags.length > 3 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          'inline-flex items-center px-3 py-1 rounded-full text-xs cursor-default',
                          'bg-muted text-muted-foreground border border-border',
                        )}
                      >
                        +{filteredTags.length - 3}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{filteredTags.slice(3).join(', ')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}

          {/* Marketplace metadata */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/60">
            {validationBadge && (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          validationBadge.className,
                        )}
                      >
                        {ValidationIcon && <ValidationIcon className="h-3 w-3" />}
                        {validationBadge.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="space-y-1 text-xs">
                        <div>{template.validation?.rationale}</div>
                        {template.validation?.verifiedAt && (
                          <div>Verified {formatTimeAgo(template.validation.verifiedAt)}</div>
                        )}
                        {template.validation?.terminalStatus && (
                          <div>Run status: {template.validation.terminalStatus}</div>
                        )}
                        <div>Recommendation: {template.validation?.recommendation}</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {validationAction && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
                            'transition-colors hover:bg-sky-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            (!canUse || isRevalidating) && 'cursor-not-allowed opacity-70',
                          )}
                          disabled={!canUse || isRevalidating}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRevalidate?.(template);
                          }}
                        >
                          <RefreshCw className={cn('h-3 w-3', isRevalidating && 'animate-spin')} />
                          Revalidate
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">
                        <div className="space-y-1.5 text-xs">
                          <div>Run the targeted live audit before trusting this template.</div>
                          <code className="block rounded bg-muted px-2 py-1 font-mono text-[11px] leading-relaxed text-foreground break-all">
                            {validationAction.command}
                          </code>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {artifactCount && <span>{artifactCount}</span>}
                <span className="text-border">&middot;</span>
              </>
            )}
            {template.popularity > 0 && (
              <>
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3 text-amber-500" />
                  {template.popularity}
                </span>
                <span className="text-border">&middot;</span>
              </>
            )}
            {template.requiredSecrets && template.requiredSecrets.length > 0 && (
              <>
                <span className="flex items-center gap-1">
                  <KeyRound className="h-3 w-3" />
                  {template.requiredSecrets.length} secret
                  {template.requiredSecrets.length !== 1 ? 's' : ''}
                </span>
                <span className="text-border">&middot;</span>
              </>
            )}
            {template.updatedAt && <span>Updated {formatTimeAgo(template.updatedAt)}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className={cn(
              'flex-1 h-11 rounded-xl font-medium gap-2',
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

          {template.repository && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'h-11 w-11 rounded-xl p-0 flex-shrink-0',
                      'bg-muted border-border hover:bg-muted/80',
                    )}
                    asChild
                  >
                    <a
                      href={`https://github.com/${template.repository}/blob/${template.branch || 'main'}/${template.path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Eye className="h-4 w-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Preview</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
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
      <div className="p-5 md:p-6 space-y-6">
        <Skeleton className="h-44 w-full rounded-xl" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="space-y-2.5">
          <div className="flex gap-1.5">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 w-11 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
