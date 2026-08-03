import { describe, expect, it } from 'bun:test';

import {
  createOperatorImproveRunNavigationState,
  createOperatorTurnFromHandoff,
  readOperatorImproveRunHandoff,
} from '@/features/operator/operatorHandoff';

const CLIENT_TURN_ID = '11111111-1111-4111-8111-111111111111';

describe('Operator run improvement handoff', () => {
  it('builds one typed, idempotent improvement turn from run-page navigation state', () => {
    const state = createOperatorImproveRunNavigationState(
      'sentris-run-source',
      '/workflows/workflow-1/runs/sentris-run-source',
      () => CLIENT_TURN_ID,
    );

    const handoff = readOperatorImproveRunHandoff(state);
    expect(handoff).not.toBeNull();
    expect(createOperatorTurnFromHandoff(handoff!)).toEqual({
      clientTurnId: CLIENT_TURN_ID,
      message:
        'Improve completed run sentris-run-source. Inspect its workflow and evidence, make a focused improvement, rerun it, and compare the result with the source run.',
      context: { path: '/workflows/workflow-1/runs/sentris-run-source' },
      journey: { kind: 'improve_run', sourceRunId: 'sentris-run-source' },
    });
  });

  it('ignores malformed or unrelated navigation state', () => {
    expect(readOperatorImproveRunHandoff(null)).toBeNull();
    expect(readOperatorImproveRunHandoff({ operatorHandoff: { kind: 'improve_run' } })).toBeNull();
    expect(
      readOperatorImproveRunHandoff({
        operatorHandoff: {
          version: 1,
          kind: 'improve_run',
          clientTurnId: CLIENT_TURN_ID,
          sourceRunId: 'sentris-run-source',
          sourcePath: 'https://example.com/not-an-app-path',
        },
      }),
    ).toBeNull();
  });
});
