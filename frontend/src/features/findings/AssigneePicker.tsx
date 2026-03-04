import { useState } from 'react';
import { Check, ChevronsUpDown, UserX, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useOrgMembersQuery } from '@/hooks/queries/useFindingsQueries';
import type { OrgMember } from '@/features/findings/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssigneePickerProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function MemberRow({ member, isSelected }: { member: OrgMember; isSelected: boolean }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <Avatar className="h-6 w-6">
        {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.displayName} />}
        <AvatarFallback className="text-[10px]">{getInitials(member.displayName)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col min-w-0">
        <span className="text-sm truncate">{member.displayName}</span>
        <span className="text-xs text-muted-foreground truncate">{member.email}</span>
      </div>
      {isSelected && <Check className="ml-auto h-4 w-4 shrink-0" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssigneePicker({
  value,
  onChange,
  isLoading = false,
  disabled = false,
}: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: membersResponse, isLoading: isMembersLoading } = useOrgMembersQuery();
  const members = membersResponse?.members ?? [];

  const selectedMember = members.find((m) => m.userId === value) ?? null;

  const handleSelect = (userId: string | null) => {
    onChange(userId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select assignee"
          className="w-full justify-between h-9 text-sm"
          disabled={disabled || isLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Updating…
            </span>
          ) : selectedMember ? (
            <span className="flex items-center gap-2 min-w-0">
              <Avatar className="h-5 w-5">
                {selectedMember.avatarUrl && (
                  <AvatarImage src={selectedMember.avatarUrl} alt={selectedMember.displayName} />
                )}
                <AvatarFallback className="text-[9px]">
                  {getInitials(selectedMember.displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{selectedMember.displayName}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="max-h-[240px] overflow-y-auto">
          {/* Unassign option */}
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent cursor-pointer',
              !value && 'bg-accent',
            )}
            onClick={() => handleSelect(null)}
          >
            <UserX className="h-4 w-4 text-muted-foreground" />
            <span>Unassigned</span>
            {!value && <Check className="ml-auto h-4 w-4" />}
          </button>

          {/* Divider */}
          <div className="border-t my-1" />

          {/* Loading state */}
          {isMembersLoading && (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading members…
            </div>
          )}

          {/* Members list */}
          {members.map((member) => (
            <button
              type="button"
              key={member.userId}
              className={cn(
                'flex w-full items-center px-3 py-2 hover:bg-accent cursor-pointer',
                value === member.userId && 'bg-accent',
              )}
              onClick={() => handleSelect(member.userId)}
            >
              <MemberRow member={member} isSelected={value === member.userId} />
            </button>
          ))}

          {/* Empty state */}
          {!isMembersLoading && members.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">No members found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
