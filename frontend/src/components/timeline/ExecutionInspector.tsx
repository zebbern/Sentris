import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RunSelector } from '@/components/timeline/RunSelector';
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline';
import { EventInspector } from '@/components/timeline/EventInspector';
import { Button } from '@/components/ui/button';
import { MessageModal } from '@/components/ui/MessageModal';
import { Globe, Loader2, FileSearch, Sparkles } from 'lucide-react';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { logger } from '@/lib/logger';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { useParams } from 'react-router-dom';
import { useWorkflowRuns } from '@/hooks/queries/useRunQueries';
import { cn } from '@/lib/utils';
import type { ExecutionLog } from '@/schemas/execution';
import { RunArtifactsPanel } from '@/components/artifacts/RunArtifactsPanel';
import { AgentTracePanel } from '@/components/timeline/AgentTracePanel';
import { NodeIOInspector } from '@/components/timeline/NodeIOInspector';
import { NetworkPanel } from '@/components/timeline/NetworkPanel';
import { FindingsPanel } from '@/components/timeline/FindingsPanel';
import { getTriggerDisplay } from '@/utils/triggerDisplay';
import { ExecutionTabs } from '@/components/execution/ExecutionTabs';
import { RunResultsSummary } from '@/components/timeline/RunResultsSummary';
import { useAutoFocusOnCompletion } from '@/hooks/useAutoFocusOnCompletion';
import { useRunArtifacts } from '@/hooks/queries/useArtifactQueries';
import { useExecutionNodeIO } from '@/hooks/queries/useExecutionQueries';
import { TERMINAL_STATUSES } from '@sentris/shared';
import { createOperatorImproveRunNavigationState } from '@/features/operator/operatorHandoff';

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};

const formatStructured = (value: Record<string, unknown>) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error: unknown) {
    logger.error('Failed to stringify structured log data', error);
    return String(value);
  }
};

const buildLogMessage = (log: ExecutionLog): string => {
  const sections: string[] = [];

  const primaryMessage = (log.message ?? log.error?.message)?.trim();
  sections.push(primaryMessage && primaryMessage.length > 0 ? primaryMessage : log.type);

  if (log.outputSummary && Object.keys(log.outputSummary).length > 0) {
    sections.push(`Output summary:\n${formatStructured(log.outputSummary)}`);
  }

  if (log.data && Object.keys(log.data).length > 0) {
    sections.push(`Data:\n${formatStructured(log.data)}`);
  }

  if (log.error?.stack?.trim()) {
    sections.push(`Stack trace:\n${log.error.stack.trim()}`);
  }

  return sections.join('\n\n').trim();
};

const LOG_LEVEL_OPTIONS = ['all', 'error', 'warn', 'info', 'debug'] as const;
type LogLevelFilter = (typeof LOG_LEVEL_OPTIONS)[number];
const LOG_LEVEL_LABELS: Record<LogLevelFilter, string> = {
  all: 'All',
  error: 'Error',
  warn: 'Warn',
  info: 'Info',
  debug: 'Debug',
};
const LOG_LEVEL_TONES: Record<string, { text: string; accent: string }> = {
  error: { text: 'text-red-300', accent: 'border-red-400/60 bg-red-400/10' },
  warn: { text: 'text-amber-200', accent: 'border-amber-300/60 bg-amber-300/10' },
  info: { text: 'text-sky-200', accent: 'border-sky-300/60 bg-sky-300/10' },
  debug: { text: 'text-slate-300', accent: 'border-slate-300/60 bg-slate-200/10' },
  default: { text: 'text-slate-200', accent: 'border-slate-400/40 bg-slate-700/20' },
};
const LOG_LEVEL_ORDER: Record<Exclude<LogLevelFilter, 'all'>, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};
const normalizeLevel = (level?: string | null) => (level ?? '').toLowerCase();
const getLogLevelTone = (level?: string | null) => {
  const normalized = normalizeLevel(level);
  return LOG_LEVEL_TONES[normalized] ?? LOG_LEVEL_TONES.default;
};

interface ExecutionInspectorProps {
  onRerunRun?: (runId: string) => void;
}

const MIN_TIMELINE_HEIGHT = 10;
const MAX_TIMELINE_HEIGHT = 320;
const DEFAULT_TIMELINE_HEIGHT = 320;

const INSPECTOR_TABS = [
  { id: 'events', label: 'Events' },
  { id: 'logs', label: 'Logs' },
  { id: 'agent', label: 'Agent' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'io', label: 'I/O' },
  { id: 'findings', label: 'Findings', icon: FileSearch },
  { id: 'network', label: 'Network', icon: Globe },
] as const;

export function ExecutionInspector({ onRerunRun }: ExecutionInspectorProps = {}) {
  const { runId: routeRunId } = useParams<{ runId?: string }>();
  const selectedRunId = useExecutionTimelineStore((s) => s.selectedRunId);
  const playbackMode = useExecutionTimelineStore((s) => s.playbackMode);
  const isPlaying = useExecutionTimelineStore((s) => s.isPlaying);
  const { id: workflowId } = useWorkflowStore((state) => state.metadata);
  const { data: runsPage, isLoading: isLoadingRuns } = useWorkflowRuns(workflowId);
  const runs = runsPage?.runs ?? [];
  const { status, runStatus, runId: liveRunId } = useWorkflowExecution();
  const inspectorTab = useWorkflowUiStore((s) => s.inspectorTab);
  const setInspectorTab = useWorkflowUiStore((s) => s.setInspectorTab);
  const getDisplayLogs = useExecutionStore((s) => s.getDisplayLogs);
  const setLogMode = useExecutionStore((s) => s.setLogMode);
  const [logModal, setLogModal] = useState<{ open: boolean; message: string; title: string }>({
    open: false,
    message: '',
    title: '',
  });
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('all');
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);
  const isResizingTimeline = useRef(false);
  const userOverrodeTab = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rawLogs = getDisplayLogs();
  const navigate = useNavigate();

  // Timeout for run loading: if a routeRunId is set but selectedRun never appears,
  // show an error after 12 seconds instead of spinning indefinitely.
  const [runLoadTimedOut, setRunLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!routeRunId || selectedRunId) {
      setRunLoadTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setRunLoadTimedOut(true), 12_000);
    return () => clearTimeout(timer);
  }, [routeRunId, selectedRunId]);

  // Vertical resize handlers for timeline section
  const handleTimelineResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isResizingTimeline.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMove = (clientY: number) => {
      if (!isResizingTimeline.current || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const newHeight = clientY - rect.top;
      const clampedHeight = Math.min(MAX_TIMELINE_HEIGHT, Math.max(MIN_TIMELINE_HEIGHT, newHeight));
      setTimelineHeight(clampedHeight);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleMove(touch.clientY);
    };

    const handleEnd = () => {
      isResizingTimeline.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, []);
  const filteredLogs = useMemo(() => {
    if (logLevelFilter === 'all') {
      return rawLogs;
    }
    const threshold = LOG_LEVEL_ORDER[logLevelFilter];
    return rawLogs.filter((log) => {
      const normalized = normalizeLevel(log.level);
      const value =
        LOG_LEVEL_ORDER[normalized as keyof typeof LOG_LEVEL_ORDER] ?? LOG_LEVEL_ORDER.debug;
      return value <= threshold;
    });
  }, [rawLogs, logLevelFilter]);
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId),
    [runs, selectedRunId],
  );
  const triggerDisplay = selectedRun
    ? getTriggerDisplay(selectedRun.triggerType, selectedRun.triggerLabel)
    : null;

  // --- Auto-focus: switch to the most relevant tab on run completion ---
  const { data: nodeIOData } = useExecutionNodeIO(selectedRunId);
  const { data: runArtifacts, isFetching: artifactsFetching } = useRunArtifacts(
    selectedRunId ?? undefined,
  );

  const hasAgentTrace = useMemo(() => {
    const nodes = nodeIOData?.nodes ?? [];
    return nodes.some((n: { componentId?: string }) =>
      (n.componentId ?? '').startsWith('core.ai.'),
    );
  }, [nodeIOData]);

  const selectNode = useExecutionTimelineStore((s) => s.selectNode);

  const autoFocusAnnouncement = useAutoFocusOnCompletion({
    selectedRunId,
    runStatus: selectedRun?.status,
    nodeIOData: nodeIOData as
      | {
          nodes: {
            nodeRef: string;
            componentId: string;
            status: string;
            outputs: Record<string, unknown> | null;
          }[];
        }
      | undefined,
    artifactCount: runArtifacts?.length ?? 0,
    artifactsFetching,
    hasAgentTrace,
    setInspectorTab,
    selectNode,
    userOverrodeTab,
  });

  const handleTabClick = useCallback(
    (tab: typeof inspectorTab) => {
      userOverrodeTab.current = true;
      setInspectorTab(tab);
    },
    [setInspectorTab],
  );

  useEffect(() => {
    // Switch log mode based on timeline playback mode
    if (playbackMode === 'live') {
      setLogMode('live');
    } else if (playbackMode === 'replay') {
      // For replay mode, use historical logs initially (scrubbing mode is only for timeline scrubbing)
      setLogMode('historical');
    }
  }, [playbackMode, setLogMode]);

  const openLogModal = (fullMessage: string, log: ExecutionLog) => {
    const titleParts = [
      'Log message',
      log.nodeId ? `Node ${log.nodeId}` : null,
      formatTime(log.timestamp),
    ].filter(Boolean);

    setLogModal({
      open: true,
      message: fullMessage,
      title: titleParts.join(' • '),
    });
  };

  return (
    <>
      {/* Screen reader announcement for auto-focus tab changes */}
      <div aria-live="polite" className="sr-only">
        {autoFocusAnnouncement}
      </div>
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        {/* Multi-run tab bar — only visible when 2+ runs are tracked */}
        <ExecutionTabs />
        {/* Header - Run Selector */}
        <div className="border-b px-3 py-2.5 flex items-center justify-between gap-2">
          <RunSelector
            onRerun={onRerunRun}
            runsPage={runsPage ?? null}
            isLoadingRuns={isLoadingRuns}
          />
          <div className="flex shrink-0 items-center gap-2">
            {selectedRun && TERMINAL_STATUSES.includes(selectedRun.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() =>
                  navigate('/operator', {
                    state: createOperatorImproveRunNavigationState(
                      selectedRun.id,
                      `/workflows/${workflowId}/runs/${selectedRun.id}`,
                    ),
                  })
                }
                aria-label="Improve this run with Operator"
                title="Improve this run with Operator"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Improve
              </Button>
            ) : null}
            {runStatus?.progress &&
              selectedRunId === liveRunId &&
              (status === 'running' || status === 'queued') && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {runStatus.progress.completedActions}/{runStatus.progress.totalActions}
                </span>
              )}
          </div>
        </div>

        {/* Run Results Summary Banner — only for terminal runs */}
        {selectedRun && TERMINAL_STATUSES.includes(selectedRun.status) && (
          <RunResultsSummary runId={selectedRunId!} selectedRun={selectedRun} />
        )}

        {!selectedRun && (
          <div className="px-3 py-4 border-b text-xs text-muted-foreground text-center">
            {routeRunId && runLoadTimedOut ? (
              <div className="flex flex-col items-center gap-2 py-2">
                <p className="text-sm font-medium text-destructive">Run not found</p>
                <p className="text-xs text-muted-foreground">
                  This execution may have been deleted or is no longer available.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() => navigate(`/workflows/${workflowId}`, { replace: true })}
                >
                  Back to workflow
                </Button>
              </div>
            ) : routeRunId ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading run…
              </span>
            ) : (
              'Select a run to explore'
            )}
          </div>
        )}

        {/* Timeline - Vertically Resizable */}
        <div
          ref={timelineRef}
          className="flex-shrink-0 relative"
          style={{ height: timelineHeight }}
        >
          {selectedRun ? (
            <div className="h-full overflow-hidden">
              <ExecutionTimeline />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              {routeRunId && !runLoadTimedOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Select a run to view timeline'
              )}
            </div>
          )}
          {/* Vertical Resize Handle - More visible */}
          <div
            onMouseDown={handleTimelineResizeStart}
            onTouchStart={handleTimelineResizeStart}
            className="absolute bottom-0 left-0 right-0 h-3 cursor-row-resize group z-10 flex items-center justify-center touch-none"
          >
            <div className="w-12 h-1 rounded-full bg-border group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
          </div>
        </div>
        <div className="border-b" />

        {/* Tabs — equal-width segments that fill the inspector panel */}
        <div className="flex min-w-0 items-center gap-2 border-b bg-muted/20 px-2 py-2">
          <div
            className="flex min-w-0 flex-1 rounded-md border bg-background p-0.5 text-xs"
            role="tablist"
            aria-label="Inspector views"
          >
            {INSPECTOR_TABS.map((tab) => {
              const Icon = 'icon' in tab ? tab.icon : null;
              const isActive = inspectorTab === tab.id;
              return (
                <Button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  variant={isActive ? 'default' : 'ghost'}
                  size="sm"
                  title={tab.label}
                  className="h-6 min-w-0 flex-1 gap-1 overflow-hidden px-1 text-xs"
                  onClick={() => handleTabClick(tab.id)}
                >
                  {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                  <span className="min-w-0 truncate">{tab.label}</span>
                </Button>
              );
            })}
          </div>
          {inspectorTab === 'logs' && (
            <select
              value={logLevelFilter}
              onChange={(event) => setLogLevelFilter(event.target.value as LogLevelFilter)}
              className="h-6 shrink-0 rounded border bg-background px-1.5 text-[11px]"
              aria-label="Log level filter"
            >
              {LOG_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {LOG_LEVEL_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {inspectorTab === 'events' && (
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              <EventInspector className="h-full" />
            </div>
          )}

          {inspectorTab === 'logs' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-background/70 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{`${filteredLogs.length} log entries`}</span>
                  {triggerDisplay && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                      <span aria-hidden="true">{triggerDisplay.icon}</span>
                      Triggered by {triggerDisplay.label}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'font-medium',
                    playbackMode === 'live' ? 'text-green-600' : 'text-blue-600',
                  )}
                >
                  {playbackMode === 'live'
                    ? isPlaying
                      ? 'Live (following)'
                      : 'Live paused'
                    : 'Execution playback'}
                </span>
              </div>
              <div className="flex-1 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs">
                {filteredLogs.length === 0 ? (
                  <div className="text-slate-400 text-center py-8">
                    {rawLogs.length === 0
                      ? 'No logs to display for this run.'
                      : 'No logs match the selected filter.'}
                  </div>
                ) : (
                  <div className="p-2 space-y-0 min-w-max">
                    {filteredLogs.map((log) => {
                      const executionLog = log as ExecutionLog;
                      const fullMessage = buildLogMessage(executionLog);
                      const time = formatTime(log.timestamp);
                      const level = (log.level ?? '').toUpperCase();
                      const node = log.nodeId ? `[${log.nodeId}]` : '';

                      // Color coding for log levels
                      // Check for JSON and format nicely
                      let displayMessage = fullMessage;
                      let isJson = false;
                      try {
                        const parsed = JSON.parse(fullMessage.trim());
                        if (typeof parsed === 'object' && parsed !== null) {
                          displayMessage = JSON.stringify(parsed, null, 2);
                          isJson = true;
                        }
                      } catch {
                        // Not JSON, use as-is
                      }

                      // Truncate long messages
                      const maxLength = 150;
                      const isTruncated = displayMessage.length > maxLength;
                      const truncatedMessage = isTruncated
                        ? displayMessage.substring(0, maxLength) + '...'
                        : displayMessage;

                      const tone = getLogLevelTone(log.level);

                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'group cursor-pointer rounded border-l-2 px-2 py-1 leading-none transition-colors',
                            tone.accent,
                            'hover:bg-white/5',
                          )}
                          onClick={() => openLogModal(fullMessage, executionLog)}
                        >
                          <div className="flex items-start gap-1">
                            <span
                              className={cn('text-[10px] font-mono flex-shrink-0 w-12', tone.text)}
                            >
                              {time}
                            </span>
                            <span
                              className={cn(
                                'text-[10px] font-bold uppercase flex-shrink-0 w-12',
                                tone.text,
                              )}
                            >
                              {level}
                            </span>
                            {node && (
                              <span
                                className={cn(
                                  'text-[10px] flex-shrink-0 max-w-16 truncate',
                                  tone.text,
                                )}
                              >
                                {node}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <pre
                                className={cn(
                                  'text-[11px] leading-tight',
                                  tone.text,
                                  isJson
                                    ? 'whitespace-pre-wrap'
                                    : 'whitespace-nowrap overflow-hidden text-ellipsis',
                                )}
                              >
                                {truncatedMessage}
                              </pre>
                            </div>
                            <span className="sticky right-0 z-10 flex-shrink-0 bg-slate-900/90 text-blue-400 text-[9px] leading-tight px-1.5 py-px rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                              click to expand
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {inspectorTab === 'artifacts' && <RunArtifactsPanel runId={selectedRunId ?? null} />}

          {inspectorTab === 'agent' && <AgentTracePanel runId={selectedRunId ?? null} />}

          {inspectorTab === 'io' && <NodeIOInspector />}

          {inspectorTab === 'findings' && <FindingsPanel runId={selectedRunId ?? null} />}

          {inspectorTab === 'network' && <NetworkPanel />}
        </div>
      </aside>
      <MessageModal
        open={logModal.open}
        onOpenChange={(open) => setLogModal((prev) => ({ ...prev, open }))}
        title={logModal.title || 'Log message'}
        message={logModal.message}
      />
    </>
  );
}
