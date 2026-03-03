import { createPortal } from 'react-dom';
import type { Node } from '@xyflow/react';

import { ConfigPanel } from './ConfigPanel';
import type { NodeData, FrontendNodeData } from '@/schemas/node';
import type { ResolvedScheduleContext } from './canvas-schedule-context';
import { cn } from '@/lib/utils';

interface CanvasConfigPanelProps {
  selectedNode: Node<NodeData>;
  isMobile: boolean;
  configPanelWidth: number;
  onClose: () => void;
  onUpdateNode: (id: string, data: Partial<FrontendNodeData>) => void;
  workflowId?: string | null;
  schedule: ResolvedScheduleContext;
}

/**
 * Renders ConfigPanel in a mobile portal or inline desktop panel,
 * eliminating the rendering duplication previously in Canvas.tsx.
 */
export function CanvasConfigPanel({
  selectedNode,
  isMobile,
  configPanelWidth,
  onClose,
  onUpdateNode,
  workflowId,
  schedule,
}: CanvasConfigPanelProps) {
  const configPanelElement = (
    <ConfigPanel
      selectedNode={selectedNode}
      onClose={onClose}
      onUpdateNode={onUpdateNode}
      workflowId={workflowId}
      workflowSchedules={schedule.resolvedWorkflowSchedules}
      schedulesLoading={schedule.resolvedSchedulesLoading}
      scheduleError={schedule.resolvedScheduleError}
      onScheduleCreate={schedule.resolvedOnScheduleCreate}
      onScheduleEdit={schedule.resolvedOnScheduleEdit}
      onScheduleAction={schedule.resolvedOnScheduleAction}
      onScheduleDelete={schedule.resolvedOnScheduleDelete}
      onViewSchedules={schedule.resolvedOnViewSchedules}
    />
  );

  if (isMobile) {
    return createPortal(
      <div className="flex h-full w-full overflow-hidden bg-background">{configPanelElement}</div>,
      document.getElementById('mobile-bottom-sheet-portal') || document.body,
    );
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden transition-all duration-150 ease-out',
        selectedNode ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
      style={{
        width: configPanelWidth,
        transition: 'width 150ms ease-out, opacity 150ms ease-out',
      }}
    >
      {configPanelElement}
    </div>
  );
}
