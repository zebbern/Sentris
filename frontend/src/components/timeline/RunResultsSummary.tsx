import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/utils/timeFormat';
import { useExecutionNodeIO } from '@/hooks/queries/useExecutionQueries';
import { useRunArtifacts } from '@/hooks/queries/useArtifactQueries';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';
import {
  ChevronDown,
  ChevronRight,
  BarChart3,
  Clock,
  Paperclip,
  CheckCircle2,
  XCircle,
  SkipForward,
  Loader2,
  Sparkles,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeStatusCounts {
  passed: number;
  failed: number;
  skipped: number;
  running: number;
  total: number;
}

interface RunResultsSummaryProps {
  runId: string;
  selectedRun: ExecutionRun;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveNodeStatusCounts(nodes: { status?: string }[] | undefined): NodeStatusCounts {
  const counts: NodeStatusCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    running: 0,
    total: 0,
  };

  if (!nodes) return counts;

  for (const node of nodes) {
    counts.total++;
    switch (node.status) {
      case 'completed':
        counts.passed++;
        break;
      case 'failed':
        counts.failed++;
        break;
      case 'skipped':
        counts.skipped++;
        break;
      case 'running':
        counts.running++;
        break;
      default:
        // Count unknown statuses toward total only
        break;
    }
  }

  return counts;
}

function formatRunDuration(run: ExecutionRun): string {
  if (run.duration != null && run.duration > 0) {
    return formatDuration(run.duration);
  }
  if (run.startTime && run.endTime) {
    const ms = new Date(run.endTime).getTime() - new Date(run.startTime).getTime();
    return ms > 0 ? formatDuration(ms) : '—';
  }
  return 'running…';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Collapsible summary banner displayed above the timeline when a terminal
 * run is selected. Shows pass/fail/skip node counts, duration, artifact
 * count, and a placeholder for future AI summaries.
 */
export function RunResultsSummary({ runId, selectedRun, className }: RunResultsSummaryProps) {
  const [isOpen, setIsOpen] = useState(true);
  const setInspectorTab = useWorkflowUiStore((s) => s.setInspectorTab);

  // ---- Data fetching via existing hooks ----
  const { data: rawNodeIOData, isLoading: isLoadingNodes } = useExecutionNodeIO(runId);
  const { data: artifacts } = useRunArtifacts(runId);

  const nodeStatusCounts = useMemo(
    () => deriveNodeStatusCounts(rawNodeIOData?.nodes),
    [rawNodeIOData?.nodes],
  );

  const artifactCount = artifacts?.length ?? 0;
  const duration = formatRunDuration(selectedRun);

  // Don't render while node I/O data is not yet available
  if (isLoadingNodes || !rawNodeIOData) return null;

  // ---- Collapsed summary line ----
  const collapsedSummary = `${nodeStatusCounts.passed}/${nodeStatusCounts.total} passed · ${duration} · ${artifactCount} artifact${artifactCount !== 1 ? 's' : ''}`;

  return (
    <div className={cn('px-3 py-2 border-b', className)}>
      <Card className="overflow-hidden">
        {/* Header / trigger */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
          aria-expanded={isOpen}
        >
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3
              className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {isOpen ? (
              <span className="text-xs font-medium">Run Summary</span>
            ) : (
              <span className="text-xs text-muted-foreground truncate">{collapsedSummary}</span>
            )}
          </div>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Expanded content */}
        {isOpen && (
          <div className="border-t px-3 py-2.5 space-y-2">
            {/* Node status badges */}
            <div className="flex flex-wrap items-center gap-1.5">
              {nodeStatusCounts.passed > 0 && (
                <Badge variant="success" className="gap-1 text-[10px] px-1.5 py-0">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  {nodeStatusCounts.passed} passed
                </Badge>
              )}
              {nodeStatusCounts.failed > 0 && (
                <Badge variant="destructive" className="gap-1 text-[10px] px-1.5 py-0">
                  <XCircle className="h-3 w-3" aria-hidden="true" />
                  {nodeStatusCounts.failed} failed
                </Badge>
              )}
              {nodeStatusCounts.skipped > 0 && (
                <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0">
                  <SkipForward className="h-3 w-3" aria-hidden="true" />
                  {nodeStatusCounts.skipped} skipped
                </Badge>
              )}
              {nodeStatusCounts.running > 0 && (
                <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0 animate-pulse">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  {nodeStatusCounts.running} running
                </Badge>
              )}
            </div>

            {/* Duration + Artifacts row */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {duration}
              </span>
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setInspectorTab('artifacts');
                }}
                title="View artifacts"
              >
                <Paperclip className="h-3 w-3" aria-hidden="true" />
                {artifactCount} artifact{artifactCount !== 1 ? 's' : ''}
              </button>
            </div>

            {/* AI summary placeholder */}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              <span className="text-xs italic">AI summary will appear here</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
