import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTimeAgo } from '@/utils/timeFormat';
import { Eye, Star, KeyRound, ArrowRight } from 'lucide-react';
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
  canUse: boolean;
}

export function TemplateCard({ template, onUse, onPreview, canUse }: TemplateCardProps) {
  const catStyle = getCategoryStyle(template.category);
  const CategoryIcon = catStyle.icon;

  return (
    <div
      className={cn(
        'group flex flex-col rounded-2xl cursor-pointer',
        'bg-card dark:bg-zinc-900',
        'border border-border',
        'shadow-sm',
        'transition-all duration-300 ease-out',
        'hover:shadow-lg hover:-translate-y-1',
        'dark:hover:border-white/10',
      )}
      onClick={() => onPreview(template)}
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
            {toTitleCase(template.name)}
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
          {(() => {
            const categoryLower = (template.category || '').toLowerCase();
            const filteredTags = (template.tags || []).filter(
              (t) => t.toLowerCase() !== categoryLower,
            );
            if (filteredTags.length === 0) return null;
            return (
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
            );
          })()}

          {/* Marketplace metadata */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
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
    </div>
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
