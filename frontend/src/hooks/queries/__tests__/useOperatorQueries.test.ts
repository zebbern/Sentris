import { describe, expect, it } from 'bun:test';
import type { OperatorSessionDetail } from '@sentris/shared';

import {
  getOperatorSessionLatestTurnError,
  getOperatorRunTraceRefetchInterval,
  OPERATOR_RUN_TRACE_SETTLE_MS,
  operatorSessionHasActiveTurn,
} from '../useOperatorQueries';

const turn = {
  id: 'turn-1',
  sessionId: 'session-1',
  status: 'failed',
  temporalWorkflowId: 'operator-turn:session-1:turn-1',
  temporalRunId: null,
  context: null,
  error: 'Activity task failed',
  createdAt: '2026-08-02T10:00:00.000Z',
  startedAt: '2026-08-02T10:00:00.000Z',
  completedAt: '2026-08-02T10:01:00.000Z',
} satisfies OperatorSessionDetail['turns'][number];

const session = {
  id: 'session-1',
  title: 'Session',
  approvalMode: 'ask',
  status: 'active',
  model: {
    provider: 'gemini',
    modelId: 'gemini-3.6-flash',
    apiKeySecretId: '11111111-1111-4111-8111-111111111111',
    baseUrl: null,
  },
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  messages: [],
  actions: [],
  turns: [],
} satisfies OperatorSessionDetail;

describe('operatorSessionHasActiveTurn', () => {
  it('polls only while a durable turn can still change', () => {
    expect(operatorSessionHasActiveTurn(session)).toBe(false);
    expect(
      operatorSessionHasActiveTurn({
        ...session,
        turns: [
          {
            id: 'turn-1',
            sessionId: session.id,
            status: 'awaiting_approval',
            temporalWorkflowId: 'operator-turn:session-1:turn-1',
            temporalRunId: null,
            context: null,
            error: null,
            createdAt: session.createdAt,
            startedAt: session.createdAt,
            completedAt: null,
          },
        ],
      }),
    ).toBe(true);
  });
});

describe('getOperatorSessionLatestTurnError', () => {
  it('does not surface an older failure after a newer turn succeeds', () => {
    expect(
      getOperatorSessionLatestTurnError({
        ...session,
        turns: [
          turn,
          {
            ...turn,
            id: 'turn-2',
            status: 'completed',
            error: null,
            createdAt: '2026-08-02T10:02:00.000Z',
            completedAt: '2026-08-02T10:03:00.000Z',
          },
        ],
      }),
    ).toBeNull();
  });

  it('surfaces the failure when the newest turn failed', () => {
    expect(getOperatorSessionLatestTurnError({ ...session, turns: [turn] })).toBe(
      'Activity task failed',
    );
  });
});

describe('getOperatorRunTraceRefetchInterval', () => {
  it('keeps polling active runs and settles terminal traces for a bounded window', () => {
    const terminalObservedAt = 10_000;

    expect(getOperatorRunTraceRefetchInterval('RUNNING', terminalObservedAt, 50_000)).toBe(1_500);
    expect(
      getOperatorRunTraceRefetchInterval('COMPLETED', terminalObservedAt, terminalObservedAt),
    ).toBe(1_500);
    expect(
      getOperatorRunTraceRefetchInterval(
        'COMPLETED',
        terminalObservedAt,
        terminalObservedAt + OPERATOR_RUN_TRACE_SETTLE_MS - 250,
      ),
    ).toBe(250);
    expect(
      getOperatorRunTraceRefetchInterval(
        'COMPLETED',
        terminalObservedAt,
        terminalObservedAt + OPERATOR_RUN_TRACE_SETTLE_MS,
      ),
    ).toBe(false);
  });

  it('does not poll trace repeatedly before a run status is known', () => {
    expect(getOperatorRunTraceRefetchInterval(null, 0, 10_000)).toBe(false);
  });
});
