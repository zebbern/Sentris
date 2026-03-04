import { cn } from '@/lib/utils';
import { TRIAGE_STATUS_META } from '@/features/findings/types';
import type { FindingTriageStatus } from '@/features/findings/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TriageStatusBadgeProps {
  /** Current triage status. Null/undefined treated as 'new'. */
  status: FindingTriageStatus | string | null | undefined;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TriageStatusBadge({ status, className }: TriageStatusBadgeProps) {
  const resolved = (status ?? 'new') as FindingTriageStatus;
  const meta = TRIAGE_STATUS_META[resolved] ?? TRIAGE_STATUS_META.new;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        meta.bgClass,
        meta.textClass,
        meta.borderClass,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
