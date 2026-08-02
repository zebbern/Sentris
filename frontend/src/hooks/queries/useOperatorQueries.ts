import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  OperatorActionDecision,
  OperatorCreateSession,
  OperatorCreateTurn,
  OperatorSessionDetail,
  OperatorUpdateSession,
} from '@sentris/shared';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';

const ACTIVE_TURN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);

export function operatorSessionHasActiveTurn(session: OperatorSessionDetail): boolean {
  return session.turns.some((turn) => ACTIVE_TURN_STATUSES.has(turn.status));
}

export function useOperatorSessions() {
  return useQuery({
    queryKey: queryKeys.operator.sessions(),
    queryFn: () => api.operator.listSessions(),
    staleTime: 15_000,
    select: (sessions) =>
      [...sessions].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
  });
}

export function useOperatorSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.operator.session(sessionId ?? ''),
    queryFn: sessionId ? () => api.operator.getSession(sessionId) : skipToken,
    ...(sessionId ? {} : { gcTime: 0 }),
    refetchInterval: (query) => {
      const session = query.state.data;
      return session && operatorSessionHasActiveTurn(session) ? 1_500 : false;
    },
  });
}

export function useCreateOperatorSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: OperatorCreateSession) => api.operator.createSession(input),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.operator.sessions() });
    },
  });
}

export function useUpdateOperatorSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: OperatorUpdateSession }) =>
      api.operator.updateSession(sessionId, input),
    meta: { suppressGlobalError: true },
    onSuccess: (_session, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.operator.sessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.operator.session(variables.sessionId),
      });
    },
  });
}

export function useCreateOperatorTurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: OperatorCreateTurn }) =>
      api.operator.createTurn(sessionId, input),
    meta: { suppressGlobalError: true },
    onSuccess: (_turn, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.operator.sessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.operator.session(variables.sessionId),
      });
    },
  });
}

export function useDecideOperatorAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId: _sessionId,
      actionId,
      input,
    }: {
      sessionId: string;
      actionId: string;
      input: OperatorActionDecision;
    }) => api.operator.decideAction(actionId, input),
    meta: { suppressGlobalError: true },
    onSuccess: (_action, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.operator.session(variables.sessionId),
      });
    },
  });
}
