import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TERMINAL_STATUSES,
  type OperatorActionDecision,
  type OperatorCreateSession,
  type OperatorCreateTurn,
  type OperatorSessionDetail,
  type OperatorUpdateSession,
} from '@sentris/shared';

import { queryKeys } from '@/lib/queryKeys';
import { executionStatusOptions, executionTraceOptions } from '@/lib/executionQueryOptions';
import { api } from '@/services/api';

const ACTIVE_TURN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);
const TERMINAL_RUN_STATUSES = new Set<string>(TERMINAL_STATUSES);
const OPERATOR_RUN_POLL_INTERVAL_MS = 1_500;
export const OPERATOR_RUN_TRACE_SETTLE_MS = 30_000;

function readRunStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' ? status.toUpperCase() : null;
}

export function getOperatorRunTraceRefetchInterval(
  status: string | null,
  statusUpdatedAt: number,
  now = Date.now(),
): number | false {
  if (!status) return false;
  if (!TERMINAL_RUN_STATUSES.has(status)) return OPERATOR_RUN_POLL_INTERVAL_MS;

  const remainingSettleMs = statusUpdatedAt + OPERATOR_RUN_TRACE_SETTLE_MS - now;
  if (remainingSettleMs <= 0) return false;
  return Math.min(OPERATOR_RUN_POLL_INTERVAL_MS, remainingSettleMs);
}

export function operatorSessionHasActiveTurn(session: OperatorSessionDetail): boolean {
  return session.turns.some((turn) => ACTIVE_TURN_STATUSES.has(turn.status));
}

export function getOperatorSessionLatestTurnError(session: OperatorSessionDetail): string | null {
  const latestTurn = session.turns[session.turns.length - 1];
  return latestTurn?.status === 'failed' ? latestTurn.error : null;
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

export function useOperatorRunStatus(runId: string | null) {
  return useQuery({
    ...(runId ? executionStatusOptions(runId) : {}),
    queryKey: queryKeys.executions.status(runId ?? ''),
    queryFn: runId ? executionStatusOptions(runId).queryFn : skipToken,
    ...(!runId && { gcTime: 0 }),
    refetchInterval: (query) => {
      const status = readRunStatus(query.state.data);
      return status && TERMINAL_RUN_STATUSES.has(status) ? false : OPERATOR_RUN_POLL_INTERVAL_MS;
    },
  });
}

export function useOperatorRunTrace(
  runId: string | null,
  status: string | null,
  statusUpdatedAt: number,
) {
  return useQuery({
    ...(runId ? executionTraceOptions(runId) : {}),
    queryKey: queryKeys.executions.trace(runId ?? ''),
    queryFn: runId ? executionTraceOptions(runId).queryFn : skipToken,
    ...(!runId && { gcTime: 0 }),
    refetchInterval: () => getOperatorRunTraceRefetchInterval(status, statusUpdatedAt),
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
