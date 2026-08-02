import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  createMcpHandler,
  McpServer,
  ResourceTemplate,
  Server,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { SSEServerTransport } from '@modelcontextprotocol/server-legacy/sse';
import { z } from 'zod';

/** Test-only official v2 server fixtures. Production code never imports this module. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28' as const;
export const INITIALIZE_ERA_PROTOCOL_VERSION = '2025-11-25' as const;
export const STDIO_FIXTURE_SCRIPT = `
import { appendFileSync, writeSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
const writeStderr = () => {
  const remaining = Number(process.env.MCP_STDERR_BYTES ?? '0');
  const chunk = Buffer.alloc(Math.min(64 * 1024, remaining), 120);
  let written = 0;
  while (written < remaining) {
    written += writeSync(2, chunk, 0, Math.min(chunk.length, remaining - written));
  }
};
if (process.env.MCP_SPAWN_LOG) {
  appendFileSync(process.env.MCP_SPAWN_LOG, 'start:' + process.pid + '\\n');
}
writeStderr();
serveStdio(() => {
  const server = new McpServer({ name: 'task-2-stdio-fixture', version: '1.0.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
  server.registerTool('echo', {}, async () => {
    writeStderr();
    return { content: [{ type: 'text', text: 'stdio' }] };
  });
  return server;
});
await new Promise(() => {});
`;

export const LEGACY_STDIO_FIXTURE_SCRIPT = `
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
await new Promise((resolve) => setTimeout(resolve, Number(process.env.MCP_START_DELAY_MS ?? '0')));
const server = new Server(
  { name: 'task-2-legacy-stdio-fixture', version: '1.0.0' },
  { capabilities: {} },
);
await server.connect(new StdioServerTransport());
await new Promise(() => {});
`;

export interface HttpFixture {
  endpoint: URL;
  requests: FixtureRequest[];
  operationState?: FixtureOperationState;
  close(): Promise<void>;
}

export interface FixtureOperationState {
  cancellations: number;
  completions: number;
  progressNotifications: number;
}

export interface FixtureRequest {
  method: string;
  authorization?: string;
  sessionId?: string | null;
  lastEventId?: string | null;
  resumptionToken?: string | null;
  rpcMethod?: string;
}

export async function startHttpFixture(
  options: {
    sessionful?: boolean;
    legacyProtocolOnly?: boolean;
    expectedAuthorization?: string;
    toolDelayMs?: number;
    toolProgress?: { count: number; intervalMs: number };
  } = {},
): Promise<HttpFixture> {
  const operationState: FixtureOperationState = {
    cancellations: 0,
    completions: 0,
    progressNotifications: 0,
  };
  const createServer = () => {
    const server = new McpServer(
      { name: 'task-2-fixture', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );
    server.registerTool(
      'echo',
      {
        title: 'Echo',
        description: 'Returns the supplied value',
        inputSchema: z.object({ value: z.string() }),
        _meta: { fixture: true },
      },
      async ({ value }, context) => {
        const onAbort = () => {
          operationState.cancellations += 1;
        };
        context.mcpReq.signal.addEventListener('abort', onAbort, { once: true });
        try {
          const progressToken = context.mcpReq._meta?.progressToken;
          for (let index = 1; index <= (options.toolProgress?.count ?? 0); index += 1) {
            await waitForDelay(options.toolProgress!.intervalMs, context.mcpReq.signal);
            if (context.mcpReq.signal.aborted) break;
            if (progressToken !== undefined) {
              try {
                await context.mcpReq.notify({
                  method: 'notifications/progress',
                  params: {
                    progressToken,
                    progress: index,
                    total: options.toolProgress!.count,
                  },
                });
                operationState.progressNotifications += 1;
              } catch {
                break;
              }
            }
          }
          await waitForDelay(options.toolDelayMs ?? 0, context.mcpReq.signal);
          if (!context.mcpReq.signal.aborted) operationState.completions += 1;
          return {
            content: [{ type: 'text', text: value, _meta: { variant: 'text' } }],
            structuredContent: { value },
            _meta: { fixture: true },
          };
        } finally {
          context.mcpReq.signal.removeEventListener('abort', onAbort);
        }
      },
    );
    server.registerResource(
      'report',
      'fixture://report',
      { title: 'Report', mimeType: 'text/plain' },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'fixture report' }],
      }),
    );
    server.registerResource(
      'report-by-id',
      new ResourceTemplate('fixture://reports/{id}', { list: undefined }),
      {
        title: 'Report by ID',
        mimeType: 'text/plain',
        _meta: { fixture: true },
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'templated report' }],
      }),
    );
    server.registerPrompt(
      'greeting',
      { title: 'Greeting', argsSchema: z.object({ name: z.string() }) },
      ({ name }) => ({
        messages: [{ role: 'user', content: { type: 'text', text: `Hello ${name}` } }],
      }),
    );
    return server;
  };

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: options.sessionful ? () => crypto.randomUUID() : undefined,
    supportedProtocolVersions: options.legacyProtocolOnly
      ? [INITIALIZE_ERA_PROTOCOL_VERSION]
      : undefined,
    keepAliveMs: 0,
  });
  const legacyServer = options.legacyProtocolOnly ? createServer() : undefined;
  if (legacyServer) await legacyServer.connect(transport);
  const modernHandler = options.legacyProtocolOnly ? undefined : createMcpHandler(createServer);
  const requests: FixtureRequest[] = [];
  const listener = Bun.serve({
    port: 0,
    async fetch(request) {
      const authorization = request.headers.get('authorization') ?? undefined;
      requests.push(await describeRequest(request, authorization));
      if (
        options.expectedAuthorization !== undefined &&
        authorization !== options.expectedAuthorization
      ) {
        return new Response(null, { status: 401 });
      }
      return modernHandler ? modernHandler.fetch(request) : transport.handleRequest(request);
    },
  });
  return {
    endpoint: new URL(`http://127.0.0.1:${listener.port}/mcp`),
    requests,
    operationState,
    async close() {
      listener.stop(true);
      await legacyServer?.close();
    },
  };
}

export async function startPaginationFixture(): Promise<HttpFixture> {
  const createServer = () => {
    const server = new Server(
      { name: 'task-2-pagination-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler('tools/list', async (request) => {
      const page = Number(request.params?.cursor ?? '0');
      return {
        tools: [{ name: `tool-${page}`, inputSchema: { type: 'object' as const } }],
        nextCursor: String(page + 1),
      };
    });
    return server;
  };
  const handler = createMcpHandler(createServer);
  const requests: FixtureRequest[] = [];
  const listener = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await describeRequest(request));
      return handler.fetch(request);
    },
  });
  return {
    endpoint: new URL(`http://127.0.0.1:${listener.port}/mcp`),
    requests,
    async close() {
      listener.stop(true);
    },
  };
}

/** Frozen official v1 SSE transport fixture used only to verify bounded compatibility fallback. */
export async function startLegacySseFixture(
  options: {
    expectedAuthorization?: string;
    authenticateFallbackRoutesOnly?: boolean;
    fallbackStartDelayMs?: number;
  } = {},
): Promise<HttpFixture> {
  const requests: FixtureRequest[] = [];
  const connections = new Map<string, { transport: SSEServerTransport; server: McpServer }>();
  const listener = createNodeHttpServer((request, response) => {
    void handleLegacySseRequest(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain' });
      }
      if (!response.writableEnded) {
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
  });

  const handleLegacySseRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const method = request.method ?? 'GET';
    const authorization = request.headers.authorization;
    requests.push({ method, ...(authorization === undefined ? {} : { authorization }) });
    const isFallbackRoute =
      (method === 'GET' && urlPath(request.url) === '/sse') ||
      (method === 'POST' && urlPath(request.url) === '/messages');
    if (
      options.expectedAuthorization !== undefined &&
      (!options.authenticateFallbackRoutesOnly || isFallbackRoute) &&
      authorization !== options.expectedAuthorization
    ) {
      response.writeHead(401);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (method === 'GET' && url.pathname === '/sse') {
      if (options.fallbackStartDelayMs) await Bun.sleep(options.fallbackStartDelayMs);
      if (response.destroyed || response.writableEnded) return;
      const transport = new SSEServerTransport('/messages', response);
      const server = createLegacySseServer();
      connections.set(transport.sessionId, { transport, server });
      response.once('close', () => connections.delete(transport.sessionId));
      await server.connect(transport);
      return;
    }

    if (method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      const connection = sessionId ? connections.get(sessionId) : undefined;
      if (!connection) {
        response.writeHead(404);
        response.end();
        return;
      }
      await connection.transport.handlePostMessage(request, response);
      return;
    }

    response.writeHead(method === 'POST' && url.pathname === '/sse' ? 405 : 404);
    response.end();
  };

  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Legacy SSE fixture did not bind a TCP port');
  }

  return {
    endpoint: new URL(`http://127.0.0.1:${address.port}/sse`),
    requests,
    async close() {
      await Promise.allSettled([...connections.values()].map(({ server }) => server.close()));
      connections.clear();
      await new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function startHangingLegacySseFixture(releaseAfterMs = 300): Promise<HttpFixture> {
  const requests: FixtureRequest[] = [];
  const openResponses = new Set<ServerResponse>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listener = createNodeHttpServer((request, response) => {
    const method = request.method ?? 'GET';
    requests.push({ method });
    const path = urlPath(request.url);
    if (method === 'POST' && path === '/sse') {
      response.writeHead(405);
      response.end();
      return;
    }
    if (method === 'GET' && path === '/sse') {
      openResponses.add(response);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
        'cache-control': 'no-cache',
      });
      response.write(': waiting\n\n');
      const timer = setTimeout(() => {
        timers.delete(timer);
        openResponses.delete(response);
        response.end();
      }, releaseAfterMs);
      timers.add(timer);
      response.once('close', () => {
        clearTimeout(timer);
        timers.delete(timer);
        openResponses.delete(response);
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Hanging legacy SSE fixture did not bind a TCP port');
  }
  return {
    endpoint: new URL(`http://127.0.0.1:${address.port}/sse`),
    requests,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const response of openResponses) response.end();
      openResponses.clear();
      await new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function describeRequest(
  request: Request,
  authorization = request.headers.get('authorization') ?? undefined,
): Promise<FixtureRequest> {
  let rpcMethod: string | undefined;
  if (request.method === 'POST') {
    try {
      const body = (await request.clone().json()) as { method?: unknown };
      if (typeof body.method === 'string') rpcMethod = body.method;
    } catch {
      // Ignore non-JSON POST bodies; the request log still records transport state.
    }
  }
  return {
    method: request.method,
    ...(authorization === undefined ? {} : { authorization }),
    sessionId: request.headers.get('mcp-session-id'),
    lastEventId: request.headers.get('last-event-id'),
    resumptionToken: request.headers.get('mcp-resumption-token'),
    ...(rpcMethod === undefined ? {} : { rpcMethod }),
  };
}

function createLegacySseServer(): McpServer {
  const server = new McpServer(
    { name: 'task-2-legacy-sse-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    'legacy_echo',
    {
      title: 'Legacy Echo',
      description: 'Returns the supplied value over frozen SSE',
      inputSchema: z.object({ value: z.string() }),
    },
    async ({ value }) => ({ content: [{ type: 'text', text: value }] }),
  );
  return server;
}

function urlPath(url: string | undefined): string {
  return new URL(url ?? '/', 'http://127.0.0.1').pathname;
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delayMs);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
