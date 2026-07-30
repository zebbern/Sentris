import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { WorkflowPreview } from '@/features/templates/WorkflowPreview';
import {
  ArrowRight,
  CheckCircle2,
  FileOutput,
  KeyRound,
  SlidersHorizontal,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { getCategoryStyle, hasGraphNodes, toTitleCase } from './types';
import {
  getTemplateRuntimeInputCount,
  getTemplateSetupLevel,
  isLiveVerifiedTemplate,
  templateProducesArtifact,
} from './setupLevel';

// ---------------------------------------------------------------------------
// Template detail modal
// ---------------------------------------------------------------------------

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
  const hasGraph = hasGraphNodes(template.graph);
  const setupLevel = getTemplateSetupLevel(template);
  const runtimeInputCount = getTemplateRuntimeInputCount(template);
  const producesArtifact = templateProducesArtifact(template);
  const liveVerified = isLiveVerifiedTemplate(template);
  const categoryLower = (template.category || '').toLowerCase();
  const filteredTags = (template.tags || []).filter((tag) => tag.toLowerCase() !== categoryLower);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0">
        {/* Graph preview */}
        <div className="relative w-full h-72 sm:h-80 overflow-hidden rounded-t-lg bg-gradient-to-b from-muted/30 to-muted/60 dark:from-gray-900 dark:to-[hsl(222,47%,10%)]">
          <div
            className="absolute inset-0 hidden dark:block pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.08), transparent 60%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)',
              backgroundSize: '12px 12px',
            }}
          />
          {hasGraph ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <WorkflowPreview graph={template.graph!} className="w-full h-full" />
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/30">
              <Workflow className="h-12 w-12" />
              <span className="text-xs font-medium">No preview</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
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
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-[10px] font-bold text-white flex-shrink-0">
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
              <DialogDescription className="text-sm mt-2">{template.description}</DialogDescription>
            )}
          </DialogHeader>

          {filteredTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filteredTags.map((tag) => (
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
            className={cn(
              'w-full h-11 rounded-xl font-medium gap-2',
              'active:scale-[0.98] transition-all duration-200',
            )}
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
