import { useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowUiStore, type DockedTerminal } from '@/store/workflowUiStore';
import { NodeTerminalPanel } from './NodeTerminalPanel';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';

// ---------------------------------------------------------------------------
// Status dot styling — mirrors ExecutionTabs pattern
// ---------------------------------------------------------------------------
const STATUS_DOT: Record<DockedTerminal['status'], string> = {
  idle: 'bg-slate-400',
  running: 'bg-green-500 animate-pulse',
  completed: 'bg-slate-400',
  failed: 'bg-red-500',
};

const STATUS_LABEL: Record<DockedTerminal['status'], string> = {
  idle: 'Idle',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

function truncateName(name: string, maxLength = 18): string {
  return name.length > maxLength ? `${name.slice(0, maxLength)}…` : name;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TAB_BAR_HEIGHT = 36; // px
const MIN_PANEL_HEIGHT = 150; // px
const MAX_PANEL_RATIO = 0.7; // 70 % of viewport

/**
 * VS Code-style resizable bottom dock panel with tabbed terminal sessions.
 *
 * Three visual states:
 *   - **Hidden** — no docked terminals → renders nothing.
 *   - **Collapsed** — tab bar only (~36 px).
 *   - **Expanded** — tab bar + active terminal at `terminalPanelHeight`.
 */
export function TerminalDockPanel() {
  // ----- Store selectors (granular to minimize re-renders) ----- //
  const dockedTerminals = useWorkflowUiStore((s) => s.dockedTerminals);
  const activeDockedTerminalId = useWorkflowUiStore((s) => s.activeDockedTerminalId);
  const terminalPanelHeight = useWorkflowUiStore((s) => s.terminalPanelHeight);
  const terminalPanelCollapsed = useWorkflowUiStore((s) => s.terminalPanelCollapsed);

  const undockTerminal = useWorkflowUiStore((s) => s.undockTerminal);
  const setActiveDockedTerminal = useWorkflowUiStore((s) => s.setActiveDockedTerminal);
  const setTerminalPanelHeight = useWorkflowUiStore((s) => s.setTerminalPanelHeight);
  const toggleTerminalPanelCollapsed = useWorkflowUiStore((s) => s.toggleTerminalPanelCollapsed);

  // Timeline state for timelineSync prop on NodeTerminalPanel
  const playbackMode = useExecutionTimelineStore((s) => s.playbackMode);
  const isLiveFollowing = useExecutionTimelineStore((s) => s.isLiveFollowing);
  const mode = useWorkflowUiStore((s) => s.mode);

  // ----- Resize handling (mirrors inspector resize pattern) ----- //
  const resizingRef = useRef(false);

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    resizingRef.current = true;
    document.body.classList.add('select-none');
    event.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!resizingRef.current) return;
      const newHeight = window.innerHeight - event.clientY;
      setTerminalPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.classList.remove('select-none');
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setTerminalPanelHeight]);

  // ----- Keyboard shortcuts ----- //
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+` — toggle collapsed
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        toggleTerminalPanelCollapsed();
        return;
      }

      // Ctrl+Shift+] — next tab
      if (e.ctrlKey && e.shiftKey && e.key === ']') {
        e.preventDefault();
        if (dockedTerminals.length <= 1) return;
        const idx = dockedTerminals.findIndex((t) => t.nodeId === activeDockedTerminalId);
        const next = (idx + 1) % dockedTerminals.length;
        setActiveDockedTerminal(dockedTerminals[next].nodeId);
        return;
      }

      // Ctrl+Shift+[ — previous tab
      if (e.ctrlKey && e.shiftKey && e.key === '[') {
        e.preventDefault();
        if (dockedTerminals.length <= 1) return;
        const idx = dockedTerminals.findIndex((t) => t.nodeId === activeDockedTerminalId);
        const prev = (idx - 1 + dockedTerminals.length) % dockedTerminals.length;
        setActiveDockedTerminal(dockedTerminals[prev].nodeId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    dockedTerminals,
    activeDockedTerminalId,
    toggleTerminalPanelCollapsed,
    setActiveDockedTerminal,
  ]);

  // ----- Render guard ----- //
  if (dockedTerminals.length === 0) return null;

  const activeTerminal = dockedTerminals.find((t) => t.nodeId === activeDockedTerminalId);
  const isCollapsed = terminalPanelCollapsed;

  const clampedHeight = Math.max(
    MIN_PANEL_HEIGHT,
    Math.min(terminalPanelHeight, window.innerHeight * MAX_PANEL_RATIO),
  );

  const panelHeight = isCollapsed ? TAB_BAR_HEIGHT : clampedHeight;

  const timelineSync = mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing);

  return (
    <div
      className="relative z-[40] border-t bg-background flex flex-col shrink-0"
      style={{
        height: panelHeight,
        transition: resizingRef.current ? 'none' : 'height 150ms ease-out',
      }}
    >
      {/* Resize handle */}
      {!isCollapsed && (
        <div
          className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize z-10 hover:bg-primary/20 transition-colors"
          onMouseDown={handleResizeStart}
          aria-label="Resize terminal panel"
          role="separator"
          aria-orientation="horizontal"
        />
      )}

      {/* Tab bar */}
      <TooltipProvider delayDuration={300}>
        <div
          className="flex items-center border-b bg-muted/40 px-2 shrink-0"
          style={{ height: TAB_BAR_HEIGHT }}
          role="tablist"
          aria-label="Terminal sessions"
        >
          <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
            {dockedTerminals.map((terminal) => {
              const isActive = terminal.nodeId === activeDockedTerminalId;
              return (
                <Tooltip key={terminal.nodeId}>
                  <TooltipTrigger asChild>
                    <button
                      role="tab"
                      aria-selected={isActive}
                      className={cn(
                        'group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        isActive
                          ? 'bg-background text-foreground shadow-sm border'
                          : 'text-muted-foreground',
                      )}
                      onClick={() => {
                        setActiveDockedTerminal(terminal.nodeId);
                      }}
                    >
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[terminal.status])}
                        aria-hidden="true"
                      />
                      <span className="truncate max-w-[120px]">{truncateName(terminal.label)}</span>

                      {/* Hover-reveal close button */}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Close ${terminal.label}`}
                        className={cn(
                          'ml-0.5 shrink-0 rounded p-0.5 transition-colors',
                          'hover:bg-destructive/20 hover:text-destructive',
                          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          undockTerminal(terminal.nodeId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            undockTerminal(terminal.nodeId);
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">{terminal.label}</p>
                    <p className="text-muted-foreground">
                      {STATUS_LABEL[terminal.status]}
                      {terminal.runId ? ` · ${terminal.runId.slice(0, 8)}` : ''}
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* Collapse / expand toggle */}
          <button
            type="button"
            className={cn(
              'ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
            onClick={toggleTerminalPanelCollapsed}
            aria-label={isCollapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
          >
            {isCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </TooltipProvider>

      {/* Terminal content */}
      {!isCollapsed && activeTerminal && (
        <div
          className="flex-1 min-h-0 overflow-hidden"
          role="tabpanel"
          aria-label={`Terminal: ${activeTerminal.label}`}
        >
          <NodeTerminalPanel
            key={activeTerminal.nodeId}
            nodeId={activeTerminal.nodeId}
            runId={activeTerminal.runId ?? null}
            onClose={() => undockTerminal(activeTerminal.nodeId)}
            timelineSync={timelineSync}
            embedded
          />
        </div>
      )}
    </div>
  );
}
