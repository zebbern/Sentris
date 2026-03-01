import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { HumanInputDialog } from './HumanInputDialog';
import { LIBRARY_PANEL_WIDTH, LIBRARY_PANEL_WIDTH_MOBILE } from './builder-shell/constants';
import { useMobileSheet } from './builder-shell/useMobileSheet';
import { useInspectorResize } from './builder-shell/useInspectorResize';
import { LibraryPanel } from './builder-shell/LibraryPanel';
import { MobileBottomSheet } from './builder-shell/MobileBottomSheet';
import { DesktopInspectorPanel } from './builder-shell/DesktopInspectorPanel';
import { LibraryToggleButton } from './builder-shell/LibraryToggleButton';
import { LoadingOverlay } from './builder-shell/LoadingOverlay';
import type { WorkflowBuilderShellProps } from './builder-shell/types';

export function WorkflowBuilderShell({
  mode,
  topBar,
  isLibraryVisible,
  onToggleLibrary,
  libraryContent,
  canvasContent,
  showScheduleSidebarContainer,
  isScheduleSidebarVisible,
  scheduleSidebarContent,
  isInspectorVisible,
  inspectorContent,
  inspectorWidth,
  setInspectorWidth,
  showLoadingOverlay,
  scheduleDrawer,
  runDialog,
  isConfigPanelVisible,
  configPanelContent,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  executionOverlay,
  terminalDockContent,
}: WorkflowBuilderShellProps) {
  const isMobile = useIsMobile();
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [showLibraryContent, setShowLibraryContent] = useState(isLibraryVisible);

  const libraryPanelWidth = isMobile ? LIBRARY_PANEL_WIDTH_MOBILE : LIBRARY_PANEL_WIDTH;
  const showLibraryToggleButton = mode === 'design' && !isLibraryVisible;
  const anyMobilePanelVisible =
    isInspectorVisible || isConfigPanelVisible || isScheduleSidebarVisible;

  // Delayed library content reveal for slide animation
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (isLibraryVisible) {
      timeoutId = setTimeout(() => setShowLibraryContent(true), 220);
    } else {
      setShowLibraryContent(false);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isLibraryVisible]);

  const {
    mobileSheetHeight,
    isDraggingSheetRef,
    showMobileHint,
    handleSheetTouchStart,
    handleSheetTouchMove,
    handleSheetTouchEnd,
    handleSheetMouseDown,
  } = useMobileSheet({ isMobile, anyMobilePanelVisible });

  const { isInspectorResizing, handleInspectorResizeStart } = useInspectorResize({
    mode,
    isMobile,
    setInspectorWidth,
    layoutRef,
  });

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {topBar}
      <div ref={layoutRef} className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop for library panel */}
        {isMobile && isLibraryVisible && (
          <div
            className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm md:hidden"
            onClick={onToggleLibrary}
            aria-hidden="true"
          />
        )}

        {showLibraryToggleButton && (
          <LibraryToggleButton
            mode={mode}
            isMobile={isMobile}
            onToggleLibrary={onToggleLibrary}
            onUndo={onUndo}
            onRedo={onRedo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        )}

        {/* Execution mode floating overlay (e.g., parent run breadcrumbs) */}
        {mode === 'execution' && executionOverlay && (
          <div className="absolute z-[35] top-[10px] left-[10px]">{executionOverlay}</div>
        )}

        {showLoadingOverlay && <LoadingOverlay />}

        <LibraryPanel
          isLibraryVisible={isLibraryVisible}
          showLibraryContent={showLibraryContent}
          libraryPanelWidth={libraryPanelWidth}
          isMobile={isMobile}
          libraryContent={libraryContent}
          onToggleLibrary={onToggleLibrary}
        />

        {/* Wrapper: flex column for main + terminal dock */}
        <div className="flex-1 flex flex-col min-w-0">
          <main
            className="flex-1 relative flex min-w-0 min-h-0"
            style={{
              transition: isInspectorResizing ? 'none' : 'all 200ms ease-in-out',
            }}
          >
            <div className="flex-1 h-full relative min-w-0">{canvasContent}</div>

            {/* Schedule Sidebar — inline (~14 lines, too small to extract) */}
            {showScheduleSidebarContainer && !isMobile && (
              <aside
                className={cn(
                  'overflow-hidden border-l bg-background transition-all duration-150 ease-out',
                  isScheduleSidebarVisible
                    ? 'opacity-100 w-[432px]'
                    : 'opacity-0 w-0 pointer-events-none',
                )}
                style={{
                  transition: 'width 150ms ease-out, opacity 150ms ease-out',
                }}
              >
                {isScheduleSidebarVisible && scheduleSidebarContent}
              </aside>
            )}

            {isMobile ? (
              <MobileBottomSheet
                mobileSheetHeight={mobileSheetHeight}
                isDraggingRef={isDraggingSheetRef}
                anyMobilePanelVisible={anyMobilePanelVisible}
                showMobileHint={showMobileHint}
                isConfigPanelVisible={isConfigPanelVisible}
                isScheduleSidebarVisible={isScheduleSidebarVisible}
                configPanelContent={configPanelContent}
                scheduleSidebarContent={scheduleSidebarContent}
                inspectorContent={inspectorContent}
                onTouchStart={handleSheetTouchStart}
                onTouchMove={handleSheetTouchMove}
                onTouchEnd={handleSheetTouchEnd}
                onMouseDown={handleSheetMouseDown}
              />
            ) : (
              <DesktopInspectorPanel
                isInspectorVisible={isInspectorVisible}
                inspectorWidth={inspectorWidth}
                isInspectorResizing={isInspectorResizing}
                inspectorContent={inspectorContent}
                onResizeStart={handleInspectorResizeStart}
              />
            )}
          </main>

          {/* Desktop terminal dock panel — hidden on mobile */}
          {!isMobile && terminalDockContent}
        </div>
      </div>
      {scheduleDrawer}
      {runDialog}
      <HumanInputDialog />
    </div>
  );
}
