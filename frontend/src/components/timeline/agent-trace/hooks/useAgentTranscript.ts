import { useEffect, useState } from 'react';
import type { UIMessageChunk } from 'ai';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import type { AgentTraceChunk, AgentTranscriptState } from '../types';
import { chunksToMessages, deriveAgentSteps } from '../utils';

export function useAgentTranscript(agentRunId: string | null): AgentTranscriptState {
  const [state, setState] = useState<AgentTranscriptState>({
    loading: false,
    error: null,
    cursor: 0,
    messages: null,
    parts: [],
    steps: [],
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    if (!agentRunId) {
      setState({ loading: false, error: null, cursor: 0, messages: null, parts: [], steps: [] });
      return;
    }

    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const headers = await getApiAuthHeaders();
        const response = await fetch(`${API_V1_URL}/agents/${agentRunId}/parts`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to load agent trace for ${agentRunId}`);
        }
        const data = await response.json();
        const parts: AgentTraceChunk[] = Array.isArray(data?.parts)
          ? data.parts
              .map(
                (entry: {
                  sequence?: number | null;
                  timestamp?: string | null;
                  chunk?: UIMessageChunk | null;
                }) => {
                  if (!entry?.chunk) {
                    return null;
                  }
                  return {
                    sequence: typeof entry.sequence === 'number' ? entry.sequence : 0,
                    timestamp:
                      typeof entry.timestamp === 'string'
                        ? entry.timestamp
                        : new Date().toISOString(),
                    chunk: entry.chunk,
                  };
                },
              )
              .filter((entry: AgentTraceChunk | null): entry is AgentTraceChunk => Boolean(entry))
          : [];
        const chunks: UIMessageChunk[] = parts.map((entry) => entry.chunk);
        const messages = await chunksToMessages(chunks);
        const steps = deriveAgentSteps(parts);
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            cursor:
              typeof data?.cursor === 'number'
                ? data.cursor
                : parts.length > 0
                  ? parts[parts.length - 1]!.sequence
                  : 0,
            messages,
            parts,
            steps,
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setState({
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load transcript',
            cursor: 0,
            messages: null,
            parts: [],
            steps: [],
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentRunId]);

  return state;
}
