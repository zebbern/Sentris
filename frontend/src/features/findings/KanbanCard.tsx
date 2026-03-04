import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SeverityBadge } from '@/features/findings/SeverityBadge';
import type { FindingWithTriage, OrgMember } from '@/features/findings/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelativeTime(timestamp: string): string {
  try {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  } catch {
    return timestamp;
  }
}

function truncate(value: string | undefined, max = 50): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KanbanCardProps {
  finding: FindingWithTriage;
  onClick: () => void;
  isSelected: boolean;
  onSelectToggle: (id: string) => void;
  isSelectionDisabled: boolean;
  /** Resolved assignee member, if any. */
  assignee?: OrgMember;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanCard({
  finding,
  onClick,
  isSelected,
  onSelectToggle,
  isSelectionDisabled,
  assignee,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: finding.id,
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const status = finding.triage?.status ?? 'new';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md',
        isDragging && 'shadow-lg ring-2 ring-primary/50',
        isSelected && 'ring-2 ring-primary',
      )}
      role="button"
      tabIndex={0}
      aria-label={`Finding: ${finding.name ?? 'Unnamed'}, severity ${finding.severity ?? 'unknown'}, status ${status}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Top row: drag handle + checkbox + severity */}
      <div className="flex items-center gap-2 mb-2">
        {/* Drag handle */}
        <div
          className="touch-none text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing transition-colors"
          {...listeners}
          {...attributes}
          aria-label="Drag to change status"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>

        {/* Selection checkbox */}
        <Checkbox
          checked={isSelected}
          disabled={isSelectionDisabled && !isSelected}
          onCheckedChange={() => onSelectToggle(finding.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select finding ${finding.name ?? finding.id}`}
          className="h-3.5 w-3.5"
        />

        <SeverityBadge severity={finding.severity} />

        {/* Assignee avatar (right-aligned) */}
        {assignee && (
          <Avatar className="ml-auto h-5 w-5" title={assignee.displayName}>
            <AvatarImage src={assignee.avatarUrl ?? undefined} alt={assignee.displayName} />
            <AvatarFallback className="text-[8px]">
              {getInitials(assignee.displayName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* Finding name */}
      <button
        type="button"
        className="text-left w-full text-sm font-medium leading-tight hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        onClick={onClick}
      >
        {truncate(finding.name, 60)}
      </button>

      {/* Bottom row: asset + timestamp */}
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate max-w-[60%]" title={finding.asset_key}>
          {truncate(finding.asset_key, 30)}
        </span>
        <span className="whitespace-nowrap">{getRelativeTime(finding.timestamp)}</span>
      </div>
    </div>
  );
}
