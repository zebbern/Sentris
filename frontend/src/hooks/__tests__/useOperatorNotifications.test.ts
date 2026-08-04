import { describe, expect, it } from 'bun:test';

import type { OperatorSessionSummary, OperatorTurnStatus } from '@sentris/shared';

import { projectOperatorTransitions } from '../useOperatorNotifications';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';

function session(
  turnId: string | null,
  status: OperatorTurnStatus = 'running',
): OperatorSessionSummary {
  return {
    id: SESSION_ID,
    title: 'Investigation',
    approvalMode: 'ask',
    status: 'active',
    model: {
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      apiKeySecretId: '33333333-3333-4333-8333-333333333333',
      baseUrl: null,
    },
    latestTurn: turnId
      ? {
          id: turnId,
          status,
          error: status === 'failed' ? 'Model request failed' : null,
          createdAt: '2026-08-04T10:00:00.000Z',
          completedAt:
            status === 'completed' || status === 'failed' ? '2026-08-04T10:01:00.000Z' : null,
        }
      : null,
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T10:01:00.000Z',
  };
}

describe('projectOperatorTransitions', () => {
  it('uses the first snapshot as a baseline without notifying for old terminal turns', () => {
    const result = projectOperatorTransitions(null, [session(TURN_ID, 'completed')]);

    expect(result.transitions).toEqual([]);
    expect(result.next.get(SESSION_ID)?.status).toBe('completed');
  });

  it('reports approval and terminal transitions for an already observed session', () => {
    const baseline = projectOperatorTransitions(null, [session(TURN_ID, 'running')]).next;
    const approval = projectOperatorTransitions(baseline, [session(TURN_ID, 'awaiting_approval')]);
    const completed = projectOperatorTransitions(approval.next, [session(TURN_ID, 'completed')]);

    expect(approval.transitions.map(({ turn }) => turn.status)).toEqual(['awaiting_approval']);
    expect(completed.transitions.map(({ turn }) => turn.status)).toEqual(['completed']);
  });

  it('catches a new turn that finishes between activity snapshots', () => {
    const baseline = projectOperatorTransitions(null, [session(null)]).next;
    const result = projectOperatorTransitions(baseline, [session(TURN_ID, 'failed')]);

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]?.turn.id).toBe(TURN_ID);
    expect(result.transitions[0]?.turn.status).toBe('failed');
  });
});
