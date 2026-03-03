import type { Node } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';
import type { WorkflowSchedule } from '@sentris/shared';

/** Minimal shape of a JSON Schema property descriptor. */
export interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

/** Shape returned by normalizeRuntimeInputs for entry-point runtime inputs. */
export interface RuntimeInputDefinition {
  id: string;
  type?: string;
}

export interface ConfigPanelProps {
  selectedNode: Node<FrontendNodeData> | null;
  onClose: () => void;
  onUpdateNode?: (id: string, data: Partial<FrontendNodeData>) => void;
  workflowId?: string | null;
  workflowSchedules?: WorkflowSchedule[];
  schedulesLoading?: boolean;
  scheduleError?: string | null;
  onScheduleCreate?: () => void;
  onScheduleEdit?: (schedule: WorkflowSchedule) => void;
  onScheduleAction?: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void;
  onViewSchedules?: () => void;
}

export const PANEL_WIDTH = 432;

/** Parsed tool schema field for display in the tool section. */
export interface ToolSchemaField {
  id: string;
  type: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: unknown[];
}
