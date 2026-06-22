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
}

export const agentsApi = {
  getParts: async (agentRunId: string): Promise<AgentTracePartsResponse> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/agents/${encodeURIComponent(agentRunId)}/parts`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`Failed to load agent trace for ${agentRunId}`);
    }
    return response.json();
  },
};
