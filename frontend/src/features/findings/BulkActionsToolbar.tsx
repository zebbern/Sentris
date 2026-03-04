import { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { useBulkTriageMutation, useOrgMembersQuery } from '@/hooks/queries/useFindingsQueries';
import { FINDING_TRIAGE_STATUSES, TRIAGE_STATUS_META, type FindingTriageStatus } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface BulkActionsToolbarProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BulkActionsToolbar({ selectedIds, onClearSelection }: BulkActionsToolbarProps) {
  const bulkTriage = useBulkTriageMutation();
  const { data: membersData } = useOrgMembersQuery();
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  const count = selectedIds.size;
  const findingIds = Array.from(selectedIds);

  const handleSetStatus = (status: FindingTriageStatus) => {
    bulkTriage.mutate({ findingIds, status }, { onSuccess: () => onClearSelection() });
    setStatusOpen(false);
  };

  const handleAssign = (userId: string) => {
    bulkTriage.mutate(
      { findingIds, assigneeUserId: userId },
      { onSuccess: () => onClearSelection() },
    );
    setAssigneeOpen(false);
    setAssigneeSearch('');
  };

  const filteredMembers = (membersData?.members ?? []).filter(
    (m) =>
      m.displayName.toLowerCase().includes(assigneeSearch.toLowerCase()) ||
      m.email.toLowerCase().includes(assigneeSearch.toLowerCase()),
  );

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg px-4 py-3"
      role="toolbar"
      aria-label="Bulk actions toolbar"
    >
      <span className="text-sm font-medium whitespace-nowrap">
        {count} item{count !== 1 ? 's' : ''} selected
      </span>

      {/* Set Status */}
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={bulkTriage.isPending}>
            Set Status
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-1" align="center" side="top">
          <div className="flex flex-col">
            {FINDING_TRIAGE_STATUSES.filter((s) => s !== 'verified').map((status) => {
              const meta = TRIAGE_STATUS_META[status];
              return (
                <button
                  key={status}
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-left"
                  onClick={() => handleSetStatus(status)}
                >
                  <span
                    className={cn('h-2 w-2 rounded-full', meta.bgClass, meta.borderClass, 'border')}
                  />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Assign To */}
      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={bulkTriage.isPending}>
            Assign To
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="center" side="top">
          <Input
            placeholder="Search members…"
            value={assigneeSearch}
            onChange={(e) => setAssigneeSearch(e.target.value)}
            className="mb-2 h-8 text-sm"
            autoComplete="off"
          />
          <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
            {filteredMembers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No members found</p>
            )}
            {filteredMembers.map((member) => (
              <button
                key={member.userId}
                type="button"
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
                onClick={() => handleAssign(member.userId)}
              >
                <Avatar className="h-5 w-5">
                  <AvatarImage src={member.avatarUrl ?? undefined} alt={member.displayName} />
                  <AvatarFallback className="text-[8px]">
                    {getInitials(member.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{member.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear selection */}
      <Button variant="ghost" size="sm" onClick={onClearSelection} aria-label="Clear selection">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
