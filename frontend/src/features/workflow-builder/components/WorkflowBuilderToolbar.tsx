import { TopBar } from '@/components/layout/TopBar';
import type { ExportFormat } from '@/features/workflow-builder/hooks/useWorkflowImportExport';

export interface WorkflowBuilderToolbarProps {
  workflowId: string | undefined;
  selectedRunId: string | null;
  selectedRunStatus: string | null;
  selectedRunOrgId: string | null;
  isInWorkflowBuilder: boolean;
  canManageWorkflows: boolean;
  hasAnalyticsSink: boolean;
  onRun: () => void;
  onSave: () => Promise<void> | void;
  onImport: (file: File) => Promise<void> | void;
  onExport: (format?: ExportFormat) => void;
  onPublishTemplate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToggleVersionHistory: () => void;
}

export function WorkflowBuilderToolbar({
  workflowId,
  selectedRunId,
  selectedRunStatus,
  selectedRunOrgId,
  isInWorkflowBuilder,
  canManageWorkflows,
  hasAnalyticsSink,
  onRun,
  onSave,
  onImport,
  onExport,
  onPublishTemplate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleVersionHistory,
}: WorkflowBuilderToolbarProps) {
  return (
    <TopBar
      workflowId={workflowId}
      selectedRunId={selectedRunId}
      selectedRunStatus={selectedRunStatus}
      selectedRunOrgId={selectedRunOrgId}
      isInWorkflowBuilder={isInWorkflowBuilder}
      onRun={onRun}
      onSave={onSave}
      onImport={onImport}
      onExport={onExport}
      onPublishTemplate={onPublishTemplate}
      canManageWorkflows={canManageWorkflows}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
      hasAnalyticsSink={hasAnalyticsSink}
      onToggleVersionHistory={onToggleVersionHistory}
    />
  );
}
