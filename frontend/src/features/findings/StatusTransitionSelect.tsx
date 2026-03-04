import { Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TriageStatusBadge } from '@/features/findings/TriageStatusBadge';
import { VALID_TRANSITIONS, TRIAGE_STATUS_META } from '@/features/findings/types';
import type { FindingTriageStatus } from '@/features/findings/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusTransitionSelectProps {
  currentStatus: FindingTriageStatus;
  onStatusChange: (newStatus: FindingTriageStatus) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusTransitionSelect({
  currentStatus,
  onStatusChange,
  isLoading = false,
  disabled = false,
}: StatusTransitionSelectProps) {
  const validTargets = VALID_TRANSITIONS[currentStatus];
  const isTerminal = validTargets.length === 0;

  const handleChange = (value: string) => {
    onStatusChange(value as FindingTriageStatus);
  };

  return (
    <div className="flex items-center gap-2">
      <TriageStatusBadge status={currentStatus} />

      {!isTerminal && (
        <>
          <span className="text-muted-foreground text-xs">→</span>
          <Select value="" onValueChange={handleChange} disabled={disabled || isLoading}>
            <SelectTrigger className="w-[160px] h-8 text-xs" aria-label="Change status">
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Updating…
                </span>
              ) : (
                <SelectValue placeholder="Move to…" />
              )}
            </SelectTrigger>
            <SelectContent>
              {validTargets.map((target) => (
                <SelectItem key={target} value={target}>
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${TRIAGE_STATUS_META[target].bgClass} ${TRIAGE_STATUS_META[target].borderClass} border`}
                    />
                    {TRIAGE_STATUS_META[target].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      {isTerminal && <span className="text-xs text-muted-foreground italic">Terminal state</span>}
    </div>
  );
}
