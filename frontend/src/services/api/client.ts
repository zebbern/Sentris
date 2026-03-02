import { createSentrisClient } from '@sentris/backend-client';
import { useAuthStore } from '@/store/authStore';
import { getFreshClerkToken } from '@/utils/clerk-token';

/**
 * Generic openapi-fetch response shape for use when generated types lack `.error`.
 * Allows type-safe access to data/error without `as any`.
 */
export interface ApiResponse<D = unknown> {
  data?: D;
  error?: { message?: string } | string;
  response?: Response;
}

/**
 * API Client Configuration
 */
type RuntimeImportMeta = ImportMeta & {
  env?: Record<string, string | undefined>;
};

function resolveApiBaseUrl() {
  const metaEnv = (import.meta as RuntimeImportMeta).env;
  if (metaEnv?.VITE_API_URL && metaEnv.VITE_API_URL.trim().length > 0) {
    return metaEnv.VITE_API_URL;
  }

  if (typeof process !== 'undefined') {
    const nodeEnv = (process.env ?? {}).VITE_API_URL;
    if (nodeEnv && nodeEnv.trim().length > 0) {
      return nodeEnv;
    }
  }

  return 'http://localhost:3211';
}

export const API_BASE_URL = resolveApiBaseUrl();
export const API_V1_URL = `${API_BASE_URL}/api/v1`;

// Helper function to get auth headers (reused by middleware and file operations)
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const storeState = useAuthStore.getState();
  let token = storeState.token;
  // For local auth, always use 'local-dev' org ID
  const organizationId = storeState.provider === 'local' ? 'local-dev' : storeState.organizationId;

  // For Clerk auth, always fetch a fresh token on-demand to prevent expiration issues
  // This ensures we never use a stale/expired token
  if (storeState.provider === 'clerk') {
    try {
      const freshToken = await getFreshClerkToken();
      if (freshToken) {
        token = freshToken;
        // Update store with fresh token so it's available for next time
        storeState.setToken(freshToken);
      } else {
        // If we can't get a fresh token, fall back to store token
      }
    } catch (_error: unknown) {
      // Fall back to store token if fresh token fetch fails
    }
  }

  const headers: Record<string, string> = {};

  // For local auth with admin credentials, use Basic Auth
  if (storeState.provider === 'local' && storeState.adminUsername && storeState.adminPassword) {
    const credentials = btoa(`${storeState.adminUsername}:${storeState.adminPassword}`);
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (token && token.trim().length > 0) {
    // Use Bearer token (for Clerk)
    const headerValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    headers['Authorization'] = headerValue;
  }

  if (organizationId && organizationId.trim().length > 0) {
    headers['X-Organization-Id'] = organizationId;
  }

  return headers;
}

/** Public wrapper for getAuthHeaders (backward-compatible export name). */
export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  return getAuthHeaders();
}

// Create type-safe API client
export const apiClient = createSentrisClient({
  baseUrl: API_BASE_URL,
  middleware: {
    async onRequest({ request }) {
      const headers = await getAuthHeaders();

      // Apply auth headers to the request
      if (headers['Authorization']) {
        request.headers.set('Authorization', headers['Authorization']);
      }
      if (headers['X-Organization-Id']) {
        request.headers.set('X-Organization-Id', headers['X-Organization-Id']);
      }

      if (!request.headers.has('Content-Type')) {
        request.headers.set('Content-Type', 'application/json');
      }

      return request;
    },
  },
});

// Generic HTTP methods for services not covered by the typed client
export async function httpGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_V1_URL}${path}`, { headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `GET ${path} failed` }));
    throw new Error(error.message || `GET ${path} failed`);
  }
  return response.json();
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_V1_URL}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `POST ${path} failed` }));
    throw new Error(error.message || `POST ${path} failed`);
  }
  return response.json();
}

export async function httpPut<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_V1_URL}${path}`, {
    method: 'PUT',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `PUT ${path} failed` }));
    throw new Error(error.message || `PUT ${path} failed`);
  }
  return response.json();
}

export async function httpPatch<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_V1_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `PATCH ${path} failed` }));
    throw new Error(error.message || `PATCH ${path} failed`);
  }
  return response.json();
}

export async function httpDel(path: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_V1_URL}${path}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `DELETE ${path} failed` }));
    throw new Error(error.message || `DELETE ${path} failed`);
  }
}
