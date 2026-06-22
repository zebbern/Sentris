import { useAgentTranscriptQuery } from '@/hooks/queries/useAgentQueries';
import type { AgentTranscriptState } from '../types';

const EMPTY_TRANSCRIPT: AgentTranscriptState = {
  loading: false,
  error: null,
  cursor: 0,
  messages: null,
  parts: [],
  steps: [],
};

export function useAgentTranscript(agentRunId: string | null): AgentTranscriptState {
  const transcriptQuery = useAgentTranscriptQuery(agentRunId);

  if (!agentRunId) {
    return EMPTY_TRANSCRIPT;
  }

  if (transcriptQuery.isLoading) {
    return {
      ...EMPTY_TRANSCRIPT,
      loading: true,
    };
  }

  if (transcriptQuery.error) {
    return {
      ...EMPTY_TRANSCRIPT,
      error:
        transcriptQuery.error instanceof Error
          ? transcriptQuery.error.message
          : 'Failed to load transcript',
    };
  }

  if (!transcriptQuery.data) {
    return EMPTY_TRANSCRIPT;
  }

  return {
    loading: false,
    error: null,
    ...transcriptQuery.data,
  };
}
