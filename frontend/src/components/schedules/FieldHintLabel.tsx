import { HelpCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface FieldHintLabelProps {
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
  className?: string;
  as?: 'label' | 'heading';
}

/** Compact field/section label with optional hover hint to the right. */
export function FieldHintLabel({
  children,
  hint,
  htmlFor,
  className,
  as = 'label',
}: FieldHintLabelProps) {
  const hintControl = hint ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`About ${typeof children === 'string' ? children : 'this field'}`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {as === 'label' ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {children}
        </Label>
      ) : (
        <h3 className="text-sm font-semibold">{children}</h3>
      )}
      {hintControl}
    </div>
  );
}
