import { env } from './env';
import { resolveApiBaseUrl, resolveApiUrl } from './runtime-config';

const browserOrigin = typeof window === 'undefined' ? undefined : window.location.origin;

export const API_BASE_URL = resolveApiBaseUrl(env.VITE_API_URL, browserOrigin);
export const API_V1_URL = resolveApiUrl('/api/v1', env.VITE_API_URL, browserOrigin);

export function buildFrontendApiUrl(path: string): string {
  return resolveApiUrl(path, env.VITE_API_URL, browserOrigin);
}
