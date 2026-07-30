import { cn } from '@/lib/utils';
import type { LibraryPanelProps } from './types';

export function LibraryPanel({
  isLibraryVisible,
  showLibraryContent,
  libraryPanelWidth,
  isMobile,
  libraryContent,
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
