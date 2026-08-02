import type { OperatorApprovalMode } from '@sentris/shared';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface OperatorModeSelectProps {
  value: OperatorApprovalMode;
  onChange: (mode: OperatorApprovalMode) => void;
  disabled?: boolean;
  className?: string;
}

export function OperatorModeSelect({
  value,
  onChange,
  disabled,
  className,
}: OperatorModeSelectProps) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as OperatorApprovalMode)}>
      <SelectTrigger
        aria-label="Operator approval mode"
        className={cn('h-8 w-[148px] text-xs', className)}
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ask">Ask for approval</SelectItem>
        <SelectItem value="auto">Approve for me</SelectItem>
      </SelectContent>
    </Select>
  );
}
