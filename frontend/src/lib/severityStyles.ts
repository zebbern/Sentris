export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

export type SeverityLevel = (typeof SEVERITY_ORDER)[number];
export type SeverityKey = SeverityLevel | 'none';

export const SEVERITY_COLORS: Record<SeverityKey, string> = {
  critical: '#dc2626',
  high: '#f59e0b',
  medium: '#fde047',
  low: '#22c55e',
  info: '#2563eb',
  none: '#64748b',
};

export const SEVERITY_BACKGROUND_CLASSES: Record<SeverityKey, string> = {
  critical: 'bg-red-600',
  high: 'bg-amber-500',
  medium: 'bg-yellow-300',
  low: 'bg-green-500',
  info: 'bg-blue-600',
  none: 'bg-slate-500',
};

export const SEVERITY_BADGE_CLASSES: Record<SeverityKey, string> = {
  critical: 'border-red-600 bg-red-600 text-white',
  high: 'border-amber-500 bg-amber-500 text-slate-950',
  medium: 'border-yellow-300 bg-yellow-300 text-slate-950',
  low: 'border-green-500 bg-green-500 text-slate-950',
  info: 'border-blue-600 bg-blue-600 text-white',
  none: 'border-slate-500 bg-slate-500 text-white',
};

export function isSeverityKey(value: string): value is SeverityKey {
  return Object.prototype.hasOwnProperty.call(SEVERITY_COLORS, value);
}

export function getSeverityBadgeClass(severity?: string): string | undefined {
  const normalized = severity?.toLowerCase();
  return normalized && isSeverityKey(normalized) ? SEVERITY_BADGE_CLASSES[normalized] : undefined;
}

export function getSeverityBackgroundClass(severity?: string): string {
  const normalized = severity?.toLowerCase();
  return normalized && isSeverityKey(normalized)
    ? SEVERITY_BACKGROUND_CLASSES[normalized]
    : 'bg-muted-foreground/40';
}

export function getSeverityColor(severity?: string): string {
  const normalized = severity?.toLowerCase();
  return normalized && isSeverityKey(normalized) ? SEVERITY_COLORS[normalized] : '#64748b';
}
