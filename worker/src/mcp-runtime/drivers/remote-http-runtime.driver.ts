import type { FetchLike } from '@modelcontextprotocol/client';
import { validateUrlForSsrf } from '@sentris/component-sdk';
import { McpResolvedRuntimeDefinitionSchema } from '@sentris/shared';

import type { McpClientFactory } from '../mcp-client-factory';
import type {
  McpRuntimeDriver,
  McpRuntimeDriverHandle,
  McpRuntimeDriverStartInput,
  McpRuntimeResource,
  RemoteHttpRuntimeDefinition,
} from '../mcp-runtime-driver';

const MAX_HEADERS = 128;
const MAX_HEADER_VALUE_LENGTH = 64 * 1024;
const MAX_ALLOWED_INTERNAL_HOSTS = 64;
const DEFAULT_MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];
const BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-type',
  'transfer-encoding',
];

type McpClientFactoryPort = Pick<McpClientFactory, 'connect' | 'close'>;
type UrlValidator = (url: string, options?: { allowedInternalHosts?: string[] }) => Promise<void>;

export interface RemoteHttpRuntimeDriverOptions {
  fetch?: FetchLike;
  validateUrl?: UrlValidator;
  maxRedirects?: number;
}

export class RemoteHttpRuntimeDriver implements McpRuntimeDriver {
  readonly kinds = ['remote-http'] as const;

  private readonly fetch: FetchLike;
  private readonly validateUrl: UrlValidator;
  private readonly maxRedirects: number;

  constructor(
    private readonly clientFactory: McpClientFactoryPort,
    options: RemoteHttpRuntimeDriverOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.validateUrl = options.validateUrl ?? validateUrlForSsrf;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
      throw new Error('MCP HTTP max redirects must be an integer between 0 and 20');
    }
    this.maxRedirects = maxRedirects;
  }

  async start(input: McpRuntimeDriverStartInput): Promise<McpRuntimeDriverHandle> {
    if (input.definition.kind !== 'remote-http') {
      throw new Error(`Remote HTTP driver cannot start ${input.definition.kind}`);
    }
    assertConnectTimeout(input.connectTimeoutMs);
    const definition = validateDefinition(input.definition);
    const endpoint = parseHttpUrl(definition.endpoint);
    const headers = validateHeaders(definition.headers);
    const allowedInternalHosts = validateAllowedInternalHosts(definition.allowedInternalHosts);
    let closed = false;
    try {
      const owned = await this.clientFactory.connect({
        transport: 'http',
        endpoint,
        requestInit: headers ? { headers } : undefined,
        fetch: createRedirectAwareFetch({
          fetch: this.fetch,
          validateUrl: this.validateUrl,
          allowedInternalHosts,
          maxRedirects: this.maxRedirects,
        }),
        runtimeKey: input.runtimeKey,
        signal: input.signal,
        timeout: input.connectTimeoutMs,
      });
      return {
        adapter: owned.adapter,
        health: async () => (closed ? 'unhealthy' : 'unknown'),
        close: async () => {
          if (closed) return;
          closed = true;
          await this.clientFactory.close(input.runtimeKey);
        },
      };
    } catch (error: unknown) {
      await this.clientFactory.close(input.runtimeKey).catch(() => {});
      throw error;
    }
  }

  async inventory(): Promise<McpRuntimeResource[]> {
    return [];
  }

  async reap(_resource: McpRuntimeResource): Promise<void> {
    throw new Error('Remote HTTP runtimes do not own reapable resources');
  }
}

interface RedirectAwareFetchOptions {
  fetch: FetchLike;
  validateUrl: UrlValidator;
  allowedInternalHosts?: string[];
  maxRedirects: number;
}

function createRedirectAwareFetch(options: RedirectAwareFetchOptions): FetchLike {
  return async (request, init) => {
    let current = new Request(request.toString(), init);
    for (let redirects = 0; ; redirects += 1) {
      assertNoUrlCredentials(current.url);
      await options.validateUrl(current.url, {
        allowedInternalHosts: options.allowedInternalHosts,
      });
      const response = await options.fetch(current.url, await requestInitForFetch(current));
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get('location');
      if (!location) return response;
      if (redirects >= options.maxRedirects) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`MCP HTTP redirect limit exceeded (${options.maxRedirects})`);
      }

      try {
        const nextUrl = new URL(location, current.url);
        current = await createRedirectRequest(current, nextUrl, response.status);
      } finally {
        await response.body?.cancel().catch(() => {});
      }
    }
  };
}

async function createRedirectRequest(
  current: Request,
  nextUrl: URL,
  status: number,
): Promise<Request> {
  const headers = new Headers(current.headers);
  if (new URL(current.url).origin !== nextUrl.origin) {
    for (const header of CROSS_ORIGIN_CREDENTIAL_HEADERS) headers.delete(header);
  }

  const rewriteToGet =
    (status === 303 && current.method !== 'GET' && current.method !== 'HEAD') ||
    ((status === 301 || status === 302) && current.method === 'POST');
  if (rewriteToGet) {
    for (const header of BODY_HEADERS) headers.delete(header);
    return new Request(nextUrl.toString(), {
      method: 'GET',
      headers,
      signal: current.signal,
      redirect: 'manual',
    });
  }

  const body = current.body === null ? undefined : await current.clone().arrayBuffer();
  return new Request(nextUrl.toString(), {
    method: current.method,
    headers,
    body,
    signal: current.signal,
    redirect: 'manual',
  });
}

async function requestInitForFetch(request: Request): Promise<RequestInit> {
  return {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.body === null ? undefined : await request.clone().arrayBuffer(),
    signal: request.signal,
    redirect: 'manual',
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
  };
}

function validateDefinition(definition: RemoteHttpRuntimeDefinition): RemoteHttpRuntimeDefinition {
  const parsed = McpResolvedRuntimeDefinitionSchema.parse(definition);
  if (parsed.kind !== 'remote-http') throw new Error('Expected an MCP remote HTTP definition');
  return parsed;
}

function validateHeaders(input: Record<string, string> | undefined): Headers | undefined {
  if (input === undefined) return undefined;
  const entries = Object.entries(input);
  if (entries.length > MAX_HEADERS) throw new Error(`MCP HTTP headers exceed ${MAX_HEADERS}`);
  const headers = new Headers();
  for (const [name, value] of entries) {
    if (value.length > MAX_HEADER_VALUE_LENGTH || value.includes('\0')) {
      throw new Error(`MCP HTTP header ${name} is invalid`);
    }
    headers.set(name, value);
  }
  return headers;
}

function validateAllowedInternalHosts(input: string[] | undefined): string[] | undefined {
  if (input === undefined) return undefined;
  if (input.length > MAX_ALLOWED_INTERNAL_HOSTS) {
    throw new Error(`MCP allowed internal hosts exceed ${MAX_ALLOWED_INTERNAL_HOSTS}`);
  }
  const hosts = input.map((host) => {
    const normalized = host.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 253 || !/^[a-z0-9._:-]+$/.test(normalized)) {
      throw new Error(`Invalid MCP allowed internal host: ${host}`);
    }
    return normalized;
  });
  return [...new Set(hosts)];
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MCP remote endpoint must use HTTP or HTTPS');
  }
  assertNoUrlCredentials(url.href);
  return url;
}

function assertNoUrlCredentials(value: string): void {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error('MCP remote endpoint must not contain embedded credentials');
  }
}

function assertConnectTimeout(timeout: number): void {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('MCP runtime connect timeout must be finite and positive');
  }
}
