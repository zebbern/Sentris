import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { getRunByIdFromCache } from '@/hooks/queries/useRunQueries';
import { useExecutionNodeIO, useExecutionResult } from '@/hooks/queries/useExecutionQueries';
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution';
import type { AgentTracePanelProps, WorkflowRunResult } from './types';
import { ACTIVE_RUN_STATUSES, TERMINAL_STATUSES } from './constants';
import { extractAgentPrompt, extractAgentRunId } from './utils';
import { AgentRunCard } from './AgentRunCard';
import { AgentTranscriptTimeline } from './AgentTranscriptTimeline';

interface AgentPanelEntry {
  nodeId: string;
  agentRunId: string | null;
  prompt?: string | null;
  responseText?: string | null;
  sourceLabel?: string;
}

interface NodeIOAgentNode {
  nodeRef?: string | null;
  componentId?: string | null;
  inputs?: unknown;
  outputs?: unknown;
}

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
  const { data: nodeIOData } = useExecutionNodeIO(runId);
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
    const entries = new Map<string, AgentPanelEntry>();

    liveAgentSignals.forEach((agentRunId, nodeId) => {
      entries.set(nodeId, {
        nodeId,
        agentRunId,
        prompt: userPrompt,
      });
    });

    Object.entries(outputs).forEach(([nodeId, payload]) => {
      if (payload && typeof payload.agentRunId === 'string') {
        entries.set(nodeId, {
          nodeId,
          agentRunId: payload.agentRunId,
          prompt: userPrompt,
          responseText: extractAgentResponseText(payload),
        });
      }
    });

    const nodes: NodeIOAgentNode[] = Array.isArray((nodeIOData as { nodes?: unknown[] })?.nodes)
      ? ((nodeIOData as { nodes: NodeIOAgentNode[] }).nodes ?? [])
      : [];
    nodes.forEach((node) => {
      const nodeId = typeof node.nodeRef === 'string' ? node.nodeRef : null;
      if (!nodeId) {
        return;
      }
      const componentId = typeof node.componentId === 'string' ? node.componentId : '';
      const outputRecord = toRecord(node.outputs);
      const agentRunId =
        outputRecord && typeof outputRecord.agentRunId === 'string'
          ? outputRecord.agentRunId
          : null;
      const responseText = extractAgentResponseText(node.outputs);
      if (agentRunId) {
        entries.set(nodeId, {
          nodeId,
          agentRunId,
          prompt: extractNodePrompt(node.inputs) ?? userPrompt,
          responseText,
        });
        return;
      }
      if (!componentId.startsWith('core.ai.') || !responseText || entries.has(nodeId)) {
        return;
      }
      entries.set(nodeId, {
        nodeId,
        agentRunId: null,
        prompt: extractNodePrompt(node.inputs) ?? userPrompt,
        responseText,
        sourceLabel: getStoredOutputLabel(componentId),
      });
    });

    return Array.from(entries.values());
  }, [liveAgentSignals, nodeIOData, outputs, userPrompt]);

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
        <p>
          Run a workflow that includes an AI agent component to view reasoning steps or stored
          reports.
        </p>
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
        {agentEntries.map(
          ({ nodeId, agentRunId, prompt: agentPrompt, responseText, sourceLabel }) =>
            agentRunId ? (
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
            ) : (
              <AgentStoredOutputCard
                key={nodeId}
                nodeId={nodeId}
                isSelected={selectedNodeId === nodeId}
                prompt={agentPrompt}
                responseText={responseText}
                sourceLabel={sourceLabel ?? 'Stored AI output'}
                onFocus={() => {
                  selectNode(nodeId);
                  setInspectorTab('events');
                }}
              />
            ),
        )}
      </div>
    </div>
  );
}

function AgentStoredOutputCard({
  nodeId,
  isSelected,
  onFocus,
  prompt,
  responseText,
  sourceLabel,
}: {
  nodeId: string;
  isSelected: boolean;
  onFocus: () => void;
  prompt?: string | null;
  responseText?: string | null;
  sourceLabel: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-background shadow-sm ${
        isSelected ? 'border-primary shadow-primary/20' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
        <div>
          <p className="text-sm font-semibold">{nodeId}</p>
          <p className="text-xs text-muted-foreground">{sourceLabel}</p>
        </div>
        <Button size="sm" variant={isSelected ? 'default' : 'outline'} onClick={onFocus}>
          {isSelected ? 'Focused' : 'Focus in timeline'}
        </Button>
      </div>
      <div className="space-y-3 p-4">
        <AgentTranscriptTimeline prompt={prompt} steps={[]} finalText={responseText ?? null} />
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function extractAgentResponseText(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload;
  }
  if (!isRecord(payload)) {
    return null;
  }
  for (const key of ['responseText', 'report', 'summary']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function extractNodePrompt(inputs: unknown): string | null {
  if (!isRecord(inputs)) {
    return null;
  }
  for (const key of ['task', 'userInput', 'prompt']) {
    const value = inputs[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function getStoredOutputLabel(componentId: string): string {
  if (componentId === 'core.ai.claude-code') {
    return 'Stored Claude Code output';
  }
  if (componentId === 'core.ai.opencode') {
    return 'Stored OpenCode output';
  }
  return 'Stored AI output';
}
