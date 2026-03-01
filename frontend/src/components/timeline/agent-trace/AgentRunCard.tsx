import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { cn } from '@/lib/utils';
import type { AgentRunCardProps } from './types';
import { extractAssistantText, chunksToMessages } from './utils';
import { useAgentTranscript } from './hooks/useAgentTranscript';
import { useAgentChatTransport } from './hooks/useAgentChatTransport';
import { AgentTranscriptTimeline } from './AgentTranscriptTimeline';

export function AgentRunCard({
  nodeId,
  agentRunId,
  runId,
  live,
  isSelected,
  onFocus,
  prompt,
  responseText,
}: AgentRunCardProps) {
  const {
    loading,
    error,
    cursor,
    messages: initialMessages,
    parts,
    steps,
  } = useAgentTranscript(agentRunId);
  const transport = useAgentChatTransport(agentRunId);
  const { messages, sendMessage, status, setMessages } = useChat({
    id: agentRunId,
    transport: transport ?? undefined,
    messages: [],
  });
  const [visibleMessages, setVisibleMessages] = useState<UIMessage[]>(messages);
  const hydratedRef = useRef(false);
  const startedRef = useRef(false);
  const lastReplaySequenceRef = useRef<number | null>(null);
  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode);
  const timelineStartTime = useExecutionTimelineStore((state) => state.timelineStartTime);
  const timelineCurrentTime = useExecutionTimelineStore((state) => state.currentTime);
  const selectedTimelineRunId = useExecutionTimelineStore((state) => state.selectedRunId);
  const setAgentMarkers = useExecutionTimelineStore((state) => state.setAgentMarkers);

  const sequenceBoundary = useMemo(() => {
    if (!parts || parts.length === 0) {
      return 0;
    }
    const lastSequence = parts[parts.length - 1]?.sequence ?? 0;
    const isReplayForRun = playbackMode === 'replay' && runId && selectedTimelineRunId === runId;
    if (!isReplayForRun || !timelineStartTime) {
      return lastSequence;
    }
    const cutoffTimestamp = timelineStartTime + timelineCurrentTime;
    let boundary = 0;
    for (const entry of parts) {
      const entryTime = new Date(entry.timestamp).getTime();
      if (entryTime <= cutoffTimestamp) {
        boundary = entry.sequence;
      } else {
        break;
      }
    }
    return boundary;
  }, [parts, playbackMode, runId, selectedTimelineRunId, timelineStartTime, timelineCurrentTime]);

  const finalAssistantText = useMemo(() => {
    if (typeof responseText === 'string' && responseText.trim().length > 0) {
      return responseText;
    }
    return extractAssistantText(visibleMessages);
  }, [responseText, visibleMessages]);

  const visibleSteps = useMemo(() => {
    if (!sequenceBoundary) {
      return [];
    }
    return steps.filter((step) => step.sequence <= sequenceBoundary);
  }, [steps, sequenceBoundary]);
  const finalSequence = parts?.length ? parts[parts.length - 1]!.sequence : 0;

  useEffect(() => {
    if (!hydratedRef.current && initialMessages) {
      setMessages(initialMessages);
      hydratedRef.current = true;
    }
  }, [initialMessages, setMessages]);

  useEffect(() => {
    if (!live || startedRef.current || !transport || !hydratedRef.current) {
      return;
    }
    startedRef.current = true;
    void sendMessage(undefined, {
      body: cursor > 0 ? { cursor } : undefined,
    });
  }, [live, cursor, sendMessage, transport]);

  useEffect(() => {
    const isReplayForRun = playbackMode === 'replay' && runId && selectedTimelineRunId === runId;
    if (!isReplayForRun) {
      lastReplaySequenceRef.current = null;
      setVisibleMessages(messages);
    }
  }, [messages, playbackMode, runId, selectedTimelineRunId]);

  useEffect(() => {
    if (!sequenceBoundary) {
      lastReplaySequenceRef.current = 0;
      setVisibleMessages([]);
      return;
    }
    const finalSeq = parts?.length ? parts[parts.length - 1]!.sequence : sequenceBoundary;
    if (sequenceBoundary >= finalSeq) {
      lastReplaySequenceRef.current = finalSeq;
      setVisibleMessages(messages);
      return;
    }
    if (lastReplaySequenceRef.current === sequenceBoundary) {
      return;
    }
    lastReplaySequenceRef.current = sequenceBoundary;
    const subsetChunks =
      parts?.filter((entry) => entry.sequence <= sequenceBoundary).map((entry) => entry.chunk) ??
      [];
    let cancelled = false;
    void (async () => {
      const subsetMessages = await chunksToMessages(subsetChunks);
      if (!cancelled && lastReplaySequenceRef.current === sequenceBoundary) {
        setVisibleMessages(subsetMessages);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequenceBoundary, parts, messages]);

  useEffect(() => {
    if (!runId) {
      return;
    }
    const markers =
      steps
        ?.filter((step) => step.startedAt)
        .map((step) => ({
          id: `${agentRunId}-${step.key}`,
          nodeId,
          label: step.toolName
            ? `${step.toolName}${step.stepNumber ? ` • Step ${step.stepNumber}` : ''}`
            : step.stepNumber
              ? `Step ${step.stepNumber}`
              : 'Agent step',
          timestamp: step.startedAt!,
        })) ?? [];
    setAgentMarkers(runId, nodeId, markers);
  }, [agentRunId, nodeId, runId, steps, setAgentMarkers]);

  useEffect(() => {
    return () => {
      if (runId) {
        setAgentMarkers(runId, nodeId, []);
      }
    };
  }, [runId, nodeId, setAgentMarkers]);

  return (
    <div
      className={cn(
        'rounded-lg border bg-background shadow-sm',
        isSelected && 'border-primary shadow-primary/20',
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/50">
        <div>
          <p className="text-sm font-semibold">{nodeId}</p>
          <p className="text-xs text-muted-foreground">Run {agentRunId.slice(-8)}</p>
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <Badge variant="default" className="bg-emerald-600 text-white animate-pulse">
              Live
            </Badge>
          )}
          <Button size="sm" variant={isSelected ? 'default' : 'outline'} onClick={onFocus}>
            {isSelected ? 'Focused' : 'Focus in timeline'}
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {loading && <p className="text-xs text-muted-foreground">Hydrating transcript…</p>}
        {error && (
          <div className="text-xs text-destructive">Failed to load transcript: {error}</div>
        )}
        {!loading && !error && (
          <AgentTranscriptTimeline
            prompt={prompt}
            steps={visibleSteps}
            finalText={
              finalAssistantText && sequenceBoundary >= finalSequence ? finalAssistantText : null
            }
          />
        )}
        {live && (
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Status: {status}
          </p>
        )}
      </div>
    </div>
  );
}
