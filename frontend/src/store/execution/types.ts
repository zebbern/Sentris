import type { ExecutionLog, ExecutionStatus, ExecutionStatusResponse } from '@/schemas/execution';
import type { NodeStatus } from '@/schemas/node';

// ---------------------------------------------------------------------------
// Shared types for the execution store family
// ---------------------------------------------------------------------------

export type ExecutionLifecycle =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TrackedRun {
  runId: string;
  workflowId: string;
  workflowName?: string;
  status: ExecutionLifecycle;
  startedAt?: string;
}

export interface TerminalStreamChunk {
  nodeRef: string;
  stream: 'stdout' | 'stderr' | 'pty' | string;
  chunkIndex: number;
  payload: string;
  recordedAt: string;
  deltaMs?: number;
}

export interface TerminalStreamState {
  nodeRef: string;
  stream: string;
  cursor: string | null;
  chunks: TerminalStreamChunk[];
  lastChunkIndex: number;
}

// Re-export schema types used by consumers
export type { ExecutionLog, ExecutionStatus, ExecutionStatusResponse, NodeStatus };
