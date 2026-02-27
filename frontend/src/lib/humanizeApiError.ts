/**
 * Maps raw API / network errors to human-friendly messages suitable for
 * display in toast notifications and form error areas.
 */
export function humanizeApiError(error: unknown): string {
  // Network-level failure (fetch throws TypeError for CORS / DNS / offline)
  if (error instanceof TypeError) {
    return 'Unable to connect — check your network';
  }

  // HTTP errors that carry a status code (e.g. from a Response or custom ApiError)
  const status = extractStatusCode(error);

  if (status !== null) {
    switch (status) {
      case 401:
        return 'Session expired — please sign in again';
      case 403:
        return 'Permission denied';
      case 409:
        return 'Conflict — another change was made';
      case 422:
        return 'Validation error';
    }
  }

  // If we have a useful error message, prefer it over the generic fallback
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Something went wrong — please try again';
}

/** Attempts to pull a numeric HTTP status from common error shapes. */
function extractStatusCode(error: unknown): number | null {
  if (error == null || typeof error !== 'object') return null;

  // Standard Response-like objects
  if ('status' in error && typeof (error as any).status === 'number') {
    return (error as any).status;
  }

  // Axios-style errors
  if (
    'response' in error &&
    typeof (error as any).response === 'object' &&
    (error as any).response !== null &&
    typeof (error as any).response.status === 'number'
  ) {
    return (error as any).response.status;
  }

  // Errors whose message includes the status code, e.g. "Request failed with status 409"
  if (error instanceof Error) {
    const match = error.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return Number(match[1]);
  }

  return null;
}
