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
      case 502:
      case 503:
      case 504:
        return 'Service temporarily unavailable';
    }
  }

  // If we have a useful error message, prefer it over the generic fallback
  if (error instanceof Error && error.message) {
    // Strip raw HTML responses (e.g. nginx error pages)
    if (error.message.includes('<html') || error.message.includes('<body')) {
      return 'Service temporarily unavailable';
    }
    return (
      error.message.replace(/<[^>]*>/g, '').trim() || 'Something went wrong — please try again'
    );
  }

  return 'Something went wrong — please try again';
}

function hasNumericStatus(obj: object): obj is { status: number } {
  return 'status' in obj && typeof (obj as { status: unknown }).status === 'number';
}

function hasResponseWithStatus(obj: object): obj is { response: { status: number } } {
  if (!('response' in obj)) return false;
  const resp = (obj as { response: unknown }).response;
  return typeof resp === 'object' && resp !== null && hasNumericStatus(resp as object);
}

/** Attempts to pull a numeric HTTP status from common error shapes. */
function extractStatusCode(error: unknown): number | null {
  if (error == null || typeof error !== 'object') return null;

  // Standard Response-like objects
  if (hasNumericStatus(error)) {
    return error.status;
  }

  // Axios-style errors
  if (hasResponseWithStatus(error)) {
    return error.response.status;
  }

  // Errors whose message includes the status code, e.g. "Request failed with status 409"
  if (error instanceof Error) {
    const match = error.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return Number(match[1]);
  }

  return null;
}
