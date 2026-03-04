import { useState } from 'react';
import { Check, Filter } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { FINDING_TRIAGE_STATUSES, TRIAGE_STATUS_META } from '@/features/findings/types';
import type { FindingTriageStatus } from '@/features/findings/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FindingStatusFilterProps {
  value: FindingTriageStatus[];
  onChange: (statuses: FindingTriageStatus[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingStatusFilter({ value, onChange }: FindingStatusFilterProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = (status: FindingTriageStatus) => {
    const isSelected = value.includes(status);
    if (isSelected) {
      onChange(value.filter((s) => s !== status));
    } else {
      onChange([...value, status]);
    }
  };

  const handleClear = () => {
    onChange([]);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 border-dashed"
          aria-label="Filter by triage status"
        >
          <Filter className="mr-2 h-4 w-4" />
          Status
          {value.length > 0 && (
            <>
              <span className="mx-2 h-4 w-px bg-border" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {value.length}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <div className="p-2">
          <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Triage Status</p>
          <div className="space-y-0.5">
            {FINDING_TRIAGE_STATUSES.map((status) => {
              const meta = TRIAGE_STATUS_META[status];
              const isSelected = value.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer',
                    isSelected && 'bg-accent',
                  )}
                  onClick={() => handleToggle(status)}
                  aria-pressed={isSelected}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-sm border',
                      isSelected
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-input',
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <span
                    className={cn(
                      'inline-block h-2 w-2 rounded-full border',
                      meta.bgClass,
                      meta.borderClass,
                    )}
                  />
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>

          {value.length > 0 && (
            <>
              <div className="border-t my-2" />
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 cursor-pointer"
                onClick={handleClear}
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
