import { useMemo } from 'react';
import { DefaultChatTransport } from 'ai';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import { headersInitToRecord } from '../utils';

export function useAgentChatTransport(agentRunId: string | null) {
  return useMemo(() => {
    if (!agentRunId) {
      return null;
    }
    return new DefaultChatTransport({
      prepareSendMessagesRequest: async ({ body, headers }) => {
        const authHeaders = await getApiAuthHeaders();
        return {
          api: `${API_V1_URL}/agents/${agentRunId}/chat`,
          body: body ?? {},
          headers: {
            ...headersInitToRecord(headers),
            ...authHeaders,
          },
        };
      },
      prepareReconnectToStreamRequest: async ({ headers }) => {
        const authHeaders = await getApiAuthHeaders();
        return {
          api: `${API_V1_URL}/agents/${agentRunId}/chat`,
          headers: {
            ...headersInitToRecord(headers),
            ...authHeaders,
          },
        };
      },
    });
  }, [agentRunId]);
}
