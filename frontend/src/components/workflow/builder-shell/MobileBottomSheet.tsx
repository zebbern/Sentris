import { cn } from '@/lib/utils';
import type { MobileBottomSheetProps } from './types';

export function MobileBottomSheet({
  mobileSheetHeight,
  isDraggingRef,
  anyMobilePanelVisible,
  showMobileHint,
  isConfigPanelVisible,
  isScheduleSidebarVisible,
  configPanelContent,
  scheduleSidebarContent,
  inspectorContent,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onMouseDown,
}: MobileBottomSheetProps) {
  return (
    <aside
      className={cn(
        'fixed inset-x-0 bottom-0 z-[60] bg-background border-t rounded-t-2xl shadow-2xl overflow-hidden',
        'transition-opacity duration-200',
        anyMobilePanelVisible ? 'opacity-100' : 'opacity-0 pointer-events-none translate-y-full',
      )}
      style={{
        height: anyMobilePanelVisible ? `${mobileSheetHeight}%` : 0,
        maxHeight: 'calc(100vh - 56px)', // Don't go above topbar
        transition: isDraggingRef.current
          ? 'none'
          : 'height 200ms ease-out, opacity 200ms ease-out, transform 200ms ease-out',
      }}
    >
      {/* Drag handle with animated hint */}
      <div
        className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
      >
        <div
          className={cn(
            'flex items-center justify-center rounded-full transition-all duration-500 ease-out overflow-hidden',
            showMobileHint
              ? 'bg-muted/80 border px-3 py-1.5 gap-1.5'
              : 'bg-muted-foreground/40 w-12 h-1.5',
          )}
        >
          {showMobileHint ? (
            <>
              <svg
                className="w-3 h-3 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {isConfigPanelVisible
                  ? 'Slide down to see canvas'
                  : isScheduleSidebarVisible
                    ? 'Slide down to see canvas'
                    : 'Slide down to inspect nodes'}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Content */}
      <div className="flex h-[calc(100%-36px)] min-h-0 overflow-hidden w-full relative">
        {isConfigPanelVisible
          ? configPanelContent
          : isScheduleSidebarVisible
            ? scheduleSidebarContent
            : inspectorContent}
        <div id="mobile-bottom-sheet-portal" className="absolute inset-0 empty:hidden" />
      </div>
    </aside>
  );
}
