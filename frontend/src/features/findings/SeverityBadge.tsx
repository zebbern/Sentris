import { Badge } from '@/components/ui/badge';
import { getSeverityBadgeClass } from '@/lib/severityStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
  none: 'None',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeverityBadge({ severity }: { severity?: string }) {
  const normalised = severity?.toLowerCase() ?? 'unknown';
  return (
    <Badge variant="outline" className={getSeverityBadgeClass(normalised)}>
      {SEVERITY_LABELS[normalised] ?? severity ?? 'Unknown'}
    </Badge>
  );
}
