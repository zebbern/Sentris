import { describe, expect, it } from 'bun:test';

import { readOperatorTurnPayload } from '../operator-turn-payload';

describe('Operator turn payload compatibility', () => {
  it('keeps a V1 promotion readable without permitting it to overwrite a newer active version', () => {
    const candidateVersionId = '11111111-1111-4111-8111-111111111111';
    const payload = readOperatorTurnPayload({
      version: 1,
      routeContext: null,
      directCommand: {
        commandName: 'promote_workflow_version',
        arguments: {
          workflowId: '22222222-2222-4222-8222-222222222222',
          versionId: candidateVersionId,
          candidateRunId: 'sentris-run-candidate',
        },
      },
      journey: null,
    });

    expect(payload).toEqual({
      version: 2,
      routeContext: null,
      directCommand: {
        commandName: 'promote_workflow_version',
        arguments: {
          workflowId: '22222222-2222-4222-8222-222222222222',
          versionId: candidateVersionId,
          baseVersionId: candidateVersionId,
          candidateRunId: 'sentris-run-candidate',
        },
      },
      journey: null,
    });
  });
});
