import { isIP } from 'node:net';
import { McpRuntimeOwnerAddressSchema } from '@sentris/shared';

import {
  MCP_RUNTIME_INTERNAL_AUTH_HEADER,
  requireMcpRuntimeInternalToken,
} from './mcp-runtime-auth';
import { MCP_RUNTIME_MAX_ROUTED_REQUEST_TIMEOUT_MS } from './mcp-runtime-limits';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export type McpRuntimeFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export class McpRuntimeInternalHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface McpRuntimeInternalClientOptions {
  token: string;
  fetchFn?: McpRuntimeFetch;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  genericWorkerHosts?: readonly string[];
}

export class McpRuntimeInternalClient {
  private readonly token: string;
  private readonly fetchFn: McpRuntimeFetch;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly genericWorkerHosts: Set<string>;

  constructor(options: McpRuntimeInternalClientOptions) {
    this.token = requireMcpRuntimeInternalToken(options.token);
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.requestTimeoutMs = positiveBoundedInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'request timeout',
      MCP_RUNTIME_MAX_ROUTED_REQUEST_TIMEOUT_MS,
    );
    this.maxResponseBytes = positiveBoundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'response body limit',
      16 * 1024 * 1024,
    );
    this.genericWorkerHosts = new Set(
      (options.genericWorkerHosts ?? ['worker']).map((host) => host.toLowerCase()),
    );
  }

  async post<T>(
    ownerAddress: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
    requestTimeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const baseUrl = validatePrivateMcpRuntimeOwnerAddress(ownerAddress, this.genericWorkerHosts);
    if (!/^\/[a-z][a-z/-]*$/.test(path) || path.includes('//')) {
      throw new Error('MCP runtime internal path is invalid');
    }
    const url = new URL(path.replace(/^\//, ''), ensureTrailingSlash(baseUrl));
    if (url.origin !== baseUrl.origin)
      throw new Error('MCP runtime internal path escaped its owner');

    const boundedRequestTimeoutMs = positiveBoundedInteger(
      requestTimeoutMs,
      'request timeout',
      MCP_RUNTIME_MAX_ROUTED_REQUEST_TIMEOUT_MS,
    );
    const response = await this.fetchFn(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        [MCP_RUNTIME_INTERNAL_AUTH_HEADER]: this.token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(boundedRequestTimeoutMs)]),
    });
    const responseText = await readBoundedResponse(response, this.maxResponseBytes);
    if (!response.ok) {
      const publicFailure = parsePublicError(responseText, response.status);
      throw new McpRuntimeInternalHttpError(
        response.status,
        publicFailure.message,
        publicFailure.code,
      );
    }
    if (!responseText) return undefined as T;
    try {
      return JSON.parse(responseText) as T;
    } catch (error: unknown) {
      throw new Error('MCP runtime owner returned invalid JSON', { cause: error });
    }
  }
}

export function validatePrivateMcpRuntimeOwnerAddress(
  value: string,
  genericWorkerHosts: ReadonlySet<string> = new Set(['worker']),
): URL {
  const parsed = new URL(McpRuntimeOwnerAddressSchema.parse(value));
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('MCP runtime owner address must not contain credentials, query, or fragment');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('MCP runtime owner address must be an origin without a path');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (genericWorkerHosts.has(hostname)) {
    throw new Error('MCP runtime owner address must identify one worker instance');
  }
  if (!isPrivateOwnerHostname(hostname)) {
    throw new Error('MCP runtime owner address must resolve through a private worker address');
  }
  return parsed;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

function isPrivateOwnerHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true;
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [first = -1, second = -1] = hostname.split('.').map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (ipVersion === 6) {
    return hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:');
  }
  return (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  );
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  copy.pathname = '/';
  return copy;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    await response.body?.cancel();
    throw new Error('MCP runtime owner response exceeded the configured limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('MCP runtime owner response exceeded the configured limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function parsePublicError(body: string, status: number): { message: string; code?: string } {
  const fallback = `MCP runtime owner request failed with status ${status}`;
  if (!body) return { message: fallback };
  try {
    const parsed = JSON.parse(body) as { error?: unknown; code?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.length <= 1_024) {
      return {
        message: parsed.error,
        ...(typeof parsed.code === 'string' && parsed.code.length <= 128
          ? { code: parsed.code }
          : {}),
      };
    }
  } catch {
    // The owner error body is deliberately not reflected when it is not a bounded JSON error.
  }
  return { message: fallback };
}

function positiveBoundedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`MCP runtime ${label} must be between 1 and ${maximum}`);
  }
  return value;
}
