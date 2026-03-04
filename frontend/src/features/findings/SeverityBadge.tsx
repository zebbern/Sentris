import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BadgeVariant = 'destructive' | 'warning' | 'default' | 'secondary' | 'outline';

const SEVERITY_BADGE_MAP: Record<string, { variant: BadgeVariant; label: string }> = {
  critical: { variant: 'destructive', label: 'Critical' },
  high: { variant: 'destructive', label: 'High' },
  medium: { variant: 'warning', label: 'Medium' },
  low: { variant: 'default', label: 'Low' },
  info: { variant: 'secondary', label: 'Info' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeverityBadge({ severity }: { severity?: string }) {
  const normalised = severity?.toLowerCase() ?? 'unknown';
  const config = SEVERITY_BADGE_MAP[normalised] ?? {
    variant: 'outline' as BadgeVariant,
    label: severity ?? 'Unknown',
  };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
