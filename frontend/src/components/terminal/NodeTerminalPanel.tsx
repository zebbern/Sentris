import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Loader2, PlugZap, Radio, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTimelineTerminalStream } from '@/hooks/useTimelineTerminalStream';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useXterm } from './useXterm';
import { decodePayload } from './terminal-utils';

interface NodeTerminalPanelProps {
  nodeId: string;
  runId: string | null;
  onClose: () => void;
  /**
   * Enable timeline synchronization mode.
   * When enabled, terminal will update based on timeline position.
   */
  timelineSync?: boolean;
  /**
   * Called when the panel is focused (clicked/interacted with).
   * Used for bringing the panel to the front in z-index stacking.
   */
  onFocus?: () => void;
  /**
   * When true, the panel fills its container (no fixed w/h, no border/shadow).
   * Intended for embedding inside the dock panel.
   */
  embedded?: boolean;
}

export function NodeTerminalPanel({
  nodeId,
  runId,
  onClose,
  timelineSync = false,
  onFocus,
  embedded = false,
}: NodeTerminalPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastRenderedChunkIndex = useRef<number>(-1);
  const lastTimelineTimeRef = useRef<number | null>(null);
  const [terminalKey, setTerminalKey] = useState(0);

  const {
    containerRef,
    terminalRef,
    fitAddonRef,
    isTerminalReady,
    isXtermLoaded,
    xtermError,
    terminalReadyRef,
  } = useXterm(terminalKey);

  const currentTime = useExecutionTimelineStore((state) => state.currentTime);

  const {
    chunks,
    isHydrating,
    isStreaming,
    error,
    mode,
    exportText,
    isTimelineSync,
    isFetchingTimeline,
    hasData,
  } = useTimelineTerminalStream({
    runId,
    nodeId,
    stream: 'pty',
    autoConnect: true,
    timelineSync,
  });

  const session = useMemo(() => ({ chunks }), [chunks]);

  const { copy } = useCopyToClipboard();

  const copyToClipboard = useCallback(async () => {
    if (!chunks.length) return;
    const decoded = chunks
      .map((chunk) => {
        try {
          return atob(chunk.payload);
        } catch {
          return '';
        }
      })
      .join('');
    await copy(decoded, { successDescription: 'Terminal output copied to clipboard.' });
  }, [chunks, copy]);

  // SIMPLE RENDERING LOGIC:
  // - Forward: render new chunks incrementally
  // - Backward: reset terminal and render from start to current position
  useEffect(() => {
    // Wait for terminal to be ready (especially after recreation)
    if (
      !terminalRef.current ||
      !containerRef.current ||
      !terminalReadyRef.current ||
      !chunks ||
      chunks.length === 0 ||
      !isTerminalReady
    ) {
      lastTimelineTimeRef.current = currentTime;
      return;
    }

    // Detect backward seek
    const isSeekingBackward =
      timelineSync &&
      lastTimelineTimeRef.current !== null &&
      currentTime < lastTimelineTimeRef.current;

    if (isSeekingBackward) {
      // Backward: reset terminal and render all chunks from start
      setTerminalKey((k) => k + 1); // Recreate terminal
      lastRenderedChunkIndex.current = -1;
      lastTimelineTimeRef.current = currentTime;
      return; // Terminal will be recreated, this effect will run again
    }

    if (lastRenderedChunkIndex.current === -1) {
      terminalRef.current?.clear();
      terminalRef.current?.reset();
      for (const chunk of chunks) {
        const bytes = decodePayload(chunk.payload);
        if (bytes.length === 0) continue;
        terminalRef.current?.write(bytes);
        lastRenderedChunkIndex.current = chunk.chunkIndex;
      }
    } else {
      const newChunks = chunks.filter((chunk) => chunk.chunkIndex > lastRenderedChunkIndex.current);
      for (const chunk of newChunks) {
        if (!terminalRef.current) break;
        const bytes = decodePayload(chunk.payload);
        if (bytes.length === 0) continue;
        terminalRef.current.write(bytes);
        lastRenderedChunkIndex.current = chunk.chunkIndex;
      }
    }

    lastTimelineTimeRef.current = currentTime;

    // Fit terminal after rendering, with safety check
    if (fitAddonRef.current) {
      requestAnimationFrame(() => {
        if (fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch (_error: unknown) {
            // Ignore fit errors during terminal recreation
          }
        }
      });
    }
  }, [chunks, timelineSync, currentTime, terminalKey, isTerminalReady]);

  const streamBadge = isTimelineSync ? (
    <span className="flex items-center gap-1 text-xs text-purple-500 dark:text-purple-400">
      <PlugZap className="h-3 w-3" /> Timeline Sync
    </span>
  ) : isStreaming ? (
    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
      <Radio className="h-3 w-3 animate-pulse" /> Live
    </span>
  ) : mode === 'replay' ? (
    <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
      <PlugZap className="h-3 w-3" /> Replay
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <PlugZap className="h-3 w-3" /> Idle
    </span>
  );

  useEffect(() => {
    lastRenderedChunkIndex.current = -1;
    lastTimelineTimeRef.current = null;
    setTerminalKey((key) => key + 1);
  }, [runId, nodeId]);

  // Prevent wheel events from bubbling to ReactFlow (backup to nowheel class)
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleWheel = (event: WheelEvent) => {
      event.stopPropagation();
    };

    panel.addEventListener('wheel', handleWheel, { capture: false, passive: true });

    return () => {
      panel.removeEventListener('wheel', handleWheel, { capture: false });
    };
  }, []);

  // Handle focus for z-index stacking - listen at document level to catch all clicks
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onFocus) return;

    const handlePointerDown = (event: PointerEvent) => {
      // Check if the click is within this panel
      if (panel.contains(event.target as Node)) {
        onFocus();
      }
    };

    // Listen at document level with capture phase to intercept before any element handles it
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [onFocus]);

  return (
    <div
      ref={panelRef}
      // nodrag, nowheel, nopan: Prevent ReactFlow from intercepting mouse events in terminal
      // This fixes sticky selection issues caused by ReactFlow capturing mouse events
      className={cn(
        'nodrag nowheel nopan select-text overflow-hidden',
        embedded
          ? 'w-full h-full flex flex-col bg-card'
          : 'w-[520px] rounded-lg border-2 border-border bg-card shadow-lg',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div>
          <div className="text-xs uppercase tracking-wide text-foreground">
            Live Logs • {nodeId}
          </div>
          {streamBadge}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-foreground"
            onClick={copyToClipboard}
            disabled={!chunks.length}
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-foreground"
            onClick={() => exportText()}
            disabled={!chunks.length}
          >
            <Download className="h-3 w-3 mr-1" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={onClose}
            aria-label="Close terminal panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {(isHydrating || isFetchingTimeline) && (
        <div className="border-b border-border px-3 py-1 flex items-center gap-2 text-[11px] text-muted-foreground bg-card">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            {isFetchingTimeline ? 'Loading terminal output...' : 'Loading terminal output...'}
          </span>
        </div>
      )}
      <div
        className={cn('relative', embedded ? 'flex-1 min-h-0' : '')}
        style={{ backgroundColor: '#1e1e1e' }}
      >
        <div ref={containerRef} className={cn(embedded ? 'h-full w-full' : 'h-[360px] w-full')} />
        {!isXtermLoaded && !xtermError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading terminal…</span>
            </div>
          </div>
        )}
        {xtermError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-sm text-destructive text-center p-4">
              <div>Failed to load terminal</div>
              <div className="font-mono text-[10px] text-muted-foreground mt-1">{xtermError}</div>
            </div>
          </div>
        )}
        {!hasData && !session?.chunks?.length && isXtermLoaded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-sm text-foreground space-y-2 text-center p-4">
              <div>
                {isHydrating || isFetchingTimeline
                  ? 'Loading output…'
                  : 'Waiting for terminal output…'}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{nodeId} • pty</div>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive border-t border-border bg-destructive/10">
          {error}
        </div>
      )}
    </div>
  );
}
