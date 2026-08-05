import { getSeverityColor, SEVERITY_COLORS, SEVERITY_ORDER } from '@/lib/severityStyles';

export { getSeverityColor, SEVERITY_COLORS, SEVERITY_ORDER };

/** Convert #RRGGBB to rgba for low-opacity severity tints */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Subtle card background + border tint derived from SEVERITY_COLORS */
export function getSeverityCardTintStyle(severity: string): {
  backgroundColor: string;
  borderColor: string;
} {
  const color = getSeverityColor(severity);
  return {
    backgroundColor: hexToRgba(color, 0.1),
    borderColor: hexToRgba(color, 0.2),
  };
}

/** Triage status colors — matches app theme */
export const STATUS_COLORS: Record<string, string> = {
  new: '#6b7280',
  triaged: '#3b82f6',
  in_progress: '#8b5cf6',
  fixed: '#16a34a',
  verified: '#14b8a6',
  wont_fix: '#f97316',
  accepted_risk: '#ca8a04',
};

/** Recharts tooltip styling using CSS variables for theme compatibility */
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
} as const;

/**
 * Format seconds into human-readable duration.
 * Examples: "2d 5h", "3h 30m", "45m", "< 1m"
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '< 1m';

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : '< 1m';
}

/** Capitalize first letter */
export function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Format a status key into a readable label: "in_progress" → "In Progress" */
export function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
