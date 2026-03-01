import { PanelLeftClose, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { LibraryPanelProps } from './types';

export function LibraryPanel({
  isLibraryVisible,
  showLibraryContent,
  libraryPanelWidth,
  isMobile,
  libraryContent,
  onToggleLibrary,
}: LibraryPanelProps) {
  return (
    <aside
      className={cn(
        'h-full border-r bg-background overflow-hidden z-[60]',
        // Mobile: fixed overlay
        isMobile ? 'fixed left-0 top-0' : 'relative',
        isLibraryVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
      style={{
        width: isLibraryVisible ? libraryPanelWidth : 0,
        transition: 'width 200ms ease-in-out, opacity 200ms ease-in-out',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          width: libraryPanelWidth,
          transform: isLibraryVisible ? 'translateX(0)' : `translateX(-${libraryPanelWidth}px)`,
          transition: 'transform 200ms ease-in-out',
        }}
      >
        {isLibraryVisible && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={onToggleLibrary}
                  className={cn(
                    'absolute z-50 top-3 md:top-4 right-3 md:right-4',
                    'h-8 w-8 md:h-7 md:w-7 flex items-center justify-center rounded-md',
                    'text-xs font-medium transition-all duration-200 hover:bg-muted',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  )}
                  aria-expanded={true}
                  aria-label="Hide component library"
                >
                  {isMobile ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4 flex-shrink-0" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Hide components</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <div
          className={cn(
            'absolute inset-0',
            showLibraryContent ? 'opacity-100' : 'opacity-0 pointer-events-none select-none',
          )}
          style={{
            transition: 'opacity 200ms ease-in-out',
          }}
        >
          {libraryContent}
        </div>
      </div>
    </aside>
  );
}
