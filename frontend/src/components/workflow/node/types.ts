import type { NodeStatus, FrontendNodeData } from '@/schemas/node';
import type { NodeVisualState } from '@/store/executionTimelineStore';
import type { InputPort, OutputPort } from '@/schemas/component';

export type { NodeStatus, FrontendNodeData, NodeVisualState, InputPort, OutputPort };

/**
 * Props for the TerminalButton component.
 * Uses the workflow UI store dock actions internally — no ReactFlow node creation.
 */
export interface TerminalButtonProps {
  /** The workflow node ID this terminal belongs to. */
  id: string;
  /** Display label for the terminal tab (node label). */
  label: string;
  /** The currently selected run ID. */
  selectedRunId: string;
  /** Whether the terminal data is still loading. */
  isTerminalLoading: boolean;
  /** Terminal session data (used to show the green dot indicator). */
  terminalSession: { chunks?: unknown[] } | undefined;
}

/**
 * Props for the ParametersDisplay component
 */
export interface ParametersDisplayProps {
  componentParameters: any[];
  requiredParams: any[];
  nodeParameters: Record<string, any> | undefined;
  position?: 'top' | 'bottom';
}

/**
 * Props for the NodeProgressBar component
 */
export interface NodeProgressBarProps {
  progress: number;
  events: number;
  totalEvents: number;
  isRunning: boolean;
  status: NodeStatus;
}

/**
 * Node style state returned by getNodeStyle
 */
export interface NodeStyleState {
  border: string;
  bg: string;
  icon: string | null;
  iconClass?: string;
}
