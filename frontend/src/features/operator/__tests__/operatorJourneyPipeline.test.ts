import { describe, expect, it } from 'bun:test';
import type { OperatorActionView, OperatorSessionDetail } from '@sentris/shared';

import { projectOperatorJourneyPipeline } from '../operatorJourneyPipelineProjector';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_RUN_ID = 'sentris-run-source';
const CANDIDATE_RUN_ID = 'sentris-run-candidate';
const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333';
const BASE_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const CANDIDATE_VERSION_ID = '55555555-5555-4555-8555-555555555555';

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
    effect: ['get_run', 'compare_runs'].includes(commandName) ? 'read' : 'execute',
    approvalMode: 'ask',
    approvalRequired: commandName === 'apply_workflow_draft',
    status,
    version: 1,
    arguments: {},
    result,
    error: status === 'failed' ? 'Draft validation failed' : null,
    runId: commandName === 'run_workflow' ? CANDIDATE_RUN_ID : null,
    createdAt: '2026-08-03T08:16:00.000Z',
    decidedAt: null,
    completedAt: status === 'succeeded' ? '2026-08-03T08:16:05.000Z' : null,
  };
}

function session(
  status: OperatorSessionDetail['turns'][number]['status'],
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
        status,
        temporalWorkflowId: `${TURN_ID}:workflow`,
        temporalRunId: `${TURN_ID}:run`,
        context: { path: `/runs/${SOURCE_RUN_ID}` },
        journey: { kind: 'improve_run', sourceRunId: SOURCE_RUN_ID },
        error: null,
        createdAt: '2026-08-03T08:15:00.000Z',
        startedAt: '2026-08-03T08:15:01.000Z',
        completedAt: status === 'completed' ? '2026-08-03T08:17:00.000Z' : null,
      },
    ],
    messages: [],
    actions,
  };
}

const comparison = {
  kind: 'run-comparison',
  assessment: 'improved',
  comparable: true,
  source: {
    runId: SOURCE_RUN_ID,
    workflowId: WORKFLOW_ID,
    workflowVersionId: BASE_VERSION_ID,
    status: 'COMPLETED',
    durationMs: 2_000,
    trace: { availability: 'available', failedEventCount: 1 },
    findings: { availability: 'available', total: 2 },
  },
  candidate: {
    runId: CANDIDATE_RUN_ID,
    workflowId: WORKFLOW_ID,
    workflowVersionId: CANDIDATE_VERSION_ID,
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
  caveats: [],
} as const;

describe('projectOperatorJourneyPipeline', () => {
  it('shows the durable improvement journey before its first action is recorded', () => {
    const projection = projectOperatorJourneyPipeline(session('queued', []));

    expect(projection?.sourceRunId).toBe(SOURCE_RUN_ID);
    expect(projection?.stages.map(({ id, state }) => [id, state])).toEqual([
      ['inspect', 'active'],
      ['draft', 'pending'],
      ['save', 'pending'],
      ['run', 'pending'],
      ['compare', 'pending'],
      ['decision', 'pending'],
    ]);
  });

  it('makes approval visible without treating the save as complete', () => {
    const projection = projectOperatorJourneyPipeline(
      session('awaiting_approval', [
        action('get_run', 'succeeded'),
        action('propose_workflow_edits', 'succeeded'),
        action('apply_workflow_draft', 'pending_approval'),
      ]),
    );

    expect(projection?.stages.map(({ id, state }) => [id, state])).toEqual([
      ['inspect', 'completed'],
      ['draft', 'completed'],
      ['save', 'attention'],
      ['run', 'pending'],
      ['compare', 'pending'],
      ['decision', 'pending'],
    ]);
  });

  it('projects the tested candidate and exact later Keep decision', () => {
    const promotion = {
      ...action('promote_workflow_version', 'succeeded'),
      id: 'promotion-action',
      turnId: '77777777-7777-4777-8777-777777777777',
      result: {
        kind: 'workflow-version-promoted',
        workflowId: WORKFLOW_ID,
        versionId: CANDIDATE_VERSION_ID,
        version: 2,
        name: 'Improved workflow',
        candidateRunId: CANDIDATE_RUN_ID,
        alreadyCurrent: false,
      },
    } satisfies OperatorActionView;

    const value = session('completed', [
      action('get_run', 'succeeded'),
      action('propose_workflow_edits', 'succeeded'),
      action('apply_workflow_draft', 'succeeded'),
      action('run_workflow', 'succeeded'),
      action('compare_runs', 'succeeded', comparison),
      promotion,
    ]);

    const projection = projectOperatorJourneyPipeline(value);

    expect(projection?.candidateRunId).toBe(CANDIDATE_RUN_ID);
    expect(projection?.stages.every((stage) => stage.state === 'completed')).toBe(true);
    expect(projection?.stages[5]?.detail).toBe('Candidate kept');
  });

  it('surfaces the failed stage and leaves later work pending', () => {
    const projection = projectOperatorJourneyPipeline(
      session('failed', [
        action('get_run', 'succeeded'),
        action('propose_workflow_edits', 'failed'),
      ]),
    );

    expect(projection?.stages[1]).toMatchObject({
      id: 'draft',
      state: 'failed',
      detail: 'Draft validation failed',
    });
    expect(projection?.stages.slice(2).every((stage) => stage.state === 'pending')).toBe(true);
  });
});
