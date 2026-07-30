import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SAFE_CONTAINER_ID = /^[a-zA-Z0-9_.-]+$/;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
export const MCP_DOCKER_PROXY_AUTH_HEADER = 'x-sentris-mcp-proxy-token';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  MCP_DOCKER_PROXY_AUTH_HEADER,
]);

interface ProxyTarget {
  runId: string;
  targetOrigin: string;
}

class ProxyRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProxyRequestError';
  }
}

export interface McpDockerProxyRegistration {
  endpoint: string;
  authToken: string;
}

export interface McpDockerProxyRegistry {
  registerTarget(input: {
    containerId: string;
    runId: string;
    targetOrigin: string;
  }): McpDockerProxyRegistration;
}

export interface McpDockerProxyHandle extends McpDockerProxyRegistry {
  port: number;
  removeRunTargets(runId: string): number;
  removeTarget(containerId: string): boolean;
  close(): Promise<void>;
}

export interface StartMcpDockerProxyOptions {
  port: number;
  publicBaseUrl: string;
  authToken: string;
}

let activeProxy: McpDockerProxyHandle | undefined;

function isAuthorized(request: IncomingMessage, authToken: string): boolean {
  const expected = authToken;
  const provided = request.headers[MCP_DOCKER_PROXY_AUTH_HEADER];
  if (Array.isArray(provided)) return false;
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new ProxyRequestError(413, 'Request body too large');
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) throw new ProxyRequestError(413, 'Request body too large');
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function resolveTargetUrl(target: ProxyTarget, suffix: string, search: string): URL {
  const targetUrl = new URL(`${suffix}${search}`, `${target.targetOrigin}/`);
  if (targetUrl.origin !== target.targetOrigin) {
    throw new ProxyRequestError(400, 'Invalid proxy target path');
  }
  return targetUrl;
}

function forwardedHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: ProxyTarget,
  suffix: string,
  search: string,
): Promise<void> {
  const abortController = new AbortController();
  const abortUpstream = () => abortController.abort();
  request.once('aborted', abortUpstream);
  response.once('close', abortUpstream);
  try {
    const targetUrl = resolveTargetUrl(target, suffix, search);
    const body = await readRequestBody(request);
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardedHeaders(request),
      body,
      redirect: 'manual',
      signal: abortController.signal,
    });
    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, name) => {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    });
    response.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) {
      response.end();
      return;
    }
    await pipeline(Readable.fromWeb(upstream.body as never), response);
  } finally {
    request.removeListener('aborted', abortUpstream);
    response.removeListener('close', abortUpstream);
  }
}

export async function startMcpDockerProxy(
  options: StartMcpDockerProxyOptions,
): Promise<McpDockerProxyHandle> {
  if (!options.authToken) throw new Error('MCP Docker proxy auth token is required');
  const publicBaseUrl = new URL(options.publicBaseUrl);
  if (!['http:', 'https:'].includes(publicBaseUrl.protocol)) {
    throw new Error('MCP Docker proxy public base URL must use HTTP or HTTPS');
  }
  const targets = new Map<string, ProxyTarget>();
  const server = createServer((request, response) => {
    void (async () => {
      if (!isAuthorized(request, options.authToken)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const requestUrl = new URL(request.url ?? '/', 'http://worker-proxy');
      const match = /^\/containers\/([a-zA-Z0-9_.-]+)(\/.*)?$/.exec(requestUrl.pathname);
      if (!match) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      const target = targets.get(match[1]!);
      if (!target) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      await proxyRequest(request, response, target, match[2] || '/', requestUrl.search);
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, error instanceof ProxyRequestError ? error.status : 502, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('MCP Docker proxy did not bind to a TCP port');
  }
  const base = options.publicBaseUrl.replace(/\/+$/, '');
  const handle: McpDockerProxyHandle = {
    port: address.port,
    registerTarget(input) {
      if (!SAFE_CONTAINER_ID.test(input.containerId)) {
        throw new Error('MCP Docker proxy containerId is invalid');
      }
      const origin = new URL(input.targetOrigin);
      if (origin.protocol !== 'http:') {
        throw new Error('MCP Docker proxy target must use HTTP on the DIND control network');
      }
      targets.set(input.containerId, {
        runId: input.runId,
        targetOrigin: origin.origin,
      });
      return {
        endpoint: `${base}/containers/${input.containerId}/mcp`,
        authToken: options.authToken,
      };
    },
    removeRunTargets(runId) {
      let removed = 0;
      for (const [containerId, target] of targets) {
        if (target.runId !== runId) continue;
        targets.delete(containerId);
        removed += 1;
      }
      return removed;
    },
    removeTarget(containerId) {
      return targets.delete(containerId);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        targets.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  return handle;
}

export function initializeMcpDockerProxy(handle: McpDockerProxyHandle): void {
  if (activeProxy) throw new Error('MCP Docker proxy is already initialized');
  activeProxy = handle;
}

export function getMcpDockerProxy(): McpDockerProxyHandle {
  if (!activeProxy) throw new Error('MCP Docker proxy is not initialized');
  return activeProxy;
}

export function removeMcpDockerProxyRunTargets(runId: string): number {
  return activeProxy?.removeRunTargets(runId) ?? 0;
}

export function removeMcpDockerProxyTarget(containerId: string): boolean {
  return activeProxy?.removeTarget(containerId) ?? false;
}

export function resetMcpDockerProxyForTests(): void {
  activeProxy = undefined;
}
