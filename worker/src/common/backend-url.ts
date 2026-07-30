const DEFAULT_BACKEND_URL = 'http://localhost:3211';
const API_PREFIX = '/api/v1';

interface BackendUrlEnv extends Record<string, string | undefined> {
  SENTRIS_API_BASE_URL?: string;
  API_BASE_URL?: string;
  BACKEND_URL?: string;
}

function selectedBackendUrl(env: BackendUrlEnv): string {
  return env.SENTRIS_API_BASE_URL ?? env.API_BASE_URL ?? env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

export function resolveBackendRootUrl(env: BackendUrlEnv = process.env): string {
  const normalized = selectedBackendUrl(env).replace(/\/+$/, '');
  return normalized.endsWith(API_PREFIX) ? normalized.slice(0, -API_PREFIX.length) : normalized;
}

export function resolveBackendApiBaseUrl(env: BackendUrlEnv = process.env): string {
  return `${resolveBackendRootUrl(env)}${API_PREFIX}`;
}

export function buildBackendApiUrl(path: string, env: BackendUrlEnv = process.env): string {
  return `${resolveBackendApiBaseUrl(env)}/${path.replace(/^\/+/, '')}`;
}
