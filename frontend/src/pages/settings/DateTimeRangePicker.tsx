import { useMemo, useState } from 'react';
import { format, subHours, subDays, startOfDay, endOfDay, isAfter } from 'date-fns';
import { CalendarIcon, Clock } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DatePreset {
  label: string;
  getValue: () => { from: Date; to: Date };
}

const DATE_PRESETS: DatePreset[] = [
  { label: 'Today', getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  {
    label: 'Yesterday',
    getValue: () => {
      const yesterday = subDays(new Date(), 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
  },
  { label: 'Last 24 hours', getValue: () => ({ from: subHours(new Date(), 24), to: new Date() }) },
  { label: 'Last 7 days', getValue: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: 'Last 30 days', getValue: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
];

export interface DateTimeRangePickerProps {
  from: Date | undefined;
  to: Date | undefined;
  onSelect: (range: { from?: Date; to?: Date }) => void;
}

export function DateTimeRangePicker({ from, to, onSelect }: DateTimeRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Internal state for the picker, committed on Apply
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from, to });
  const [startTime, setStartTime] = useState(from ? format(from, 'HH:mm') : '00:00');
  const [endTime, setEndTime] = useState(to ? format(to, 'HH:mm') : '23:59');

  // Reset internal state when prop changes or popover opens
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setDateRange({ from, to });
      setStartTime(from ? format(from, 'HH:mm') : '00:00');
      setEndTime(to ? format(to, 'HH:mm') : '23:59');
    }
  };

  const handleApply = () => {
    if (!dateRange?.from) {
      onSelect({ from: undefined, to: undefined });
      setIsOpen(false);
      return;
    }

    let newFrom = new Date(dateRange.from);
    const [startH, startM] = startTime.split(':').map(Number);
    newFrom.setHours(startH || 0, startM || 0, 0, 0);

    let newTo = dateRange.to ? new Date(dateRange.to) : new Date(newFrom);
    const [endH, endM] = endTime.split(':').map(Number);
    newTo.setHours(endH || 0, endM || 0, 59, 999);

    // Swap if needed
    if (isAfter(newFrom, newTo)) {
      [newFrom, newTo] = [newTo, newFrom];
    }

    onSelect({ from: newFrom, to: newTo });
    setIsOpen(false);
  };

  const handlePresetSelect = (preset: DatePreset) => {
    const range = preset.getValue();
    setDateRange({ from: range.from, to: range.to });
    setStartTime(format(range.from, 'HH:mm'));
    setEndTime(format(range.to, 'HH:mm'));
  };

  const displayText = useMemo(() => {
    if (!from) return 'Date Range';
    if (!to) return `${format(from, 'MMM d, HH:mm')} - ...`;
    return `${format(from, 'MMM d, HH:mm')} - ${format(to, 'MMM d, HH:mm')}`;
  }, [from, to]);

  const hasSelection = !!(from || to);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs gap-2 px-3 border-dashed bg-background hover:bg-muted/50 transition-colors font-medium',
            hasSelection && 'border-primary/50 bg-primary/5 text-primary',
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 opacity-70" />
          <span>{hasSelection ? 'Time' : 'Date Range'}</span>
          {hasSelection && (
            <>
              <div className="w-px h-3.5 bg-border mx-1" />
              <span className="text-[11px] font-semibold text-primary truncate max-w-[200px]">
                {displayText}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Presets Sidebar */}
          <div className="border-r w-[140px] p-2 flex flex-col gap-1 bg-muted/10">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Presets
            </div>
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="justify-start h-8 text-xs font-normal"
                onClick={() => handlePresetSelect(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Calendar & Time */}
          <div className="p-4 flex flex-col gap-4">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from ? undefined : subDays(new Date(), 30)}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              className="rounded-md border shadow-sm"
            />

            <div className="flex items-center gap-4 pt-2 border-t">
              <div className="flex-1 space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Start Time
                </div>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> End Time
                </div>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="flex items-end gap-2 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateRange(undefined);
                    setStartTime('00:00');
                    setEndTime('23:59');
                  }}
                  className="h-8 text-xs"
                >
                  Reset
                </Button>
                <Button size="sm" onClick={handleApply} className="h-8 text-xs">
                  Apply Range
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
