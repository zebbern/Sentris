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
import { Workflow, ArrowRight } from 'lucide-react';
import type { Template } from '@/hooks/queries/useTemplateQueries';
import { cn } from '@/lib/utils';
import { getCategoryStyle, hasGraphNodes, toTitleCase } from './types';

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0">
        {/* Graph preview */}
        <div
          className="relative w-full h-72 sm:h-80 overflow-hidden rounded-t-lg"
          style={{
            background: 'linear-gradient(180deg, #F8FAFF 0%, #F1F5FF 100%)',
          }}
        >
          <div
            className="absolute inset-0 hidden dark:block"
            style={{
              background: 'linear-gradient(180deg, #111827 0%, #0B1220 100%)',
            }}
          />
          <div
            className="absolute inset-0 hidden dark:block pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.08), transparent 60%)',
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
            <div className="flex items-center gap-2 mb-2">
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
                <span className="text-xs text-muted-foreground">by {template.author}</span>
              )}
            </div>
            <DialogTitle className="text-2xl font-semibold">
              {toTitleCase(template.name)}
            </DialogTitle>
            {template.description && (
              <DialogDescription className="text-sm mt-2">{template.description}</DialogDescription>
            )}
          </DialogHeader>

          <Button
            className={cn(
              'w-full h-11 rounded-xl font-medium gap-2',
              'active:scale-[0.98] transition-all duration-200',
            )}
            onClick={() => onUse(template)}
            disabled={!canUse}
          >
            Use Template
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
