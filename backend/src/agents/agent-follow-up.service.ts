import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkflowNotFoundError } from '@temporalio/client';

import { AgentConversationRepository } from '../agent-trace/agent-conversation.repository';
import { AgentTraceService } from '../agent-trace/agent-trace.service';
import type { AgentConversationTurnRecord } from '../database/schema';
import { TemporalService } from '../temporal/temporal.service';
import { WorkflowGraphSchema } from '../workflows/dto/workflow-graph.dto';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { WorkflowVersionRepository } from '../workflows/repository/workflow-version.repository';

@Injectable()
export class AgentFollowUpService {
  constructor(
    private readonly trace: AgentTraceService,
    private readonly conversations: AgentConversationRepository,
    private readonly temporal: TemporalService,
    private readonly runs: WorkflowRunRepository,
    private readonly versions: WorkflowVersionRepository,
  ) {}

  async start(input: {
    agentRunId: string;
    requestId: string;
    message: string;
    organizationId: string | null;
  }) {
    const existing = await this.conversations.findById(input.requestId);
    if (existing) {
      this.assertMatchingRequest(existing, input);
      if (existing.status !== 'queued' || existing.temporalRunId) {
        return this.acceptedResponse(existing);
      }
    }
    const continuation = existing
      ? {
          conversationId: existing.conversationId,
          sourceAgentRunId: existing.sourceAgentRunId,
          state: {
            fileId: existing.sourceStateFileId,
            rootFileId: existing.sourceStateRootFileId,
          },
        }
      : await this.trace.getLatestContinuation(input.agentRunId);
    if (!continuation) {
      throw new ConflictException(
        'This Agent is still running or does not have durable continuation state',
      );
    }
    const conversation = await this.trace.getConversation(continuation.conversationId);
    if (!conversation) throw new NotFoundException('Agent conversation was not found');
    const run = await this.runs.findByRunId(conversation.workflowRunId, {
      organizationId: input.organizationId,
    });
    if (!run || run.organizationId !== input.organizationId) {
      throw new NotFoundException(`Workflow run ${conversation.workflowRunId} not found`);
    }
    if (!run.workflowVersionId) {
      throw new UnprocessableEntityException('The source run has no immutable workflow version');
    }
    const version = await this.versions.findById(run.workflowVersionId, {
      organizationId: run.organizationId,
    });
    const graphResult = WorkflowGraphSchema.safeParse(version?.graph);
    if (!version || !graphResult.success) {
      throw new UnprocessableEntityException('The source workflow graph is unavailable');
    }
    const node = graphResult.data.nodes.find((candidate) => candidate.id === conversation.nodeRef);
    if (!node || node.type !== 'core.ai.agent') {
      throw new UnprocessableEntityException('The source Agent node no longer exists');
    }
    const connectedToolNodeIds = [
      ...new Set(
        graphResult.data.edges
          .filter((edge) => edge.target === conversation.nodeRef && edge.targetHandle === 'tools')
          .map((edge) => edge.source),
      ),
    ].sort();
    const agentRunId = `${continuation.conversationId}:follow-up:${input.requestId}`;
    const temporalWorkflowId = `sentris-agent-follow-up:${input.requestId}`;
    const turn =
      existing ??
      (await this.conversations.createTurn({
        id: input.requestId,
        conversationId: continuation.conversationId,
        agentRunId,
        sourceAgentRunId: continuation.sourceAgentRunId,
        organizationId: run.organizationId,
        workflowRunId: run.runId,
        nodeRef: conversation.nodeRef,
        prompt: input.message,
        sourceStateFileId: continuation.state.fileId,
        sourceStateRootFileId: continuation.state.rootFileId,
        temporalWorkflowId,
      }));

    try {
      const started = await this.temporal.startWorkflow({
        workflowType: 'workflowAgentFollowUpWorkflow',
        workflowId: temporalWorkflowId,
        args: [
          {
            turnId: turn.id,
            conversationId: continuation.conversationId,
            agentRunId,
            sourceAgentRunId: continuation.sourceAgentRunId,
            sourceState: continuation.state,
            initialStateFileId: input.requestId,
            userInput: input.message,
            component: {
              runId: run.runId,
              workflowId: run.workflowId,
              workflowVersionId: run.workflowVersionId,
              organizationId: run.organizationId,
              scopeId: run.scopeId,
              action: { ref: conversation.nodeRef, componentId: 'core.ai.agent' },
              inputs: {},
              params: {},
              metadata: { connectedToolNodeIds },
            },
          },
        ],
        workflowExecutionTimeout: '24 hours',
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
      await this.conversations.markStarted(turn.id, started.runId);
      return this.acceptedResponse({ ...turn, temporalRunId: started.runId, status: 'running' });
    } catch (error: unknown) {
      try {
        const recovered = await this.temporal.describeWorkflow({ workflowId: temporalWorkflowId });
        await this.conversations.markStarted(turn.id, recovered.runId);
        return this.acceptedResponse({
          ...turn,
          temporalRunId: recovered.runId,
          status: 'running',
        });
      } catch (recoveryError: unknown) {
        if (recoveryError instanceof WorkflowNotFoundError) {
          const message = error instanceof Error ? error.message : String(error);
          await this.conversations.markStartFailed(turn.id, message);
        }
      }
      throw error;
    }
  }

  private assertMatchingRequest(
    turn: AgentConversationTurnRecord,
    input: { agentRunId: string; message: string; organizationId: string | null },
  ): void {
    if (
      turn.conversationId !== input.agentRunId ||
      turn.prompt !== input.message ||
      turn.organizationId !== input.organizationId
    ) {
      throw new ConflictException('The follow-up request ID is already in use');
    }
  }

  private acceptedResponse(turn: AgentConversationTurnRecord) {
    return {
      conversationId: turn.conversationId,
      agentRunId: turn.agentRunId,
      turnIndex: turn.turnIndex,
      temporalWorkflowId: turn.temporalWorkflowId,
      temporalRunId: turn.temporalRunId,
      status: turn.status,
    };
  }
}
