/**
 * Pure string utility functions used across temporal activities.
 */

export const ERROR_LOG_LIMIT = 600;

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const remaining = value.length - maxLength;
  return `${value.slice(0, maxLength)}...(+${remaining} chars)`;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export function truncateDetails(
  details: Record<string, unknown> | undefined,
  maxLength: number,
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }
  try {
    const raw = JSON.stringify(details);
    if (raw.length <= maxLength) {
      return details;
    }
    return { truncated: true, preview: truncateText(raw, maxLength) };
  } catch {
    return { truncated: true, preview: truncateText(String(details), maxLength) };
  }
}
