/**
 * Format duration in milliseconds to a human-readable string
 * @param ms Duration in milliseconds
 * @returns Formatted string like "21.0s" or "2m 30.5s"
 */
export function formatDuration(ms: number): string {
  // Convert milliseconds to seconds for display
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(1);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format start time as relative time (if recent) or exact time (if older)
 * @param timestamp ISO timestamp string
 * @returns Formatted string like "5m ago", "2h ago", or "Dec 9, 4:10 PM"
 */
export function formatStartTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  // Show relative time if within 24 hours
  if (diffMs < 86400000) {
    if (diffMs < 60000) return 'just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    return `${Math.floor(diffMs / 3600000)}h ago`;
  }

  // Show exact time if older than 24 hours
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a date-time string for display using en-US locale with timezone.
 * Returns an em-dash for falsy values.
 * @param value ISO timestamp string, or null/undefined
 * @returns Formatted string like "Jan 5, 3:42 PM EST" or "—"
 */
export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
  }).format(date);
}

/**
 * Format a future timestamp as relative remaining time.
 * Returns empty string for falsy values, "Expired" for past dates.
 * @param value ISO timestamp string, or null/undefined
 * @returns Formatted string like "2d 5h left", "30m left", "Expired", or ""
 */
export function formatRelativeTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }
  return `${minutes}m left`;
}
