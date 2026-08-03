// Pure projection of persisted Operator state; this module owns no execution state.
import {
  OperatorPromoteWorkflowVersionInputSchema,
  OperatorRunComparisonResultSchema,
  OperatorWorkflowPromotionResultSchema,
  type OperatorActionView,
  type OperatorSessionDetail,
  type OperatorTurnStatus,
} from '@sentris/shared';

export type OperatorJourneyStageId = 'inspect' | 'draft' | 'save' | 'run' | 'compare' | 'decision';

export type OperatorJourneyStageState = 'pending' | 'active' | 'attention' | 'completed' | 'failed';

export interface OperatorJourneyPipelineStage {
  id: OperatorJourneyStageId;
  label: string;
  state: OperatorJourneyStageState;
  detail: string;
}

export interface ProjectedOperatorJourneyPipeline {
  turnId: string;
  turnStatus: OperatorTurnStatus;
  sourceRunId: string;
  candidateRunId: string | null;
  stages: OperatorJourneyPipelineStage[];
}

const ACTIVE_TURN_STATUSES = new Set<OperatorTurnStatus>([
  'queued',
  'running',
  'awaiting_approval',
]);

function latestAction(
  actions: OperatorActionView[],
  commandNames: ReadonlySet<OperatorActionView['commandName']>,
): OperatorActionView | undefined {
  return [...actions].reverse().find((action) => commandNames.has(action.commandName));
}

function actionState(action: OperatorActionView | undefined): OperatorJourneyStageState {
  switch (action?.status) {
    case undefined:
      return 'pending';
    case 'succeeded':
      return 'completed';
    case 'pending_approval':
      return 'attention';
    case 'failed':
    case 'rejected':
      return 'failed';
    case 'proposed':
    case 'approved':
    case 'executing':
      return 'active';
  }
}

function actionDetail(action: OperatorActionView | undefined, completed: string): string {
  switch (action?.status) {
    case 'succeeded':
      return completed;
    case 'pending_approval':
      return 'Approval required';
    case 'failed':
      return action.error || 'Action failed';
    case 'rejected':
      return 'Action rejected';
    case 'proposed':
    case 'approved':
    case 'executing':
      return 'In progress';
    case undefined:
      return completed;
  }
}

function latestImprovementTurn(session: OperatorSessionDetail) {
  return session.turns.reduce<(typeof session.turns)[number] | undefined>((latest, turn) => {
    if (turn.journey?.kind !== 'improve_run') return latest;
    return !latest || turn.createdAt > latest.createdAt ? turn : latest;
  }, undefined);
}

export function projectOperatorJourneyPipeline(
  session: OperatorSessionDetail,
): ProjectedOperatorJourneyPipeline | null {
  const turn = latestImprovementTurn(session);
  if (!turn || turn.journey?.kind !== 'improve_run') return null;

  const actions = session.actions.filter((action) => action.turnId === turn.id);
  const inspectAction = latestAction(actions, new Set(['get_run']));
  const draftAction = latestAction(
    actions,
    new Set(['propose_workflow_draft', 'propose_workflow_edits']),
  );
  const saveAction = latestAction(actions, new Set(['apply_workflow_draft']));
  const runAction = latestAction(actions, new Set(['run_workflow']));
  const compareAction = latestAction(actions, new Set(['compare_runs']));
  const comparison = OperatorRunComparisonResultSchema.safeParse(compareAction?.result);
  const candidateRunId = comparison.success
    ? comparison.data.candidate.runId
    : (runAction?.runId ?? null);
  const promotionAction = comparison.success
    ? [...session.actions].reverse().find((action) => {
        if (action.commandName !== 'promote_workflow_version') return false;
        const result = OperatorWorkflowPromotionResultSchema.safeParse(action.result);
        const input = OperatorPromoteWorkflowVersionInputSchema.safeParse(action.arguments);
        const workflowId = result.success
          ? result.data.workflowId
          : input.success
            ? input.data.workflowId
            : null;
        const versionId = result.success
          ? result.data.versionId
          : input.success
            ? input.data.versionId
            : null;
        const candidateRunId = result.success
          ? result.data.candidateRunId
          : input.success
            ? input.data.candidateRunId
            : null;
        return (
          workflowId === comparison.data.candidate.workflowId &&
          versionId === comparison.data.candidate.workflowVersionId &&
          candidateRunId === comparison.data.candidate.runId
        );
      })
    : undefined;
  const promotion = OperatorWorkflowPromotionResultSchema.safeParse(promotionAction?.result);

  const stages: OperatorJourneyPipelineStage[] = [
    {
      id: 'inspect',
      label: 'Inspect',
      state: actionState(inspectAction),
      detail: actionDetail(inspectAction, 'Source inspected'),
    },
    {
      id: 'draft',
      label: 'Draft',
      state: actionState(draftAction),
      detail: actionDetail(draftAction, 'Revision drafted'),
    },
    {
      id: 'save',
      label: 'Save',
      state: actionState(saveAction),
      detail: actionDetail(saveAction, 'Candidate saved'),
    },
    {
      id: 'run',
      label: 'Run',
      state: actionState(runAction),
      detail: actionDetail(runAction, candidateRunId ? 'Candidate launched' : 'Candidate run'),
    },
    {
      id: 'compare',
      label: 'Compare',
      state: actionState(compareAction),
      detail: comparison.success
        ? `${comparison.data.assessment[0].toUpperCase()}${comparison.data.assessment.slice(1)}`
        : actionDetail(compareAction, 'Compare evidence'),
    },
    {
      id: 'decision',
      label: 'Decide',
      state: promotion.success
        ? 'completed'
        : promotionAction
          ? actionState(promotionAction)
          : comparison.success
            ? 'attention'
            : 'pending',
      detail: promotion.success
        ? 'Candidate kept'
        : promotionAction
          ? actionDetail(promotionAction, 'Candidate kept')
          : comparison.success
            ? 'Keep or revise'
            : 'Choose outcome',
    },
  ];

  const blockingIndex = stages.findIndex((stage) => stage.state !== 'completed');
  if (
    blockingIndex >= 0 &&
    stages[blockingIndex].state === 'pending' &&
    ACTIVE_TURN_STATUSES.has(turn.status)
  ) {
    stages[blockingIndex] = {
      ...stages[blockingIndex],
      state: 'active',
      detail:
        stages[blockingIndex].id === 'inspect' ? 'Inspecting source' : stages[blockingIndex].detail,
    };
  }

  if (
    blockingIndex >= 0 &&
    stages[blockingIndex].state === 'pending' &&
    (turn.status === 'failed' || turn.status === 'cancelled')
  ) {
    stages[blockingIndex] = {
      ...stages[blockingIndex],
      state: 'failed',
      detail: turn.error || (turn.status === 'cancelled' ? 'Journey cancelled' : 'Journey failed'),
    };
  }

  return {
    turnId: turn.id,
    turnStatus: turn.status,
    sourceRunId: turn.journey.sourceRunId,
    candidateRunId,
    stages,
  };
}
