import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DateRangeFilterProps {
  value: { from?: Date; to?: Date } | undefined;
  onChange: (range: { from?: Date; to?: Date } | undefined) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasRange = value?.from || value?.to;
  const displayText = hasRange
    ? [value?.from && format(value.from, 'MMM d'), value?.to && format(value.to, 'MMM d')]
        .filter(Boolean)
        .join(' – ')
    : 'All time';

  const handleSelect = (range: DateRange | undefined) => {
    onChange(range ? { from: range.from, to: range.to } : undefined);
  };

  const handleClear = () => {
    onChange(undefined);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'w-[200px] justify-start text-left font-normal',
            !hasRange && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayText}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value ? { from: value.from, to: value.to } : undefined}
          onSelect={handleSelect}
          numberOfMonths={2}
          initialFocus
        />
        {hasRange && (
          <div className="border-t px-3 py-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
