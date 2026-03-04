import { useDroppable } from '@dnd-kit/core';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { KanbanCard } from './KanbanCard';
import { TRIAGE_STATUS_META } from './types';
import type { FindingTriageStatus, FindingWithTriage, OrgMember } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KanbanColumnProps {
  status: FindingTriageStatus;
  findings: FindingWithTriage[];
  onCardClick: (findingId: string) => void;
  isLoading?: boolean;
  selectedIds: Set<string>;
  onSelectToggle: (id: string) => void;
  isSelectionDisabled: boolean;
  membersMap: Map<string, OrgMember>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanColumn({
  status,
  findings,
  onCardClick,
  isLoading,
  selectedIds,
  onSelectToggle,
  isSelectionDisabled,
  membersMap,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = TRIAGE_STATUS_META[status];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col min-w-[280px] max-w-[320px] rounded-lg border transition-colors',
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30',
      )}
      aria-label={`${meta.label} column, ${findings.length} finding${findings.length !== 1 ? 's' : ''}`}
    >
      {/* Column header */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 rounded-t-lg border-b',
          meta.bgClass,
        )}
      >
        <span className={cn('text-sm font-semibold', meta.textClass)}>{meta.label}</span>
        <Badge variant="secondary" className="text-xs h-5 min-w-[20px] justify-center">
          {findings.length}
        </Badge>
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-280px)]">
        {isLoading && (
          <>
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </>
        )}

        {!isLoading && findings.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
            No findings
          </div>
        )}

        {!isLoading &&
          findings.map((finding) => (
            <KanbanCard
              key={finding.id}
              finding={finding}
              onClick={() => onCardClick(finding.id)}
              isSelected={selectedIds.has(finding.id)}
              onSelectToggle={onSelectToggle}
              isSelectionDisabled={isSelectionDisabled}
              assignee={
                finding.triage?.assigneeUserId
                  ? membersMap.get(finding.triage.assigneeUserId)
                  : undefined
              }
            />
          ))}
      </div>
    </div>
  );
}
