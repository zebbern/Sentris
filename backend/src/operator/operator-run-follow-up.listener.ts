import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { RunLifecycleEvent } from '@sentris/shared';

import { TemporalService } from '../temporal/temporal.service';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { OperatorRepository } from './operator.repository';
import { readOperatorTurnPayload } from './operator-turn-payload';

const OPERATOR_RUN_FOLLOW_UP_WORKFLOW_TYPE = 'operatorRunFollowUpWorkflow';

@Injectable()
export class OperatorRunFollowUpListener {
  constructor(
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly operatorRepository: OperatorRepository,
    private readonly temporalService: TemporalService,
  ) {}

  @OnEvent('run.status.terminal', { async: true })
  async handleRunTerminal(payload: RunLifecycleEvent): Promise<void> {
    const run = await this.workflowRunRepository.findByRunId(payload.runId, {
      organizationId: payload.organizationId,
    });
    if (!run?.triggerSource) return;

    const source = await this.operatorRepository.getActionWithTurnSession(run.triggerSource);
    if (
      !source ||
      source.session.organizationId !== payload.organizationId ||
      (source.action.commandName !== 'run_workflow' && source.action.commandName !== 'retry_run') ||
      readOperatorTurnPayload(source.turn.context).journey?.kind === 'improve_run'
    ) {
      return;
    }

    try {
      await this.temporalService.startWorkflow({
        workflowType: OPERATOR_RUN_FOLLOW_UP_WORKFLOW_TYPE,
        workflowId: `operator-run-follow-up:${source.action.id}`,
        args: [
          {
            sessionId: source.session.id,
            turnId: source.turn.id,
            organizationId: source.session.organizationId,
            sourceActionId: source.action.id,
            runId: payload.runId,
            workflowId: payload.workflowId,
          },
        ],
        workflowExecutionTimeout: '7 days',
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    } catch (error: unknown) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw error;
    }
  }
}
