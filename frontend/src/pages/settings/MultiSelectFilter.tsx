import { ListFilter } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectFilterProps {
  label: string;
  selectedValues: string[];
  options: readonly string[] | readonly { value: string; label: string }[];
  onToggle: (value: string) => void;
  onClear: () => void;
}

export function MultiSelectFilter({
  label,
  selectedValues,
  options,
  onToggle,
  onClear,
}: MultiSelectFilterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs gap-1.5 px-3 border-dashed bg-background hover:bg-muted/50 transition-colors font-medium',
            selectedValues.length > 0 && 'border-primary/50 bg-primary/5 text-primary',
          )}
        >
          <ListFilter className="h-3.5 w-3.5 opacity-70" />
          <span>{label}</span>
          {selectedValues.length > 0 && (
            <>
              <div className="w-px h-3.5 bg-border mx-1.5" />
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-bold bg-primary/10 text-primary border-none min-w-[1.25rem] justify-center"
              >
                {selectedValues.length}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-3 border-b flex items-center justify-between bg-muted/20">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {selectedValues.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-6 text-[10px] px-2 hover:bg-destructive/10 hover:text-destructive uppercase font-bold tracking-tight"
            >
              Clear
            </Button>
          )}
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {options.map((option) => {
            const val = typeof option === 'string' ? option : option.value;
            const lab = typeof option === 'string' ? option : option.label;
            const isChecked = selectedValues.includes(val);
            return (
              <label
                key={val}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 hover:bg-muted rounded-md cursor-pointer transition-colors select-none',
                  isChecked && 'bg-accent text-accent-foreground',
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggle(val)}
                  className="h-4 w-4"
                />
                <span className="text-sm truncate leading-none pt-0.5">{lab}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
