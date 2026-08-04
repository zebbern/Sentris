import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  OperatorActivityStreamErrorSchema,
  OperatorActivityStreamReadySchema,
  OperatorActivityStreamSnapshotSchema,
  OperatorSessionStreamErrorSchema,
  OperatorSessionStreamReadySchema,
  OperatorSessionStreamSnapshotSchema,
  TERMINAL_STATUSES,
  type OperatorActionDecision,
  type OperatorCreateSession,
  type OperatorCreateTurn,
  type OperatorRetryTurn,
  type OperatorSessionDetail,
  type OperatorSessionSummary,
  type OperatorUpdateSession,
} from '@sentris/shared';

import { queryKeys } from '@/lib/queryKeys';
import { executionStatusOptions, executionTraceOptions } from '@/lib/executionQueryOptions';
import { logger } from '@/lib/logger';
import {
  ExecutionStatusResponseSchema,
  TraceStreamEnvelopeSchema,
  type ExecutionTraceStream,
} from '@/schemas/execution';
import { api } from '@/services/api';
import { mergeEvents } from '@/store/execution/helpers';

const ACTIVE_TURN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);
const TERMINAL_RUN_STATUSES = new Set<string>(TERMINAL_STATUSES);
const OPERATOR_RUN_POLL_INTERVAL_MS = 1_500;
const OPERATOR_LIVE_BACKUP_POLL_INTERVAL_MS = 5_000;
const OPERATOR_STREAM_RECONNECT_MS = 5_000;
const OPERATOR_ACTIVITY_FALLBACK_POLL_INTERVAL_MS = 5_000;
export const OPERATOR_RUN_TRACE_SETTLE_MS = 30_000;

export type OperatorStreamState = 'connecting' | 'live' | 'polling' | 'closed';

export function getOperatorPollInterval(streamState: OperatorStreamState): number {
  return streamState === 'live'
    ? OPERATOR_LIVE_BACKUP_POLL_INTERVAL_MS
    : OPERATOR_RUN_POLL_INTERVAL_MS;
}

function readEventPayload(event: Event): unknown {
  const data = (event as MessageEvent).data;
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function readRunStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' ? status.toUpperCase() : null;
}

export function getOperatorRunTraceRefetchInterval(
  status: string | null,
  statusUpdatedAt: number,
  now = Date.now(),
  streamState: OperatorStreamState = 'polling',
): number | false {
  if (!status) return false;
  const interval = getOperatorPollInterval(streamState);
  if (!TERMINAL_RUN_STATUSES.has(status)) return interval;

  const remainingSettleMs = statusUpdatedAt + OPERATOR_RUN_TRACE_SETTLE_MS - now;
  if (remainingSettleMs <= 0) return false;
  return Math.min(interval, remainingSettleMs);
}

export function operatorSessionHasActiveTurn(
  session: OperatorSessionDetail,
  activitySummary?: OperatorSessionSummary,
): boolean {
  const latestTurn = session.turns[session.turns.length - 1];
  if (!latestTurn) return false;
  if (!ACTIVE_TURN_STATUSES.has(latestTurn.status)) return false;
  const activityLatestTurn = activitySummary?.latestTurn;
  if (activitySummary && activityLatestTurn?.id === latestTurn.id) {
    return operatorSessionSummaryHasActiveTurn(activitySummary);
  }
  return true;
}

export function operatorSessionSummaryHasActiveTurn(session: OperatorSessionSummary): boolean {
  return Boolean(session.latestTurn && ACTIVE_TURN_STATUSES.has(session.latestTurn.status));
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

export function useOperatorActivityStream() {
  const queryClient = useQueryClient();
  const [streamState, setStreamState] = useState<OperatorStreamState>('connecting');
  const query = useQuery({
    queryKey: queryKeys.operator.sessions(),
    queryFn: () => api.operator.listSessions(),
    staleTime: 15_000,
    refetchInterval:
      streamState === 'live'
        ? OPERATOR_LIVE_BACKUP_POLL_INTERVAL_MS
        : OPERATOR_ACTIVITY_FALLBACK_POLL_INTERVAL_MS,
    select: (sessions) =>
      [...sessions].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
  });

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const fallBackToPolling = () => {
      if (disposed) return;
      source?.close();
      source = null;
      setStreamState('polling');
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (disposed) return;
          setStreamState('connecting');
          connect();
        }, OPERATOR_STREAM_RECONNECT_MS);
      }
    };

    function connect() {
      void api.operator
        .streamActivity()
        .then((nextSource) => {
          if (disposed) {
            nextSource.close();
            return;
          }
          source = nextSource;
          source.addEventListener('ready', (event) => {
            const parsed = OperatorActivityStreamReadySchema.safeParse(readEventPayload(event));
            if (parsed.success) setStreamState('live');
          });
          source.addEventListener('snapshot', (event) => {
            const parsed = OperatorActivityStreamSnapshotSchema.safeParse(readEventPayload(event));
            if (!parsed.success) return;
            const sessionsKey = queryKeys.operator.sessions();
            void queryClient
              .cancelQueries({ queryKey: sessionsKey, exact: true })
              .then(() => {
                if (!disposed) queryClient.setQueryData(sessionsKey, parsed.data.sessions);
              })
              .catch((error: unknown) => {
                logger.warn('Failed to apply Operator activity snapshot', error);
              });
          });
          source.addEventListener('error', (event) => {
            const payload = readEventPayload(event);
            if (payload !== null) {
              const parsed = OperatorActivityStreamErrorSchema.safeParse(payload);
              if (!parsed.success) {
                logger.warn('Ignored malformed Operator activity stream error', parsed.error);
              }
            }
            fallBackToPolling();
          });
          source.onerror = fallBackToPolling;
        })
        .catch((error: unknown) => {
          logger.warn('Failed to open Operator activity stream', error);
          fallBackToPolling();
        });
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [queryClient]);

  return { ...query, streamState };
}

export function useOperatorRunImprovement(sourceRunId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.operator.runImprovement(sourceRunId ?? ''),
    queryFn: sourceRunId ? () => api.operator.getRunImprovement(sourceRunId) : skipToken,
    ...(sourceRunId ? {} : { gcTime: 0 }),
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.improvement ? false : 5_000),
  });
}

function useOperatorSessionQuery(
  sessionId: string | undefined,
  streamState: OperatorStreamState | null,
) {
  return useQuery({
    queryKey: queryKeys.operator.session(sessionId ?? ''),
    queryFn: sessionId ? () => api.operator.getSession(sessionId) : skipToken,
    ...(sessionId ? {} : { gcTime: 0 }),
    refetchInterval: (query) => {
      const session = query.state.data;
      return streamState && session && operatorSessionHasActiveTurn(session)
        ? getOperatorPollInterval(streamState)
        : false;
    },
  });
}

export function useOperatorSession(sessionId: string | undefined) {
  return useOperatorSessionQuery(sessionId, null);
}

export function useOperatorSessionStream(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const [streamState, setStreamState] = useState<OperatorStreamState>(
    sessionId ? 'connecting' : 'closed',
  );
  const query = useOperatorSessionQuery(sessionId, streamState);

  useEffect(() => {
    if (!sessionId) {
      setStreamState('closed');
      return;
    }
    const activeSessionId = sessionId;

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    setStreamState('connecting');

    const fallBackToPolling = () => {
      if (disposed) return;
      source?.close();
      source = null;
      setStreamState('polling');
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (disposed) return;
          setStreamState('connecting');
          connect();
        }, OPERATOR_STREAM_RECONNECT_MS);
      }
    };

    function connect() {
      void api.operator
        .streamSession(activeSessionId)
        .then((nextSource) => {
          if (disposed) {
            nextSource.close();
            return;
          }
          source = nextSource;
          source.addEventListener('ready', (event) => {
            const parsed = OperatorSessionStreamReadySchema.safeParse(readEventPayload(event));
            if (parsed.success && parsed.data.sessionId === sessionId) {
              setStreamState('live');
            }
          });
          source.addEventListener('snapshot', (event) => {
            const parsed = OperatorSessionStreamSnapshotSchema.safeParse(readEventPayload(event));
            if (!parsed.success || parsed.data.session.id !== sessionId) return;
            const sessionKey = queryKeys.operator.session(sessionId);
            void queryClient
              .cancelQueries({ queryKey: sessionKey, exact: true })
              .then(() => {
                if (!disposed) queryClient.setQueryData(sessionKey, parsed.data.session);
              })
              .catch((error: unknown) => {
                logger.warn('Failed to apply Operator session snapshot', error);
              });
          });
          source.addEventListener('error', (event) => {
            const payload = readEventPayload(event);
            if (payload !== null) {
              const parsed = OperatorSessionStreamErrorSchema.safeParse(payload);
              if (!parsed.success) {
                logger.warn('Ignored malformed Operator session stream error', parsed.error);
              }
            }
            fallBackToPolling();
          });
          source.onerror = fallBackToPolling;
        })
        .catch((error: unknown) => {
          logger.warn('Failed to open Operator session stream', error);
          fallBackToPolling();
        });
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [queryClient, sessionId]);

  return { ...query, streamState };
}

export function useOperatorWorkflowDrafts(
  sessionId: string | undefined,
  pollWhileTurnActive = false,
  expectedDraftCount = 0,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.operator.workflowDrafts(sessionId ?? ''),
    queryFn: sessionId ? () => api.operator.listWorkflowDrafts(sessionId) : skipToken,
    staleTime: pollWhileTurnActive ? 0 : 15_000,
    refetchInterval: pollWhileTurnActive ? 1_500 : false,
    ...(sessionId ? {} : { gcTime: 0 }),
  });

  const previousExpectationRef = useRef<{ sessionId: string | undefined; count: number }>({
    sessionId: undefined,
    count: 0,
  });
  useEffect(() => {
    const previous = previousExpectationRef.current;
    const expectationIncreased =
      sessionId !== undefined &&
      expectedDraftCount > 0 &&
      (previous.sessionId !== sessionId || expectedDraftCount > previous.count);
    previousExpectationRef.current = { sessionId, count: expectedDraftCount };

    if (expectationIncreased && (query.data?.length ?? 0) < expectedDraftCount) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.operator.workflowDrafts(sessionId),
        exact: true,
      });
    }
  }, [expectedDraftCount, query.data?.length, queryClient, sessionId]);

  return query;
}

/**
 * Builder links carry one durable draft identity. A normal query may reuse a
 * still-fresh cached list that predates that draft, so this wrapper forces one
 * fresh batch read per requested identity and keeps the loader pending until
 * that read settles.
 */
export function useOperatorWorkflowDraftForBuilder(
  sessionId: string | undefined,
  draftId: string | undefined,
) {
  const query = useOperatorWorkflowDrafts(sessionId);
  const expectedReadKey = sessionId && draftId ? `${sessionId}:${draftId}` : null;
  const activeReadKeyRef = useRef(expectedReadKey);
  activeReadKeyRef.current = expectedReadKey;
  const [completedReadKey, setCompletedReadKey] = useState<string | null>(null);

  useEffect(() => {
    if (!expectedReadKey) return;
    let cancelled = false;

    void query.refetch().finally(() => {
      if (!cancelled && activeReadKeyRef.current === expectedReadKey) {
        setCompletedReadKey(expectedReadKey);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [expectedReadKey, query.refetch]);

  return {
    ...query,
    draft: draftId ? (query.data?.find((draft) => draft.draftId === draftId) ?? null) : null,
    isDraftLoading: expectedReadKey !== null && completedReadKey !== expectedReadKey,
  };
}

export function useOperatorRunQueryStream(runId: string | null) {
  const queryClient = useQueryClient();
  const [streamState, setStreamState] = useState<OperatorStreamState>('closed');
  const statusQuery = useOperatorRunStatus(runId, streamState);
  const status = readRunStatus(statusQuery.data);
  const shouldStream = Boolean(status && !TERMINAL_RUN_STATUSES.has(status));

  useEffect(() => {
    if (!runId || !shouldStream) {
      setStreamState('closed');
      return;
    }
    const activeRunId = runId;

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    setStreamState('connecting');

    const fallBackToPolling = () => {
      if (disposed) return;
      source?.close();
      source = null;
      setStreamState('polling');
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (disposed) return;
          setStreamState('connecting');
          connect();
        }, OPERATOR_STREAM_RECONNECT_MS);
      }
    };
    const finish = () => {
      if (disposed) return;
      source?.close();
      setStreamState('closed');
      void queryClient.invalidateQueries({
        queryKey: queryKeys.executions.status(runId),
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.executions.trace(runId),
        exact: true,
      });
    };

    function connect() {
      const cachedTrace = queryClient.getQueryData<ExecutionTraceStream>(
        queryKeys.executions.trace(activeRunId),
      );
      void api.executions
        .stream(activeRunId, cachedTrace?.cursor ? { cursor: cachedTrace.cursor } : undefined)
        .then((nextSource) => {
          if (disposed) {
            nextSource.close();
            return;
          }
          source = nextSource;
          source.onopen = () => setStreamState('live');
          source.addEventListener('ready', () => setStreamState('live'));
          source.addEventListener('status', (event) => {
            const parsed = ExecutionStatusResponseSchema.safeParse(readEventPayload(event));
            if (!parsed.success || parsed.data.runId !== runId) return;
            const statusKey = queryKeys.executions.status(runId);
            void queryClient.cancelQueries({ queryKey: statusKey, exact: true });
            queryClient.setQueryData(statusKey, parsed.data);
          });
          source.addEventListener('trace', (event) => {
            const payload = readEventPayload(event);
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
            const parsed = TraceStreamEnvelopeSchema.safeParse({ ...payload, runId });
            if (!parsed.success || parsed.data.runId !== runId) return;
            const traceKey = queryKeys.executions.trace(runId);
            void queryClient.cancelQueries({ queryKey: traceKey, exact: true });
            queryClient.setQueryData<ExecutionTraceStream>(traceKey, (existing) => ({
              runId,
              events: mergeEvents(existing?.events ?? [], parsed.data.events),
              cursor: parsed.data.cursor ?? existing?.cursor,
            }));
          });
          source.addEventListener('complete', finish);
          source.addEventListener('error', fallBackToPolling);
          source.onerror = fallBackToPolling;
        })
        .catch((error: unknown) => {
          logger.warn('Failed to open Operator run stream', error);
          fallBackToPolling();
        });
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [queryClient, runId, shouldStream]);

  return { statusQuery, streamState };
}

export function useOperatorRunStatus(
  runId: string | null,
  streamState: OperatorStreamState = 'polling',
) {
  return useQuery({
    ...(runId ? executionStatusOptions(runId) : {}),
    queryKey: queryKeys.executions.status(runId ?? ''),
    queryFn: runId ? executionStatusOptions(runId).queryFn : skipToken,
    ...(!runId && { gcTime: 0 }),
    refetchInterval: (query) => {
      const status = readRunStatus(query.state.data);
      return status && TERMINAL_RUN_STATUSES.has(status)
        ? false
        : getOperatorPollInterval(streamState);
    },
  });
}

export function useOperatorRunTrace(
  runId: string | null,
  status: string | null,
  statusUpdatedAt: number,
  streamState: OperatorStreamState = 'polling',
) {
  return useQuery({
    ...(runId ? executionTraceOptions(runId) : {}),
    queryKey: queryKeys.executions.trace(runId ?? ''),
    queryFn: runId ? executionTraceOptions(runId).queryFn : skipToken,
    ...(!runId && { gcTime: 0 }),
    refetchInterval: () =>
      getOperatorRunTraceRefetchInterval(status, statusUpdatedAt, Date.now(), streamState),
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

export function useDeleteOperatorSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => api.operator.deleteSession(sessionId),
    meta: { suppressGlobalError: true },
    onSuccess: (_result, sessionId) => {
      queryClient.removeQueries({ queryKey: queryKeys.operator.session(sessionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.operator.sessions() });
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
      if (variables.input.journey?.kind === 'improve_run') {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.operator.runImprovement(variables.input.journey.sourceRunId),
        });
      }
    },
  });
}

export function useCancelOperatorTurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId: _sessionId, turnId }: { sessionId: string; turnId: string }) =>
      api.operator.cancelTurn(turnId),
    meta: { suppressGlobalError: true },
    onSuccess: (_turn, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.operator.sessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.operator.session(variables.sessionId),
      });
    },
  });
}

export function useRetryOperatorTurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId: _sessionId,
      turnId,
      input,
    }: {
      sessionId: string;
      turnId: string;
      input: OperatorRetryTurn;
    }) => api.operator.retryTurn(turnId, input),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.operator.sessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.operator.session(variables.sessionId),
      });
    },
  });
}
