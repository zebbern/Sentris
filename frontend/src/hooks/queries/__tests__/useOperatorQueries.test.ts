import { describe, expect, it } from 'bun:test';
import type { OperatorSessionDetail } from '@sentris/shared';

import { operatorSessionHasActiveTurn } from '../useOperatorQueries';

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
