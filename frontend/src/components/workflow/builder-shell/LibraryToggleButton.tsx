import { PanelLeftOpen, Undo2, Redo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { LibraryToggleButtonProps } from './types';

export function LibraryToggleButton({
  mode,
  isMobile,
  onToggleLibrary,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: LibraryToggleButtonProps) {
  return (
    <div className="absolute z-[35] top-[10px] left-[10px] flex items-center gap-1.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              onClick={onToggleLibrary}
              className={cn(
                'h-8 px-2 md:px-3 py-1.5',
                'flex items-center gap-1.5 md:gap-2 rounded-md border bg-background',
                'text-xs font-medium transition-all duration-200 hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm',
              )}
              aria-expanded={false}
              aria-label="Show component library"
            >
              <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium whitespace-nowrap hidden sm:inline">
                Show components
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show components</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {isMobile && mode === 'design' && (
        <div className="flex items-center gap-1 bg-background border rounded-md px-1 h-8 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <div className="h-3.5 w-px bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
