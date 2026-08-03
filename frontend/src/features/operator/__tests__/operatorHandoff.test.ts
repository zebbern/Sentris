import { describe, expect, it } from 'bun:test';

import {
  createOperatorImproveRunNavigationState,
  createOperatorDirectCommandNavigationState,
  createOperatorInvestigateFindingNavigationState,
  createOperatorInvestigateRunNavigationState,
  createOperatorTurnFromHandoff,
  readOperatorImproveRunHandoff,
  readOperatorTurnHandoff,
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

  it('builds one typed, idempotent direct-command turn from a run-page action', () => {
    const state = createOperatorDirectCommandNavigationState(
      'Keep this tested candidate',
      {
        commandName: 'promote_workflow_version',
        arguments: {
          workflowId: '22222222-2222-4222-8222-222222222222',
          versionId: '33333333-3333-4333-8333-333333333333',
          baseVersionId: '44444444-4444-4444-8444-444444444444',
          candidateRunId: 'sentris-run-candidate',
        },
      },
      '/runs/sentris-run-candidate',
      () => CLIENT_TURN_ID,
    );

    const handoff = readOperatorTurnHandoff(state);
    expect(handoff?.kind).toBe('direct_command');
    expect(createOperatorTurnFromHandoff(handoff!)).toEqual({
      clientTurnId: CLIENT_TURN_ID,
      message: 'Keep this tested candidate',
      context: { path: '/runs/sentris-run-candidate' },
      directCommand: {
        commandName: 'promote_workflow_version',
        arguments: {
          workflowId: '22222222-2222-4222-8222-222222222222',
          versionId: '33333333-3333-4333-8333-333333333333',
          baseVersionId: '44444444-4444-4444-8444-444444444444',
          candidateRunId: 'sentris-run-candidate',
        },
      },
    });
  });

  it('loads run evidence before asking Operator to investigate', () => {
    const state = createOperatorInvestigateRunNavigationState(
      {
        runId: 'sentris-run-source',
        workflowId: '22222222-2222-4222-8222-222222222222',
        sourcePath: '/workflows/22222222-2222-4222-8222-222222222222/runs/sentris-run-source',
      },
      () => CLIENT_TURN_ID,
    );

    const handoff = readOperatorTurnHandoff(state);
    expect(handoff?.kind).toBe('direct_command');
    expect(createOperatorTurnFromHandoff(handoff!)).toEqual({
      clientTurnId: CLIENT_TURN_ID,
      message:
        'Investigate this run. Review its status, stored output, recent and failed trace evidence, and findings. Explain what happened and recommend the most useful next step. Do not make changes unless I ask.',
      context: {
        path: '/workflows/22222222-2222-4222-8222-222222222222/runs/sentris-run-source',
        workflowId: '22222222-2222-4222-8222-222222222222',
        runId: 'sentris-run-source',
      },
      directCommand: {
        commandName: 'get_run',
        arguments: { runId: 'sentris-run-source' },
      },
    });
  });

  it('loads bounded finding evidence before asking Operator to investigate', () => {
    const state = createOperatorInvestigateFindingNavigationState(
      {
        findingId: 'finding-1',
        workflowId: '22222222-2222-4222-8222-222222222222',
        runId: 'sentris-run-source',
        sourcePath: '/findings',
      },
      () => CLIENT_TURN_ID,
    );

    const handoff = readOperatorTurnHandoff(state);
    expect(handoff?.kind).toBe('direct_command');
    expect(createOperatorTurnFromHandoff(handoff!)).toEqual({
      clientTurnId: CLIENT_TURN_ID,
      message:
        'Investigate this finding. Review its bounded raw evidence, source run and workflow context, and current triage state. Explain what it means, how credible it is, and recommend the most useful next step. Do not change triage or workflows unless I ask.',
      context: {
        path: '/findings',
        workflowId: '22222222-2222-4222-8222-222222222222',
        runId: 'sentris-run-source',
      },
      directCommand: {
        commandName: 'get_finding',
        arguments: { findingId: 'finding-1' },
      },
    });
  });

  it('ignores malformed or unrelated navigation state', () => {
    expect(readOperatorImproveRunHandoff(null)).toBeNull();
    expect(readOperatorImproveRunHandoff({ operatorHandoff: { kind: 'improve_run' } })).toBeNull();
    expect(
      readOperatorTurnHandoff({
        operatorHandoff: {
          version: 1,
          kind: 'direct_command',
          clientTurnId: CLIENT_TURN_ID,
          message: 'Keep it',
          sourcePath: '/runs/candidate',
          directCommand: {
            commandName: 'promote_workflow_version',
            arguments: { workflowId: 'not-a-uuid', versionId: 'bad', candidateRunId: '' },
          },
        },
      }),
    ).toBeNull();
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
