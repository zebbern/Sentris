import type {
  OperatorActionDecision,
  OperatorActionView,
  OperatorCreateSession,
  OperatorCreateTurn,
  OperatorSessionDetail,
  OperatorSessionSummary,
  OperatorTurnAccepted,
  OperatorUpdateSession,
  OperatorWorkflowDraftDetail,
} from '@sentris/shared';

import { API_V1_URL, getAuthHeaders, httpGet, httpPatch, httpPost } from './client';

const sessionPath = (sessionId: string) => `/operator/sessions/${encodeURIComponent(sessionId)}`;

export const operatorApi = {
  listSessions: () => httpGet<OperatorSessionSummary[]>('/operator/sessions'),

  createSession: (input: OperatorCreateSession) =>
    httpPost<OperatorSessionSummary>('/operator/sessions', input),

  getSession: (sessionId: string) => httpGet<OperatorSessionDetail>(sessionPath(sessionId)),

  streamSession: async (sessionId: string): Promise<EventSource> => {
    const { FetchEventSource } = await import('@/utils/sse-client');
    const headers = await getAuthHeaders();
    return new FetchEventSource(`${API_V1_URL}${sessionPath(sessionId)}/stream`, {
      headers,
      withCredentials: true,
    });
  },

  listWorkflowDrafts: (sessionId: string) =>
    httpGet<OperatorWorkflowDraftDetail[]>(`${sessionPath(sessionId)}/workflow-drafts`),

  updateSession: (sessionId: string, input: OperatorUpdateSession) =>
    httpPatch<OperatorSessionSummary>(sessionPath(sessionId), input),

  createTurn: (sessionId: string, input: OperatorCreateTurn) =>
    httpPost<OperatorTurnAccepted>(`${sessionPath(sessionId)}/turns`, input),

  decideAction: (actionId: string, input: OperatorActionDecision) =>
    httpPost<OperatorActionView>(
      `/operator/actions/${encodeURIComponent(actionId)}/decision`,
      input,
    ),
};
