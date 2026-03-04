import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const;

interface PeriodSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="period-selector" className="text-sm font-medium text-muted-foreground">
        Period
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="period-selector" className="w-[160px]" aria-label="Select time period">
          <SelectValue placeholder="Select period" />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
