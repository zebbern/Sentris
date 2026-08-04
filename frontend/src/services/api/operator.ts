import type {
  OperatorActionDecision,
  OperatorActionView,
  OperatorCreateSession,
  OperatorCreateTurn,
  OperatorRunImprovementLookup,
  OperatorRetryTurn,
  OperatorSessionDetail,
  OperatorSessionSummary,
  OperatorTurnAccepted,
  OperatorTurnView,
  OperatorUpdateSession,
  OperatorWorkflowDraftDetail,
} from '@sentris/shared';

import { API_V1_URL, getAuthHeaders, httpDel, httpGet, httpPatch, httpPost } from './client';

const sessionPath = (sessionId: string) => `/operator/sessions/${encodeURIComponent(sessionId)}`;

export const operatorApi = {
  listSessions: () => httpGet<OperatorSessionSummary[]>('/operator/sessions'),

  streamActivity: async (): Promise<EventSource> => {
    const { FetchEventSource } = await import('@/utils/sse-client');
    const headers = await getAuthHeaders();
    return new FetchEventSource(`${API_V1_URL}/operator/activity/stream`, {
      headers,
      withCredentials: true,
    });
  },

  getRunImprovement: (sourceRunId: string) =>
    httpGet<OperatorRunImprovementLookup>(
      `/operator/run-improvements/${encodeURIComponent(sourceRunId)}`,
    ),

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

  deleteSession: (sessionId: string) => httpDel(sessionPath(sessionId)),

  createTurn: (sessionId: string, input: OperatorCreateTurn) =>
    httpPost<OperatorTurnAccepted>(`${sessionPath(sessionId)}/turns`, input),

  cancelTurn: (turnId: string) =>
    httpPost<OperatorTurnView>(`/operator/turns/${encodeURIComponent(turnId)}/cancel`, {}),

  retryTurn: (turnId: string, input: OperatorRetryTurn) =>
    httpPost<OperatorTurnAccepted>(`/operator/turns/${encodeURIComponent(turnId)}/retry`, input),

  decideAction: (actionId: string, input: OperatorActionDecision) =>
    httpPost<OperatorActionView>(
      `/operator/actions/${encodeURIComponent(actionId)}/decision`,
      input,
    ),
};
