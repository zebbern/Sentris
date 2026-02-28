import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BulkAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
}

interface BulkActionBarProps {
  selectedCount: number;
  actions: BulkAction[];
  className?: string;
}

/**
 * Displays a contextual toolbar when one or more items are selected.
 *
 * Renders a sticky bar showing the selected count and action buttons.
 * Automatically hidden when `selectedCount` is 0.
 */
export function BulkActionBar({ selectedCount, actions, className }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 mb-3 animate-in slide-in-from-top-2 fade-in-0 duration-200',
        className,
      )}
    >
      <span className="text-sm font-medium text-foreground">{selectedCount} selected</span>
      <div className="ml-auto flex items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
