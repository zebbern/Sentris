import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowRight,
  CheckCircle2,
  FileOutput,
  KeyRound,
  SlidersHorizontal,
  Wrench,
  Zap,
} from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { getCategoryStyle, toTitleCase } from './types';
import { PreviewSection } from './PreviewSection';
import {
  getTemplateRuntimeInputCount,
  getTemplateSetupLevel,
  isLiveVerifiedTemplate,
  templateProducesArtifact,
} from './setupLevel';

export interface TemplateDetailModalProps {
  template: Template | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (template: Template) => void;
  canUse: boolean;
}

export function TemplateDetailModal({
  template,
  open,
  onOpenChange,
  onUse,
  canUse,
}: TemplateDetailModalProps) {
  if (!template) return null;

  const catStyle = getCategoryStyle(template.category);
  const CategoryIcon = catStyle.icon;
  const setupLevel = getTemplateSetupLevel(template);
  const runtimeInputCount = getTemplateRuntimeInputCount(template);
  const producesArtifact = templateProducesArtifact(template);
  const liveVerified = isLiveVerifiedTemplate(template);
  const categoryLower = (template.category || '').toLowerCase();
  const filteredTags = (template.tags || []).filter((tag) => tag.toLowerCase() !== categoryLower);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto p-0">
        <PreviewSection
          graph={template.graph}
          category={template.category}
          interactive
          heightClass="h-72 sm:h-80"
          className="rounded-t-lg rounded-b-none"
          showCategoryBadge={false}
        />

        <div className="space-y-4 px-6 pb-6">
          <DialogHeader>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium',
                  catStyle.badge,
                )}
              >
                <CategoryIcon className="h-3 w-3" />
                {template.category || 'Automation'}
              </span>
              {template.author && (
                <div className="flex items-center gap-1.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                    {template.author.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-muted-foreground">{template.author}</span>
                </div>
              )}
            </div>
            <DialogTitle className="text-2xl font-semibold">
              {toTitleCase(template.name)}
            </DialogTitle>
            {template.description && (
              <DialogDescription className="mt-2 text-sm">{template.description}</DialogDescription>
            )}
          </DialogHeader>

          {filteredTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filteredTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div
            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            aria-label="Template readiness"
          >
            {liveVerified && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sky-700 dark:text-sky-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Live verified
              </span>
            )}
            {setupLevel === 'no-setup' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
                <Zap className="h-3.5 w-3.5" />
                No setup required
              </span>
            ) : setupLevel === 'needs-secrets' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300">
                <KeyRound className="h-3.5 w-3.5" />
                {template.requiredSecrets.length} stored secret
                {template.requiredSecrets.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1">
                <Wrench className="h-3.5 w-3.5" />
                Local tools required
              </span>
            )}
            {runtimeInputCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {runtimeInputCount} run input{runtimeInputCount === 1 ? '' : 's'}
              </span>
            )}
            {producesArtifact && (
              <span className="inline-flex items-center gap-1">
                <FileOutput className="h-3.5 w-3.5" />
                Creates a report
              </span>
            )}
          </div>

          <Button
            className="h-11 w-full gap-2 rounded-xl font-medium transition-all duration-200 active:scale-[0.98]"
            onClick={() => onUse(template)}
            disabled={!canUse}
          >
            Configure &amp; Run
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
