import type { UIMessageChunk } from 'ai';
import { getAuthHeaders, API_V1_URL } from './client';

export interface AgentTracePartDto {
  sequence?: number | null;
  timestamp?: string | null;
  chunk?: UIMessageChunk | null;
}

export interface AgentTracePartsResponse {
  agentRunId: string;
  workflowRunId?: string;
  nodeRef?: string;
  cursor?: number;
  parts?: AgentTracePartDto[];
  active?: boolean;
  canFollowUp?: boolean;
  turns?: AgentConversationTurnDto[];
}

export interface AgentConversationTurnDto {
  agentRunId: string;
  turnIndex: number;
  prompt: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  responseText: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sequenceStart: number;
  sequenceEnd: number;
}

export const agentsApi = {
  getParts: async (agentRunId: string): Promise<AgentTracePartsResponse> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/agents/${encodeURIComponent(agentRunId)}/parts`, {
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to load agent trace for ${agentRunId}`);
    }
    return response.json();
  },
  followUp: async (
    agentRunId: string,
    input: { requestId: string; message: string },
  ): Promise<{
    conversationId: string;
    agentRunId: string;
    turnIndex: number;
    status: 'queued' | 'running' | 'completed' | 'failed';
  }> => {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${API_V1_URL}/agents/${encodeURIComponent(agentRunId)}/follow-ups`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
      throw new Error(
        typeof payload?.message === 'string'
          ? payload.message
          : `Failed to continue Agent (${response.status})`,
      );
    }
    return response.json();
  },
};
