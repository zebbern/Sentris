import { startMcpDockerServer } from '../../components/core/mcp-runtime';
import {
  MCP_STDIO_HOST_PROXY_HOST,
  startMcpStdioHostProxy,
  stopMcpStdioHostProxy,
} from '../../components/core/mcp-stdio-host-proxy';
import {
  MCP_DOCKER_PROXY_AUTH_HEADER,
  removeMcpDockerProxyTarget,
} from '../../components/core/mcp-docker-proxy';
import { ApplicationFailure, Context } from '@temporalio/activity';
import {
  createExecutionContext,
  SsrfBlockedError,
  validateUrlForSsrf,
  type LogEventInput,
} from '@sentris/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  DiscoveryActivityInput,
  DiscoveryActivityOutput,
  GroupDiscoveryActivityInput,
  GroupDiscoveryActivityOutput,
  GroupDiscoveryActivityResult,
  McpTool,
} from '../types';
import { workflowDiagnosticLog } from '../workflow-diagnostics';
import Redis from 'ioredis';
import {
  McpCatalogSchema,
  McpPromptGetOperationSchema,
  McpResourceReadOperationSchema,
  McpRuntimeKeySchema,
  McpSavedServerPreviewResponseSchema,
  resolveSentrisTrustProfile,
  type McpCatalog,
  type McpPromptGetOperation,
  type McpResourceReadOperation,
  type McpRuntimeAcquisition,
  type McpRuntimeKey,
  type McpSavedServerPreviewResponse,
} from '@sentris/shared';
import type { McpRuntimeRouter } from '../../mcp-runtime/mcp-runtime-router';
import { SAVED_MCP_RUNTIME_DISCOVERY_RELEASE_TIMEOUT_MS } from '../../mcp-runtime/mcp-runtime-limits';

// Initialize Redis for caching
const redisUrl =
  process.env.REDIS_URL || process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);
const MAX_HTTP_REDIRECTS = 5;
const MAX_MCP_RUNTIME_HOLDER_TOUCH_INTERVAL_MS = 5_000;

let mcpRuntimeRouter: McpRuntimeRouter | undefined;

export function initializeMcpRuntimeDiscoveryActivities(router: McpRuntimeRouter): void {
  mcpRuntimeRouter = router;
}

export interface SavedMcpRuntimeDiscoveryInput {
  runtimeKey: McpRuntimeKey;
}

export interface SavedMcpRuntimeDiscoveryOutput {
  catalog: McpCatalog;
}

export interface SavedMcpRuntimePreviewInput {
  runtimeKey: McpRuntimeKey;
  operation: McpResourceReadOperation | McpPromptGetOperation;
}

/** Canonical saved-server discovery path. Its Temporal boundary is secret-free. */
export async function discoverSavedMcpRuntimeActivity(
  input: SavedMcpRuntimeDiscoveryInput,
): Promise<SavedMcpRuntimeDiscoveryOutput> {
  return withSavedMcpRuntime(input.runtimeKey, 'discover', async (router, acquisition, signal) => {
    Context.current().heartbeat('mcp-runtime:discover');
    const catalog = await router.execute(acquisition, { kind: 'discover' }, signal);
    Context.current().heartbeat('mcp-runtime:catalog-ready');
    return { catalog: McpCatalogSchema.parse(catalog) };
  });
}

/** Read-only saved-server preview through the same fenced runtime used by discovery and runs. */
export async function previewSavedMcpRuntimeActivity(
  input: SavedMcpRuntimePreviewInput,
): Promise<McpSavedServerPreviewResponse> {
  const operation =
    input.operation.kind === 'resource-read'
      ? McpResourceReadOperationSchema.parse(input.operation)
      : McpPromptGetOperationSchema.parse(input.operation);

  return withSavedMcpRuntime(input.runtimeKey, 'preview', async (router, acquisition, signal) => {
    Context.current().heartbeat('mcp-runtime:preview');
    const output =
      operation.kind === 'resource-read'
        ? await router.execute(
            acquisition,
            {
              kind: 'read',
              uri: operation.uri,
              context: { idleTimeoutMs: 30_000, maxTotalTimeoutMs: 120_000 },
            },
            signal,
          )
        : await router.execute(
            acquisition,
            {
              kind: 'get-prompt',
              name: operation.name,
              args: operation.arguments,
              context: { idleTimeoutMs: 30_000, maxTotalTimeoutMs: 120_000 },
            },
            signal,
          );
    Context.current().heartbeat('mcp-runtime:preview-ready');
    return McpSavedServerPreviewResponseSchema.parse({
      kind: operation.kind === 'resource-read' ? 'resource' : 'prompt',
      target: operation.kind === 'resource-read' ? operation.uri : operation.name,
      output,
    });
  });
}

async function withSavedMcpRuntime<T>(
  runtimeKeyInput: McpRuntimeKey,
  operationName: string,
  execute: (
    router: McpRuntimeRouter,
    acquisition: McpRuntimeAcquisition,
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  if (!mcpRuntimeRouter) throw new Error('MCP saved runtime activities are not initialized');
  const router = mcpRuntimeRouter;
  const context = Context.current();
  const runtimeKey = McpRuntimeKeySchema.parse(runtimeKeyInput);
  const holderId = savedRuntimeHolderId(context.info, runtimeKey);
  const heartbeatTimer = setInterval(() => context.heartbeat('mcp-runtime:starting'), 5_000);
  heartbeatTimer.unref?.();
  let runtimeAcquisition: McpRuntimeAcquisition | undefined;
  let holderKeepalive: McpRuntimeHolderKeepalive | undefined;
  let primaryError: unknown;
  let output: T | undefined;
  try {
    try {
      context.heartbeat('mcp-runtime:acquire');
      runtimeAcquisition = await router.acquire(runtimeKey, holderId, context.cancellationSignal);
      holderKeepalive = startMcpRuntimeHolderKeepalive(
        router,
        runtimeAcquisition,
        context.cancellationSignal,
        context.heartbeat.bind(context),
      );
      output = await execute(router, runtimeAcquisition, context.cancellationSignal);
    } catch (error: unknown) {
      primaryError = error;
    }
    if (holderKeepalive) {
      try {
        await holderKeepalive.stop();
      } catch (keepaliveError: unknown) {
        if (primaryError === undefined) {
          primaryError = keepaliveError;
        } else {
          console.error(
            '[MCP Saved Runtime] Holder keepalive failed after the primary activity failure:',
            keepaliveError instanceof Error ? keepaliveError.name : 'UnknownError',
          );
        }
      }
    }
    if (runtimeAcquisition) {
      context.heartbeat('mcp-runtime:release');
      try {
        await router.execute(
          runtimeAcquisition,
          { kind: 'release' },
          AbortSignal.timeout(SAVED_MCP_RUNTIME_DISCOVERY_RELEASE_TIMEOUT_MS),
        );
      } catch (cleanupError: unknown) {
        if (primaryError === undefined) throw cleanupError;
        console.error(
          '[MCP Saved Runtime] Fenced release failed after the primary activity failure:',
          cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
        );
      }
    }
    if (primaryError !== undefined) throw primaryError;
    if (output === undefined) {
      throw new Error(`MCP saved runtime ${operationName} completed without a result`);
    }
    return output;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

interface McpRuntimeHolderKeepalive {
  stop(): Promise<void>;
}

function startMcpRuntimeHolderKeepalive(
  router: McpRuntimeRouter,
  initialAcquisition: McpRuntimeAcquisition,
  activitySignal: AbortSignal,
  heartbeat: (details?: unknown) => void,
): McpRuntimeHolderKeepalive {
  const controller = new AbortController();
  const stopped = new Error('MCP runtime holder keepalive stopped');
  let acquisition = initialAcquisition;
  let stopRequested = false;
  let failure: unknown;
  let stopFlight: Promise<void> | undefined;
  const abortFromActivity = () => controller.abort(activitySignal.reason);
  if (activitySignal.aborted) {
    abortFromActivity();
  } else {
    activitySignal.addEventListener('abort', abortFromActivity, { once: true });
  }

  const flight = (async () => {
    try {
      while (!controller.signal.aborted) {
        await waitForAbortableDelay(
          holderTouchDelay(acquisition.ref.leaseExpiresAt),
          controller.signal,
        );
        heartbeat('mcp-runtime:holder-touch');
        const ref = await router.execute(acquisition, { kind: 'touch' }, controller.signal);
        if (ref.state !== 'ready')
          throw new Error('MCP runtime holder touch did not resolve ready');
        acquisition = { ...acquisition, ref };
      }
    } catch (error: unknown) {
      if (!stopRequested) failure = error;
    }
  })();

  return {
    stop() {
      stopFlight ??= (async () => {
        stopRequested = true;
        activitySignal.removeEventListener('abort', abortFromActivity);
        controller.abort(stopped);
        await flight;
        if (failure !== undefined) throw failure;
      })();
      return stopFlight;
    },
  };
}

function holderTouchDelay(leaseExpiresAt: string): number {
  const remainingMs = Date.parse(leaseExpiresAt) - Date.now();
  if (!Number.isFinite(remainingMs)) return 1;
  return Math.max(
    1,
    Math.min(MAX_MCP_RUNTIME_HOLDER_TOUCH_INTERVAL_MS, Math.floor(remainingMs / 3)),
  );
}

function waitForAbortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function savedRuntimeHolderId(
  activityInfo: ReturnType<typeof Context.current>['info'],
  runtimeKey: McpRuntimeKey,
): McpRuntimeAcquisition['holderId'] {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        'sentris:mcp-runtime-holder:v3',
        activityInfo.workflowExecution.workflowId,
        activityInfo.workflowExecution.runId,
        activityInfo.activityId,
        runtimeKey.sourceId,
        runtimeKey.configFingerprint,
        runtimeKey.organizationId,
        runtimeKey.principalPartitionHash,
        runtimeKey.credentialReference,
        runtimeKey.credentialGeneration,
      ]),
    )
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/**
 * Same-worker stdio executes the requested command directly on this worker and
 * exposes it only through a loopback-bound host proxy.
 * It is therefore disabled by default for multi-user/hardened deployments.
 * A trusted single-admin local operator may explicitly opt in with
 * MCP_DISCOVERY_TRUSTED_LOCAL_STDIO=true.
 */
function isTrustedLocalStdioDiscoveryEnabled(): boolean {
  return (
    resolveSentrisTrustProfile(process.env) === 'trusted-local' &&
    process.env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO === 'true'
  );
}

function toUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input instanceof URL ? input.toString() : String(input));
}

function isRedirect(response: Response): boolean {
  return [301, 302, 303, 307, 308].includes(response.status);
}

const BODY_HEADER_NAMES = [
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-md5',
  'content-type',
  'transfer-encoding',
];

const CROSS_ORIGIN_REDIRECT_SAFE_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-md5',
  'content-type',
  'expires',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'pragma',
  'range',
  'user-agent',
]);

async function normalizeFetchRequest(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<{ url: URL; init: RequestInit }> {
  if (!(input instanceof Request)) {
    return {
      url: toUrl(input),
      init: {
        ...init,
        method: (init?.method ?? 'GET').toUpperCase(),
        headers: new Headers(init?.headers),
        redirect: 'manual',
      },
    };
  }

  const request = new Request(input, init);
  const method = request.method.toUpperCase();
  const body =
    method !== 'GET' && method !== 'HEAD' && request.body ? await request.arrayBuffer() : undefined;
  return {
    url: new URL(request.url),
    init: {
      method,
      headers: new Headers(request.headers),
      body,
      signal: request.signal,
      redirect: 'manual',
    },
  };
}

function rewriteRedirectRequest(status: number, requestInit: RequestInit): RequestInit {
  const method = (requestInit.method ?? 'GET').toUpperCase();
  const switchToGet =
    ((status === 301 || status === 302) && method === 'POST') ||
    (status === 303 && method !== 'GET' && method !== 'HEAD');
  if (!switchToGet) {
    return requestInit;
  }

  const headers = new Headers(requestInit.headers);
  for (const headerName of BODY_HEADER_NAMES) {
    headers.delete(headerName);
  }
  return {
    ...requestInit,
    method: 'GET',
    body: undefined,
    headers,
  };
}

function stripCrossOriginCredentialHeaders(requestInit: RequestInit): RequestInit {
  const headers = new Headers();
  for (const [name, value] of new Headers(requestInit.headers)) {
    if (CROSS_ORIGIN_REDIRECT_SAFE_HEADER_NAMES.has(name.toLowerCase())) {
      headers.append(name, value);
    }
  }
  return { ...requestInit, headers };
}

/**
 * The MCP SDK accepts a custom fetch implementation. Follow redirects manually
 * so every hop is SSRF-validated and credentials are not forwarded cross-origin.
 */
function createSsrfSafeMcpFetch(allowedInternalHosts?: string[]) {
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const normalized = await normalizeFetchRequest(input, init);
    let url = normalized.url;
    let requestInit = normalized.init;

    for (let hop = 0; hop <= MAX_HTTP_REDIRECTS; hop += 1) {
      await validateUrlForSsrf(url.toString(), { allowedInternalHosts });
      const response = await fetch(url, requestInit);
      if (!isRedirect(response)) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) {
        return response;
      }
      await response.body?.cancel();
      if (hop === MAX_HTTP_REDIRECTS) {
        throw new Error(`MCP discovery exceeded ${MAX_HTTP_REDIRECTS} HTTP redirects`);
      }

      const nextUrl = new URL(location, url);
      requestInit = rewriteRedirectRequest(response.status, requestInit);
      if (nextUrl.origin !== url.origin) {
        requestInit = stripCrossOriginCredentialHeaders(requestInit);
      }
      url = nextUrl;
    }

    throw new Error('MCP discovery redirect handling failed');
  };
}

function logMcpDiscoveryEntry(prefix: string, entry: LogEventInput): void {
  const message = `[${prefix}] ${entry.message}`;
  if (entry.level === 'error') {
    console.error(message);
    return;
  }
  if (entry.level === 'warn') {
    console.warn(message);
    return;
  }
  workflowDiagnosticLog(message);
}

/**
 * Cache discovery results in Redis
 */
export async function cacheDiscoveryResultActivity(input: {
  cacheToken: string;
  tools: McpTool[];
  workflowId: string;
}): Promise<void> {
  const key = `mcp-discovery:${input.cacheToken}`;
  const pendingValue = await redis.get(key);
  if (!pendingValue) {
    throw new Error('MCP discovery cache ownership record is missing or expired');
  }
  let pending: { organizationId?: string };
  try {
    pending = JSON.parse(pendingValue) as { organizationId?: string };
  } catch {
    throw new Error('MCP discovery cache ownership record is invalid');
  }
  if (!pending.organizationId) {
    throw new Error('MCP discovery cache ownership record is missing organizationId');
  }
  const value = JSON.stringify({
    status: 'completed',
    workflowId: input.workflowId,
    organizationId: pending.organizationId,
    tools: input.tools,
    toolCount: input.tools.length,
    cachedAt: new Date().toISOString(),
  });
  await redis.setex(key, 300, value); // 5 minutes TTL
  workflowDiagnosticLog(
    `[MCP Discovery] Cached discovery results: ${input.tools.length} tools for token ${input.cacheToken}`,
  );
}

/**
 * Retrieve cached discovery results from Redis
 */
export async function getCachedDiscoveryActivity(input: {
  cacheToken: string;
}): Promise<{ tools: McpTool[]; toolCount: number } | null> {
  const key = `mcp-discovery:${input.cacheToken}`;
  const value = await redis.get(key);
  if (!value) {
    return null;
  }
  const cached = JSON.parse(value);
  if (cached.status !== 'completed') {
    return null;
  }
  return {
    tools: cached.tools,
    toolCount: cached.toolCount,
  };
}

/**
 * Main discovery activity for MCP servers.
 * Supports HTTP direct connections and explicitly enabled trusted-local stdio.
 *
 * For STDIO transport:
 * - Starts the MCP command on this worker behind a loopback-only host proxy
 * - Waits for the same-worker proxy to be ready
 * - Discovers tools via MCP protocol
 * - Stops the proxy and child process in the finally block
 *
 * For HTTP transport:
 * - Connects directly to the endpoint
 * - Tests connection with initialize
 * - Discovers tools via MCP protocol
 */
export async function discoverMcpToolsActivity(
  input: DiscoveryActivityInput,
): Promise<DiscoveryActivityOutput> {
  const ctx = Context.current();
  let hostProxyId: string | undefined;

  try {
    let endpoint: string;

    // HTTP: direct connection
    if (input.transport === 'http') {
      if (!input.endpoint) {
        throw new Error('endpoint is required for http transport');
      }
      endpoint = input.endpoint;
      ctx.heartbeat('http-endpoint-ready');
    }
    // STDIO: start a same-worker, loopback-only host proxy.
    else if (input.transport === 'stdio') {
      if (!input.command) {
        throw new Error('command is required for stdio transport');
      }
      if (!isTrustedLocalStdioDiscoveryEnabled()) {
        throw new Error(
          'MCP same-worker loopback stdio discovery requires the trusted-local profile and MCP_DISCOVERY_TRUSTED_LOCAL_STDIO=true',
        );
      }
      const result = await startStdioHostProxy({
        command: input.command,
        args: input.args || [],
      });
      hostProxyId = result.proxyId;
      if (!hostProxyId) {
        throw new Error('Same-worker stdio host proxy ID is required');
      }
      endpoint = result.endpoint;
      ctx.heartbeat('host-proxy-started');
      await waitForStdioProxyReady(endpoint);
      ctx.heartbeat('host-proxy-ready');
    } else {
      throw new Error(`Unsupported transport: ${(input as any).transport}`);
    }

    // Discover tools
    const tools = await discoverMcpToolsFromEndpoint(
      endpoint,
      input.headers,
      input.transport === 'stdio' ? [MCP_STDIO_HOST_PROXY_HOST] : undefined,
    );
    ctx.heartbeat('tools-discovered');
    return { tools };
  } catch (error: unknown) {
    if (error instanceof SsrfBlockedError) {
      throw ApplicationFailure.nonRetryable(error.message, error.name);
    }
    throw error;
  } finally {
    if (hostProxyId) {
      await stopMcpStdioHostProxy(hostProxyId);
    }
  }
}

/**
 * Group discovery activity for MCP servers.
 * Uses a single stdio proxy container with named servers for all stdio configs.
 */
export async function discoverMcpGroupToolsActivity(
  input: GroupDiscoveryActivityInput,
): Promise<GroupDiscoveryActivityOutput> {
  const ctx = Context.current();
  let dockerContainerId: string | undefined;
  let baseEndpoint: string | undefined;
  let proxyAuthToken: string | undefined;

  try {
    const stdioServers = input.servers.filter((server) => server.transport === 'stdio');
    const httpServers = input.servers.filter((server) => server.transport === 'http');

    if (stdioServers.length > 0) {
      const spawn = await spawnNamedServersContainer({
        servers: stdioServers,
        image: input.image,
      });
      dockerContainerId = spawn.containerId;
      baseEndpoint = spawn.baseEndpoint;
      proxyAuthToken = spawn.authToken;
      ctx.heartbeat('container-spawned');
      await waitForStdioProxyReady(`${baseEndpoint}/health`, {
        [MCP_DOCKER_PROXY_AUTH_HEADER]: proxyAuthToken,
      });
      ctx.heartbeat('container-ready');
    }

    const results: GroupDiscoveryActivityResult[] = [];

    for (const server of httpServers) {
      try {
        if (!server.endpoint) {
          throw new Error('endpoint is required for http transport');
        }
        const tools = await discoverMcpToolsFromEndpoint(server.endpoint, server.headers);
        results.push({ name: server.name, tools });
        ctx.heartbeat(`http-discovered:${server.name}`);
      } catch (error: unknown) {
        results.push({
          name: server.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const server of stdioServers) {
      try {
        if (!baseEndpoint) {
          throw new Error('stdio proxy endpoint not available');
        }
        const endpoint = `${baseEndpoint}/servers/${encodeURIComponent(server.name)}/sse`;
        const proxyHeaders = {
          ...(server.headers ?? {}),
          [MCP_DOCKER_PROXY_AUTH_HEADER]: proxyAuthToken!,
        };
        await waitForStdioProxyReady(`${baseEndpoint}/health`, proxyHeaders);
        const tools = await discoverMcpToolsFromEndpoint(endpoint, proxyHeaders, [
          new URL(baseEndpoint).hostname,
        ]);
        results.push({ name: server.name, tools });
        ctx.heartbeat(`stdio-discovered:${server.name}`);
      } catch (error: unknown) {
        results.push({
          name: server.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { results };
  } finally {
    if (dockerContainerId) {
      await cleanupDockerContainer(dockerContainerId);
    }
  }
}

/**
 * Start a same-worker stdio process behind a loopback-only HTTP proxy.
 */
async function startStdioHostProxy(input: {
  command: string;
  args: string[];
}): Promise<{ proxyId: string; endpoint: string }> {
  const context = createExecutionContext({
    runId: `mcp-discovery-${Date.now()}`,
    componentRef: 'mcp-discovery',
    logCollector: (entry) => {
      logMcpDiscoveryEntry('MCP Discovery', entry);
    },
  });

  const result = await startMcpStdioHostProxy({
    command: input.command,
    args: input.args,
    context,
  });

  const proxyId = result.proxyId;
  if (!proxyId) {
    throw new Error('Same-worker stdio host proxy ID was not returned');
  }

  return {
    proxyId,
    endpoint: result.endpoint,
  };
}

async function spawnNamedServersContainer(input: {
  servers: { name: string; command?: string; args?: string[] }[];
  image?: string;
}): Promise<{ containerId: string; baseEndpoint: string; authToken: string }> {
  const context = createExecutionContext({
    runId: `mcp-group-discovery-${Date.now()}`,
    componentRef: 'mcp-group-discovery',
    logCollector: (entry) => {
      logMcpDiscoveryEntry('MCP Group Discovery', entry);
    },
  });

  const { awsEnv, volumes } = getAwsConfig();

  const namedServers: Record<string, { command: string; args?: string[] }> = {};
  for (const server of input.servers) {
    if (!server.command) {
      throw new Error(`command is required for stdio server '${server.name}'`);
    }
    namedServers[server.name] = {
      command: server.command,
      args: server.args ?? [],
    };
  }

  const result = await startMcpDockerServer({
    image: input.image || 'zebbern/mcp-stdio-proxy:latest',
    command: [],
    env: {
      MCP_NAMED_SERVERS: JSON.stringify({ mcpServers: namedServers }),
      ...awsEnv,
    },
    volumes: volumes.length > 0 ? volumes : undefined,
    port: 0,
    autoRemove: true,
    params: {},
    context,
  });

  const containerId = result.containerId;
  if (!containerId) {
    throw new Error('Docker container ID not returned from startMcpDockerServer');
  }

  const baseEndpoint = result.endpoint.replace(/\/mcp$/, '');
  return { containerId, baseEndpoint, authToken: result.authToken };
}

function getAwsConfig(): {
  awsEnv: Record<string, string>;
  volumes: { source: string; target: string; readOnly?: boolean }[];
} {
  const awsEnv: Record<string, string> = {};
  const passThroughEnv = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'AWS_PROFILE',
  ];
  for (const key of passThroughEnv) {
    const value = process.env[key];
    if (value) {
      awsEnv[key] = value;
    }
  }

  const home = homedir();
  const awsCredentials = join(home, '.aws', 'credentials');
  const awsConfig = join(home, '.aws', 'config');
  const volumes = [];
  if (existsSync(awsCredentials)) {
    volumes.push({ source: awsCredentials, target: '/root/.aws/credentials', readOnly: true });
  }
  if (existsSync(awsConfig)) {
    volumes.push({ source: awsConfig, target: '/root/.aws/config', readOnly: true });
  }

  return { awsEnv, volumes };
}

async function discoverMcpToolsFromEndpoint(
  endpoint: string,
  headers?: Record<string, string>,
  allowedInternalHosts?: string[],
): Promise<McpTool[]> {
  let client: Client | null = null;

  try {
    await validateUrlForSsrf(endpoint, { allowedInternalHosts });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: {
        headers: {
          Accept: 'application/json, text/event-stream',
          ...(headers || {}),
        },
      },
      fetch: createSsrfSafeMcpFetch(allowedInternalHosts),
    });

    client = new Client(
      { name: 'sentris-worker-mcp-discovery', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    const result = await client.listTools();

    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

/**
 * Wait for the stdio HTTP proxy and its MCP child process to be ready.
 */
async function waitForStdioProxyReady(
  endpoint: string,
  headers?: Record<string, string>,
): Promise<void> {
  const healthUrl = endpoint.includes('/health') ? endpoint : endpoint.replace('/mcp', '/health');
  const maxAttempts = 60; // 60 seconds total (STDIO connection can take time)
  const pollInterval = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(healthUrl, { method: 'GET', headers });
      if (response.ok) {
        const data = (await response.json()) as {
          status?: string;
          servers?: { ready: boolean }[];
        };
        if (data.status === 'ok') {
          // Check if the MCP server is actually ready (STDIO client connected)
          const servers = data.servers ?? [];
          const allReady = servers.every((s) => s.ready);
          if (servers.length > 0 && allReady) {
            workflowDiagnosticLog(
              `[MCP Discovery] STDIO proxy ready after ${attempt + 1}s (${servers.length} server(s) ready)`,
            );
            return;
          }
          // HTTP is up but waiting for STDIO client connection
          if (attempt % 10 === 0) {
            workflowDiagnosticLog(
              `[MCP Discovery] HTTP ready, waiting for STDIO client... (${servers.filter((s) => s.ready).length}/${servers.length} ready)`,
            );
          }
        }
      }
    } catch {
      // Not ready yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('STDIO proxy failed to become ready after 60 seconds');
}

/**
 * Cleanup a group-discovery Docker container using the Docker CLI.
 */
async function cleanupDockerContainer(dockerContainerId: string | undefined): Promise<void> {
  if (!dockerContainerId) {
    return;
  }
  // Validate container ID to prevent command injection
  if (!/^[a-zA-Z0-9_.-][a-zA-Z0-9_.-]*$/.test(dockerContainerId)) {
    console.warn(`[MCP Discovery] Skipping cleanup with unsafe container id: ${dockerContainerId}`);
    return;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('docker', ['rm', '-f', dockerContainerId]);
    removeMcpDockerProxyTarget(dockerContainerId);
  } catch (error: unknown) {
    console.error(`[MCP Discovery] Failed to cleanup container ${dockerContainerId}:`, error);
  }
}
