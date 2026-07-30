export function buildE2eHeaders(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const internalToken =
    env.E2E_INTERNAL_SERVICE_TOKEN?.trim() ||
    env.INTERNAL_SERVICE_TOKEN?.trim() ||
    'local-internal-token';

  return {
    'Content-Type': 'application/json',
    'x-internal-token': internalToken,
  };
}
