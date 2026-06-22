import { useQuery, skipToken } from '@tanstack/react-query';
import type { UIMessageChunk } from 'ai';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AgentTraceChunk,
  AgentTranscriptState,
} from '@/components/timeline/agent-trace/types';
import { chunksToMessages, deriveAgentSteps } from '@/components/timeline/agent-trace/utils';

export type AgentTranscriptData = Omit<AgentTranscriptState, 'loading' | 'error'>;

export async function loadAgentTranscript(agentRunId: string): Promise<AgentTranscriptData> {
  const data = await api.agents.getParts(agentRunId);
  const parts: AgentTraceChunk[] = Array.isArray(data?.parts)
    ? data.parts
        .map((entry) => {
          if (!entry?.chunk) {
            return null;
          }
          return {
            sequence: typeof entry.sequence === 'number' ? entry.sequence : 0,
            timestamp:
              typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
            chunk: entry.chunk as UIMessageChunk,
          };
        })
        .filter((entry: AgentTraceChunk | null): entry is AgentTraceChunk => Boolean(entry))
    : [];
  const chunks: UIMessageChunk[] = parts.map((entry) => entry.chunk);
  const messages = await chunksToMessages(chunks);
  const steps = deriveAgentSteps(parts);

  return {
    cursor:
      typeof data?.cursor === 'number'
        ? data.cursor
        : parts.length > 0
          ? parts[parts.length - 1]!.sequence
          : 0,
    messages,
    parts,
    steps,
  };
}

export function useAgentTranscriptQuery(agentRunId: string | null) {
  return useQuery({
    queryKey: queryKeys.agents.transcript(agentRunId ?? '__no-agent-run__'),
    queryFn: agentRunId ? () => loadAgentTranscript(agentRunId) : skipToken,
    staleTime: 10_000,
  });
}
