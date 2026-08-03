import { describe, expect, it } from 'bun:test';
import type {
  OperatorActionView,
  OperatorRunComparisonResult,
  OperatorRunImprovementReference,
  OperatorSessionDetail,
} from '@sentris/shared';

import { projectOperatorRunImprovement } from '@/features/operator/operatorRunImprovement';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_RUN_ID = 'sentris-run-source';
const CANDIDATE_RUN_ID = 'sentris-run-candidate';

const reference: OperatorRunImprovementReference = {
  sourceRunId: SOURCE_RUN_ID,
  sessionId: SESSION_ID,
  turnId: TURN_ID,
  createdAt: '2026-08-03T08:15:00.000Z',
};

const comparison: OperatorRunComparisonResult = {
  kind: 'run-comparison',
  assessment: 'improved',
  comparable: true,
  source: {
    runId: SOURCE_RUN_ID,
    workflowId: '33333333-3333-4333-8333-333333333333',
    workflowVersionId: '44444444-4444-4444-8444-444444444444',
    status: 'COMPLETED',
    durationMs: 2_000,
    trace: { availability: 'available', failedEventCount: 1 },
    findings: { availability: 'available', total: 2 },
  },
  candidate: {
    runId: CANDIDATE_RUN_ID,
    workflowId: '33333333-3333-4333-8333-333333333333',
    workflowVersionId: '55555555-5555-4555-8555-555555555555',
    status: 'COMPLETED',
    durationMs: 1_500,
    trace: { availability: 'available', failedEventCount: 0 },
    findings: { availability: 'available', total: 3 },
  },
  changes: {
    statusChanged: false,
    failedEventCountDelta: -1,
    findingTotalDelta: 1,
    durationDeltaMs: -500,
  },
  caveats: ['Runtime observations alone do not prove semantic quality.'],
};

function action(
  commandName: OperatorActionView['commandName'],
  status: OperatorActionView['status'],
  result: unknown = null,
): OperatorActionView {
  return {
    id: crypto.randomUUID(),
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    toolCallId: `${TURN_ID}:${commandName}`,
    commandName,
    effect: commandName === 'get_run' || commandName === 'compare_runs' ? 'read' : 'execute',
    approvalMode: 'ask',
    approvalRequired: commandName === 'apply_workflow_draft',
    status,
    version: 1,
    arguments: {},
    result,
    error: null,
    runId: commandName === 'run_workflow' ? CANDIDATE_RUN_ID : null,
    createdAt: '2026-08-03T08:16:00.000Z',
    decidedAt: null,
    completedAt: status === 'succeeded' ? '2026-08-03T08:16:05.000Z' : null,
  };
}

function session(
  turnStatus: OperatorSessionDetail['turns'][number]['status'],
  actions: OperatorActionView[],
): OperatorSessionDetail {
  return {
    id: SESSION_ID,
    title: 'Improve completed run',
    approvalMode: 'ask',
    status: 'active',
    model: {
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      apiKeySecretId: '66666666-6666-4666-8666-666666666666',
      baseUrl: null,
    },
    createdAt: '2026-08-03T08:14:00.000Z',
    updatedAt: '2026-08-03T08:17:00.000Z',
    turns: [
      {
        id: TURN_ID,
        sessionId: SESSION_ID,
        status: turnStatus,
        temporalWorkflowId: `${TURN_ID}:workflow`,
        temporalRunId: `${TURN_ID}:run`,
        context: { path: `/runs/${SOURCE_RUN_ID}` },
        error: null,
        createdAt: reference.createdAt,
        startedAt: '2026-08-03T08:15:01.000Z',
        completedAt: turnStatus === 'completed' ? '2026-08-03T08:17:00.000Z' : null,
      },
    ],
    messages: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        sequence: 1,
        role: 'assistant',
        content: 'The candidate produced one additional finding with fewer failure events.',
        createdAt: '2026-08-03T08:17:00.000Z',
      },
    ],
    actions,
  };
}

describe('projectOperatorRunImprovement', () => {
  it('reports proposal progress after the source inspection completes', () => {
    const projected = projectOperatorRunImprovement(
      reference,
      session('running', [action('get_run', 'succeeded')]),
    );

    expect(projected).toMatchObject({
      status: 'running',
      stage: 'proposing',
      candidateRunId: null,
      comparison: null,
      kept: false,
    });
  });

  it('projects the durable comparison and final assistant summary', () => {
    const projected = projectOperatorRunImprovement(
      reference,
      session('completed', [
        action('get_run', 'succeeded'),
        action('propose_workflow_draft', 'succeeded'),
        action('apply_workflow_draft', 'succeeded'),
        action('run_workflow', 'succeeded'),
        action('compare_runs', 'succeeded', comparison),
      ]),
    );

    expect(projected).toEqual({
      ...reference,
      status: 'completed',
      stage: 'completed',
      candidateRunId: CANDIDATE_RUN_ID,
      comparison,
      kept: false,
      summary: 'The candidate produced one additional finding with fewer failure events.',
      error: null,
    });
  });

  it('marks the comparison as kept only after the exact tested candidate is promoted', () => {
    const promotion = action('promote_workflow_version', 'succeeded', {
      kind: 'workflow-version-promoted',
      workflowId: comparison.candidate.workflowId,
      versionId: comparison.candidate.workflowVersionId,
      version: 2,
      name: 'Improved workflow',
      candidateRunId: CANDIDATE_RUN_ID,
      alreadyCurrent: false,
    });

    const projected = projectOperatorRunImprovement(
      reference,
      session('completed', [action('compare_runs', 'succeeded', comparison), promotion]),
    );

    expect(projected?.kept).toBe(true);
  });
});
