export const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const trimDecimal = (value: number, digits = 1): string => {
  const fixed = value.toFixed(digits);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
};

/**
 * Format a duration in milliseconds for the execution timeline.
 * Auto-picks a unit by magnitude: ms → s → m → h.
 */
export const formatTime = (ms: number): string => {
  const clamped = Math.max(0, ms);

  if (clamped < 1000) {
    return `${Math.round(clamped)}ms`;
  }
  if (clamped < 60_000) {
    return `${trimDecimal(clamped / 1000)}s`;
  }
  if (clamped < 3_600_000) {
    return `${trimDecimal(clamped / 60_000)}m`;
  }
  return `${trimDecimal(clamped / 3_600_000)}h`;
};

export const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const base = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`;
};
