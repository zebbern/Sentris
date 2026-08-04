import type {
  AgentCapabilityTrace,
  ExecutionScope,
  JsonObject,
  McpOperation,
  McpOperationResult,
} from '@sentris/shared';

import type { AgentToolStatus } from '../components/ai/agent-tool-access.js';
import type { AgentActivityTimeout } from '../components/ai/agent-execution-profile.js';
import type { RunComponentActivityInput, RunComponentActivityOutput } from './types.js';

export interface WorkflowAgentStateRef {
  fileId: string;
  rootFileId: string;
}

export interface WorkflowAgentTurnInput {
  component: RunComponentActivityInput;
  agentRunId: string;
  /** Follow-up turns belong to the Agent conversation, not to another graph-node execution. */
  recordNodeLifecycle?: boolean;
}

export interface WorkflowAgentSetupInput extends WorkflowAgentTurnInput {
  initialStateFileId: string;
}

export interface WorkflowAgentFollowUpSetupInput extends WorkflowAgentSetupInput {
  sourceAgentRunId: string;
  sourceState: WorkflowAgentStateRef;
  userInput: string;
}

export interface WorkflowAgentFollowUpWorkflowInput extends WorkflowAgentFollowUpSetupInput {
  turnId: string;
  conversationId: string;
}

export interface WorkflowAgentAuthorityRef {
  scope: ExecutionScope;
  capabilitySnapshotId: string;
}

export interface WorkflowAgentSetupOutput {
  state: WorkflowAgentStateRef;
  stepLimit: number;
  toolTimeoutMs: number;
  /** Missing only on setup results recorded before timeout propagation was introduced. */
  modelActivityTimeout?: AgentActivityTimeout;
  toolStatus: AgentToolStatus;
  authority?: WorkflowAgentAuthorityRef;
}

export interface WorkflowAgentContinuation {
  state: WorkflowAgentStateRef;
  nextStep: number;
}

export interface WorkflowAgentChildInput extends WorkflowAgentTurnInput {
  setup: WorkflowAgentSetupOutput;
  /** Present after Continue-As-New; the original setup remains immutable. */
  continuation?: WorkflowAgentContinuation;
}

export interface WorkflowAgentModelStepInput extends WorkflowAgentTurnInput {
  state: WorkflowAgentStateRef;
  outputStateFileId: string;
  step: number;
}

export interface WorkflowAgentToolCall {
  modelToolCallId: string;
  toolName: string;
  sourceId: string;
  arguments: JsonObject;
  /** Absent only on model deltas created before generalized MCP operations. */
  authorizationTarget?: string;
  /** Absent only on model deltas created before generalized MCP operations. */
  operation?: McpOperation;
  /** Absent on model deltas created before readable capability tracing. */
  capability?: AgentCapabilityTrace;
}

export interface WorkflowAgentModelStepOutput {
  state: WorkflowAgentStateRef;
  finishReason: string;
  toolCalls: Pick<WorkflowAgentToolCall, 'modelToolCallId' | 'toolName'>[];
}

export interface WorkflowAgentToolPreparationInput extends WorkflowAgentTurnInput {
  state: WorkflowAgentStateRef;
  authority: WorkflowAgentAuthorityRef;
  invocationId: string;
  requestedAt: string;
  deadlineAt: string;
  planFileId: string;
  resultFileId: string;
  step: number;
  toolIndex: number;
}

export interface WorkflowAgentToolExecutionOutput {
  resultFileId: string;
  kind: McpOperationResult['kind'];
  message?: string;
}

export type WorkflowAgentToolPreparationOutput =
  | { kind: 'prepared'; planFileId: string; resultFileId: string }
  | { kind: 'terminal'; result: WorkflowAgentToolExecutionOutput };

export interface WorkflowAgentToolDispatchInput extends WorkflowAgentTurnInput {
  state: WorkflowAgentStateRef;
  planFileId: string;
  resultFileId: string;
  step: number;
  toolIndex: number;
}

export interface WorkflowAgentToolReconcileInput extends WorkflowAgentToolDispatchInput {
  cause: 'failure' | 'deadline' | 'cancelled';
}

export interface WorkflowAgentCheckpointInput extends WorkflowAgentTurnInput {
  state: WorkflowAgentStateRef;
  outputStateFileId: string;
  step: number;
  executions: WorkflowAgentToolExecutionOutput[];
}

export interface WorkflowAgentFinalizeInput extends WorkflowAgentTurnInput {
  state: WorkflowAgentStateRef;
  toolStatus: AgentToolStatus;
  outputFileId: string;
}

export interface WorkflowAgentFailureInput extends WorkflowAgentTurnInput {
  error: string;
  cancelled?: boolean;
}

export interface WorkflowAgentActivities {
  workflowAgentSetupActivity(input: WorkflowAgentSetupInput): Promise<WorkflowAgentSetupOutput>;
  workflowAgentFollowUpSetupActivity(
    input: WorkflowAgentFollowUpSetupInput,
  ): Promise<WorkflowAgentSetupOutput>;
  workflowAgentModelStepActivity(
    input: WorkflowAgentModelStepInput,
  ): Promise<WorkflowAgentModelStepOutput>;
  workflowAgentPrepareToolActivity(
    input: WorkflowAgentToolPreparationInput,
  ): Promise<WorkflowAgentToolPreparationOutput>;
  workflowAgentDispatchToolActivity(
    input: WorkflowAgentToolDispatchInput,
  ): Promise<WorkflowAgentToolExecutionOutput>;
  workflowAgentReconcileToolActivity(
    input: WorkflowAgentToolReconcileInput,
  ): Promise<WorkflowAgentToolExecutionOutput>;
  workflowAgentCheckpointActivity(
    input: WorkflowAgentCheckpointInput,
  ): Promise<WorkflowAgentStateRef>;
  workflowAgentFinalizeActivity(
    input: WorkflowAgentFinalizeInput,
  ): Promise<RunComponentActivityOutput>;
  workflowAgentFailActivity(input: WorkflowAgentFailureInput): Promise<void>;
}
