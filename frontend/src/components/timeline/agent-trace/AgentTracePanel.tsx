import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { getRunByIdFromCache } from '@/hooks/queries/useRunQueries';
import { useExecutionResult } from '@/hooks/queries/useExecutionQueries';
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution';
import type { AgentNodeOutput, AgentTracePanelProps, WorkflowRunResult } from './types';
import { ACTIVE_RUN_STATUSES, TERMINAL_STATUSES } from './constants';
import { extractAgentPrompt, extractAgentRunId } from './utils';
import { AgentRunCard } from './AgentRunCard';

export function AgentTracePanel({ runId }: AgentTracePanelProps) {
  const selectedNodeId = useExecutionTimelineStore((state) => state.selectedNodeId);
  const selectNode = useExecutionTimelineStore((state) => state.selectNode);
  const timelineEvents = useExecutionTimelineStore((state) => state.events);
  const setInspectorTab = useWorkflowUiStore((state) => state.setInspectorTab);
  const { runId: liveRunId, status: executionStatus } = useWorkflowExecution();

  const {
    data: resultData,
    isLoading: loading,
    error: queryError,
    refetch: refetchResult,
  } = useExecutionResult(runId);
  const error = queryError?.message ?? null;
  const outputs = useMemo(() => {
    if (!resultData) return {};
    const typed = resultData as WorkflowRunResult;
    return typed.result?.outputs ?? {};
  }, [resultData]);

  const selectedRun = runId ? getRunByIdFromCache(runId) : undefined;
  const runStatus = selectedRun?.status ?? null;
  const executionStatusUpper = executionStatus?.toUpperCase();
  const fallbackStatus =
    runId &&
    liveRunId === runId &&
    executionStatusUpper &&
    ACTIVE_RUN_STATUSES.has(executionStatusUpper)
      ? executionStatusUpper
      : null;
  const effectiveRunStatus = runStatus ?? fallbackStatus ?? null;
  const isActiveRun = Boolean(effectiveRunStatus && ACTIVE_RUN_STATUSES.has(effectiveRunStatus));

  const liveAgentSignals = useMemo(() => {
    const map = new Map<string, string>();
    timelineEvents.forEach((event) => {
      if (!event?.nodeId) {
        return;
      }
      const candidate = extractAgentRunId(event.data);
      if (candidate) {
        map.set(event.nodeId, candidate);
      }
    });
    return map;
  }, [timelineEvents]);

  const userPrompt = useMemo(() => extractAgentPrompt(outputs), [outputs]);

  const agentEntries = useMemo(() => {
    const entries = new Map<string, string>();

    liveAgentSignals.forEach((agentRunId, nodeId) => {
      entries.set(nodeId, agentRunId);
    });

    Object.entries(outputs).forEach(([nodeId, payload]) => {
      if (payload && typeof payload.agentRunId === 'string') {
        entries.set(nodeId, payload.agentRunId);
      }
    });

    return Array.from(entries.entries()).map(([nodeId, agentRunId]) => {
      const payload = outputs[nodeId];
      const responseText =
        payload &&
        typeof payload === 'object' &&
        typeof (payload as AgentNodeOutput).responseText === 'string'
          ? (payload as AgentNodeOutput).responseText
          : undefined;
      return {
        nodeId,
        agentRunId,
        prompt: userPrompt,
        responseText,
      };
    });
  }, [liveAgentSignals, outputs, userPrompt]);

  const hasEntries = agentEntries.length > 0;
  const isTerminalRun = Boolean(effectiveRunStatus && TERMINAL_STATUSES.has(effectiveRunStatus));

  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Select a workflow run to inspect agent reasoning.
      </div>
    );
  }

  if (loading && !hasEntries) {
    if (isActiveRun) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <p>Waiting for agent outputs…</p>
          <p className="text-xs">
            Agent reasoning will appear here once an AI agent node begins execution.
          </p>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Loading agent outputs…
      </div>
    );
  }

  if (error && !hasEntries) {
    if (isTerminalRun) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <p>No AI agent outputs available for this run.</p>
          <p className="text-xs">
            {effectiveRunStatus === 'COMPLETED'
              ? 'This workflow completed without producing agent reasoning data.'
              : `This run was ${effectiveRunStatus?.toLowerCase() ?? 'ended'} before agent outputs were recorded.`}
          </p>
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-destructive">Failed to load agent trace.</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => refetchResult()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!hasEntries) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <p>No AI agent outputs were recorded for this run.</p>
        <p>Run a workflow that includes the core.ai.agent component to view reasoning steps.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-background/40">
      <div className="border-b bg-background/80 px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>
            {agentEntries.length} agent node{agentEntries.length === 1 ? '' : 's'} captured
            reasoning for this run. Select a node to highlight it on the timeline.
          </span>
          {isActiveRun && (
            <span className="font-semibold uppercase tracking-wide text-emerald-600">Live</span>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-4 p-4">
        {agentEntries.map(({ nodeId, agentRunId, prompt: agentPrompt, responseText }) => (
          <AgentRunCard
            key={nodeId}
            nodeId={nodeId}
            agentRunId={agentRunId}
            runId={runId as string}
            live={isActiveRun && runId === liveRunId}
            isSelected={selectedNodeId === nodeId}
            prompt={agentPrompt}
            responseText={responseText}
            onFocus={() => {
              selectNode(nodeId);
              setInspectorTab('events');
            }}
          />
        ))}
      </div>
    </div>
  );
}
