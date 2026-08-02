import type {
  OperatorActionDecision,
  OperatorActionView,
  OperatorCreateSession,
  OperatorCreateTurn,
  OperatorSessionDetail,
  OperatorSessionSummary,
  OperatorTurnAccepted,
  OperatorUpdateSession,
} from '@sentris/shared';

import { httpGet, httpPatch, httpPost } from './client';

const sessionPath = (sessionId: string) => `/operator/sessions/${encodeURIComponent(sessionId)}`;

export const operatorApi = {
  listSessions: () => httpGet<OperatorSessionSummary[]>('/operator/sessions'),

  createSession: (input: OperatorCreateSession) =>
    httpPost<OperatorSessionSummary>('/operator/sessions', input),

  getSession: (sessionId: string) => httpGet<OperatorSessionDetail>(sessionPath(sessionId)),

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
