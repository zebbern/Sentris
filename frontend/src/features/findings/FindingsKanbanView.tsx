import { useMemo, useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';

import { useUpdateTriageMutation, useOrgMembersQuery } from '@/hooks/queries/useFindingsQueries';
import type { FindingItem } from '@/services/api/findings';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { BulkActionsToolbar } from './BulkActionsToolbar';
import {
  FINDING_TRIAGE_STATUSES,
  VALID_TRANSITIONS,
  type FindingTriageStatus,
  type FindingWithTriage,
  type OrgMember,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SELECTION = 100;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FindingsKanbanViewProps {
  items: FindingItem[];
  isLoading: boolean;
  onCardClick: (findingId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingsKanbanView({ items, isLoading, onCardClick }: FindingsKanbanViewProps) {
  const updateTriage = useUpdateTriageMutation();
  const { data: membersData } = useOrgMembersQuery();

  // Bulk selection state (client-only UI state)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  // Build members lookup map
  const membersMap = useMemo(() => {
    const map = new Map<string, OrgMember>();
    membersData?.members?.forEach((m) => map.set(m.userId, m));
    return map;
  }, [membersData]);

  // Cast items to FindingWithTriage (triage may be null from API)
  const findings = items as FindingWithTriage[];

  // Group findings by triage status
  const columnData = useMemo(() => {
    const grouped: Record<FindingTriageStatus, FindingWithTriage[]> = {
      new: [],
      triaged: [],
      in_progress: [],
      fixed: [],
      verified: [],
      wont_fix: [],
      accepted_risk: [],
    };

    for (const finding of findings) {
      const status = (finding.triage?.status ?? 'new') as FindingTriageStatus;
      if (grouped[status]) {
        grouped[status].push(finding);
      } else {
        grouped.new.push(finding);
      }
    }

    return grouped;
  }, [findings]);

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Active dragged finding for DragOverlay
  const activeFinding = useMemo(
    () => (activeDragId ? findings.find((f) => f.id === activeDragId) : null),
    [activeDragId, findings],
  );

  // Selection toggle
  const handleSelectToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_SELECTION) return prev;
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLiveMessage('Selection cleared');
  }, []);

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);

      const { active, over } = event;
      if (!over) return;

      const findingId = String(active.id);
      const targetStatus = String(over.id) as FindingTriageStatus;

      // Find the source status
      const finding = findings.find((f) => f.id === findingId);
      if (!finding) return;

      const sourceStatus = (finding.triage?.status ?? 'new') as FindingTriageStatus;

      // Skip if dropped on same column
      if (sourceStatus === targetStatus) return;

      // Validate transition
      const validTargets = VALID_TRANSITIONS[sourceStatus];
      if (!validTargets?.includes(targetStatus)) {
        setLiveMessage(`Cannot move from ${sourceStatus} to ${targetStatus}`);
        return;
      }

      setLiveMessage(`Moving finding to ${targetStatus}`);

      updateTriage.mutate({
        findingId,
        data: { status: targetStatus },
      });
    },
    [findings, updateTriage],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const isSelectionDisabled = selectedIds.size >= MAX_SELECTION;

  return (
    <div className="flex flex-col gap-4">
      {/* ARIA live region for drag-drop and selection announcements */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>

      {/* Selection live region */}
      {selectedIds.size > 0 && (
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {selectedIds.size} finding{selectedIds.size !== 1 ? 's' : ''} selected
        </div>
      )}

      {/* Kanban board */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 overflow-x-auto pb-4" role="region" aria-label="Kanban board">
          {FINDING_TRIAGE_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              findings={columnData[status]}
              onCardClick={onCardClick}
              isLoading={isLoading}
              selectedIds={selectedIds}
              onSelectToggle={handleSelectToggle}
              isSelectionDisabled={isSelectionDisabled}
              membersMap={membersMap}
            />
          ))}
        </div>

        {/* Drag overlay — renders the card being dragged */}
        <DragOverlay dropAnimation={null}>
          {activeFinding ? (
            <div className="opacity-90 rotate-2 scale-105 pointer-events-none">
              <KanbanCard
                finding={activeFinding}
                onClick={() => {}}
                isSelected={false}
                onSelectToggle={() => {}}
                isSelectionDisabled={false}
                assignee={
                  activeFinding.triage?.assigneeUserId
                    ? membersMap.get(activeFinding.triage.assigneeUserId)
                    : undefined
                }
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Bulk actions toolbar */}
      {selectedIds.size > 0 && (
        <BulkActionsToolbar selectedIds={selectedIds} onClearSelection={handleClearSelection} />
      )}
    </div>
  );
}
