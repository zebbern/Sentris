import type { UIMessage, UIMessageChunk } from 'ai';
import type { AgentCapabilityTrace } from '@sentris/shared';
import type {
  AgentNodeOutput,
  AgentReasoningAction,
  AgentReasoningObservation,
} from '@/types/agent';

export type { AgentNodeOutput };

export interface WorkflowRunResult {
  runId: string;
  result?: {
    outputs?: Record<string, AgentNodeOutput>;
  };
}

export interface AgentTraceChunk {
  sequence: number;
  timestamp: string;
  chunk: UIMessageChunk;
}

export interface AgentDerivedStep {
  key: string;
  stepNumber?: number;
  finishReason?: string;
  thought?: string;
  actions: AgentReasoningAction[];
  observations: AgentReasoningObservation[];
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  toolError?: unknown;
  capability?: AgentCapabilityTrace;
  timestamp?: string;
  sequence: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  isComplete: boolean;
}

export interface AgentTranscriptState {
  loading: boolean;
  error: string | null;
  cursor: number;
  messages: UIMessage[] | null;
  parts: AgentTraceChunk[];
  steps: AgentDerivedStep[];
}

export interface AgentTracePanelProps {
  runId: string | null;
}

export interface AgentRunCardProps {
  nodeId: string;
  agentRunId: string;
  runId: string;
  live: boolean;
  /** Keep following a not-yet-finished transcript without presenting the agent as executing. */
  follow?: boolean;
  isSelected?: boolean;
  onFocus?: () => void;
  prompt?: string | null;
  responseText?: string | null;
}
