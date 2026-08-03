import {
  OperatorRunComparisonResultSchema,
  OperatorWorkflowPromotionResultSchema,
  type OperatorRunComparisonResult,
  type OperatorRunImprovementReference,
  type OperatorSessionDetail,
  type OperatorTurnStatus,
} from '@sentris/shared';
import { useMemo } from 'react';

import {
  useOperatorRunImprovement,
  useOperatorSessionStream,
} from '@/hooks/queries/useOperatorQueries';

export type OperatorRunImprovementStage =
  | 'queued'
  | 'inspecting'
  | 'proposing'
  | 'awaiting_approval'
  | 'applying'
  | 'rerunning'
  | 'comparing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ProjectedOperatorRunImprovement extends OperatorRunImprovementReference {
  status: OperatorTurnStatus;
  stage: OperatorRunImprovementStage;
  candidateRunId: string | null;
  comparison: OperatorRunComparisonResult | null;
  kept: boolean;
  summary: string | null;
  error: string | null;
}

export function projectOperatorRunImprovement(
  reference: OperatorRunImprovementReference,
  session: OperatorSessionDetail,
): ProjectedOperatorRunImprovement | null {
  const turn = session.turns.find((candidate) => candidate.id === reference.turnId);
  if (!turn) return null;

  const actions = session.actions.filter((action) => action.turnId === reference.turnId);
  const comparisonAction = actions.find((action) => action.commandName === 'compare_runs');
  const parsedComparison = OperatorRunComparisonResultSchema.safeParse(comparisonAction?.result);
  const kept = parsedComparison.success
    ? session.actions.some((action) => {
        if (action.status !== 'succeeded') return false;
        const promotion = OperatorWorkflowPromotionResultSchema.safeParse(action.result);
        return (
          promotion.success &&
          promotion.data.workflowId === parsedComparison.data.candidate.workflowId &&
          promotion.data.versionId === parsedComparison.data.candidate.workflowVersionId &&
          promotion.data.candidateRunId === parsedComparison.data.candidate.runId
        );
      })
    : false;
  const runAction = actions.find((action) => action.commandName === 'run_workflow');
  const applyAction = actions.find((action) => action.commandName === 'apply_workflow_draft');
  const proposalAction = actions.find((action) => action.commandName === 'propose_workflow_draft');
  const inspectionAction = actions.find((action) => action.commandName === 'get_run');
  const summary = [...session.messages]
    .reverse()
    .find((message) => message.turnId === reference.turnId && message.role === 'assistant');

  let stage: OperatorRunImprovementStage;
  if (turn.status === 'completed') stage = 'completed';
  else if (turn.status === 'failed') stage = 'failed';
  else if (turn.status === 'cancelled') stage = 'cancelled';
  else if (turn.status === 'queued') stage = 'queued';
  else if (turn.status === 'awaiting_approval') stage = 'awaiting_approval';
  else if (comparisonAction) stage = 'comparing';
  else if (runAction) stage = 'rerunning';
  else if (applyAction || proposalAction) stage = 'applying';
  else if (inspectionAction?.status === 'succeeded') stage = 'proposing';
  else stage = 'inspecting';

  return {
    ...reference,
    status: turn.status,
    stage,
    candidateRunId: parsedComparison.success
      ? parsedComparison.data.candidate.runId
      : (runAction?.runId ?? null),
    comparison: parsedComparison.success ? parsedComparison.data : null,
    kept,
    summary: summary?.content ?? null,
    error: turn.error,
  };
}

export function useOperatorRunImprovementProjection(sourceRunId: string | null | undefined) {
  const referenceQuery = useOperatorRunImprovement(sourceRunId);
  const reference = referenceQuery.data?.improvement ?? null;
  const sessionQuery = useOperatorSessionStream(reference?.sessionId);
  const improvement = useMemo(
    () =>
      reference && sessionQuery.data
        ? projectOperatorRunImprovement(reference, sessionQuery.data)
        : null,
    [reference, sessionQuery.data],
  );

  return {
    improvement,
    isLoading: referenceQuery.isLoading || Boolean(reference && sessionQuery.isLoading),
    error: referenceQuery.error ?? sessionQuery.error ?? null,
  };
}
