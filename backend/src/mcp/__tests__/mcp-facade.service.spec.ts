import { afterEach, describe, expect, it, jest } from 'bun:test';
import { Logger } from '@nestjs/common';
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';
import { McpServer, type AuthInfo, type McpRequestContext } from '@modelcontextprotocol/server';
import type { NodeIncomingMessageLike, NodeServerResponseLike } from '@modelcontextprotocol/node';
import { McpFacadeService, type McpFacadeEndpoint } from '../mcp-facade.service';

const MCP_URL = new URL('http://mcp.test/mcp');
const AUTH_INFO: AuthInfo = {
  token: 'validated-token',
  clientId: 'test-client',
  scopes: ['tools:read'],
};

describe('McpFacadeService', () => {
  const clients: Client[] = [];
  const services: McpFacadeService[] = [];

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await Promise.allSettled(services.splice(0).map((service) => service.onModuleDestroy()));
  });

  it('auto-negotiates modern MCP through server/discover and passes request context', async () => {
    const contexts: McpRequestContext[] = [];
    const service = trackService(new McpFacadeService(), services);
    const endpoint = service.createEndpoint({
      async createServer(context) {
        contexts.push(context);
        return createTestServer(context);
      },
    });
    const inProcess = createInProcessFetch(endpoint, AUTH_INFO);
    const client = trackClient(
      new Client(
        { name: 'modern-test-client', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      ),
      clients,
    );

    await client.connect(new StreamableHTTPClientTransport(MCP_URL, { fetch: inProcess.fetch }));
    const listed = await client.listTools();

    expect(client.getProtocolEra()).toBe('modern');
    expect(inProcess.methods[0]).toBe('server/discover');
    expect(listed.tools.map((tool) => tool.name)).toContain('context');
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every((context) => context.era === 'modern')).toBe(true);
    expect(contexts.every((context) => context.authInfo === AUTH_INFO)).toBe(true);
    expect(contexts.every((context) => context.requestInfo instanceof Request)).toBe(true);
    expect(contexts.every((context) => context.requestInfo?.url === MCP_URL.href)).toBe(true);
  });

  it('serves legacy list and call requests with a fresh stateless server', async () => {
    const contexts: McpRequestContext[] = [];
    const service = trackService(new McpFacadeService(), services);
    const endpoint = service.createEndpoint({
      async createServer(context) {
        contexts.push(context);
        return createTestServer(context);
      },
    });
    const inProcess = createInProcessFetch(endpoint, AUTH_INFO);
    const client = trackClient(
      new Client({ name: 'legacy-test-client', version: '1.0.0' }),
      clients,
    );

    await client.connect(new StreamableHTTPClientTransport(MCP_URL, { fetch: inProcess.fetch }));
    const listed = await client.listTools();
    const called = await client.callTool({ name: 'context' });

    expect(client.getProtocolEra()).toBe('legacy');
    expect(listed.tools.map((tool) => tool.name)).toEqual(['context']);
    expect(called.content).toEqual([{ type: 'text', text: 'legacy' }]);
    expect(contexts.length).toBeGreaterThanOrEqual(3);
    expect(contexts.every((context) => context.era === 'legacy')).toBe(true);
    expect(contexts.every((context) => context.authInfo === AUTH_INFO)).toBe(true);
  });

  it('rejects legacy session operations with method not allowed', async () => {
    const service = trackService(new McpFacadeService(), services);
    const endpoint = service.createEndpoint({
      createServer: async (context) => createTestServer(context),
    });
    const inProcess = createInProcessFetch(endpoint, AUTH_INFO);

    for (const method of ['GET', 'DELETE']) {
      const response = await inProcess.fetch(MCP_URL, { method });

      expect(response.status).toBe(405);
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });

  it('rejects POST bodies with a non-JSON content type', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = trackService(new McpFacadeService(), services);
    const endpoint = service.createEndpoint({
      createServer: async (context) => createTestServer(context),
    });
    const inProcess = createInProcessFetch(endpoint, AUTH_INFO);

    const response = await inProcess.fetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(415);
    expect(logError).toHaveBeenCalledTimes(1);
    logError.mockRestore();
  });

  it('closes a modern exchange that is still in flight', async () => {
    let started!: () => void;
    const exchangeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let releaseExchange!: () => void;
    const exchangeBlocker = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    const service = trackService(new McpFacadeService(), services);
    const endpoint = service.createEndpoint({
      async createServer(context) {
        const server = new McpServer({ name: 'facade-test', version: '1.0.0' });
        server.registerTool('wait', {}, async () => {
          started();
          await exchangeBlocker;
          return { content: [{ type: 'text', text: context.era }] };
        });
        return server;
      },
    });
    const inProcess = createInProcessFetch(endpoint, AUTH_INFO);
    const client = trackClient(
      new Client(
        { name: 'close-test-client', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      ),
      clients,
    );
    await client.connect(new StreamableHTTPClientTransport(MCP_URL, { fetch: inProcess.fetch }));

    const call = client.callTool({ name: 'wait' });
    await exchangeStarted;
    await endpoint.close();

    await expect(call).rejects.toBeDefined();
    releaseExchange();
  });
});

function createTestServer(context: McpRequestContext): McpServer {
  const server = new McpServer({ name: 'facade-test', version: '1.0.0' });
  server.registerTool('context', {}, async () => ({
    content: [{ type: 'text', text: context.era }],
  }));
  return server;
}

function trackClient(client: Client, clients: Client[]): Client {
  clients.push(client);
  return client;
}

function trackService(service: McpFacadeService, services: McpFacadeService[]): McpFacadeService {
  services.push(service);
  return service;
}

function createInProcessFetch(
  endpoint: McpFacadeEndpoint,
  authInfo?: AuthInfo,
): {
  fetch: FetchLike;
  methods: string[];
} {
  const methods: string[] = [];

  return {
    methods,
    fetch: async (input, init) => {
      const request = new Request(input instanceof URL ? input.href : input, init);
      const bodyText = await request.text();
      const parsedBody = parseExpressJsonBody(request.headers, bodyText);
      const requestBody = parsedBody === undefined ? bodyText : undefined;
      const headers = Object.fromEntries(request.headers.entries());
      headers.host = request.url.length > 0 ? new URL(request.url).host : MCP_URL.host;
      const requestUrl = new URL(request.url);
      const req: NodeIncomingMessageLike = {
        method: request.method,
        url: `${requestUrl.pathname}${requestUrl.search}`,
        headers,
        auth: authInfo,
        async *[Symbol.asyncIterator]() {
          if (requestBody !== undefined && requestBody.length > 0) {
            yield requestBody;
          }
        },
      };

      const recordedBody = parsedBody ?? parseJson(bodyText);
      if (isRecord(recordedBody) && typeof recordedBody.method === 'string') {
        methods.push(recordedBody.method);
      }

      let responseStarted = false;
      let responseEnded = false;
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let resolveResponse!: (response: Response) => void;
      let rejectResponse!: (error: unknown) => void;
      const responsePromise = new Promise<Response>((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
      });
      const responseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      const res: NodeServerResponseLike = {
        writeHead(statusCode, responseHeaders = {}) {
          responseStarted = true;
          resolveResponse(
            new Response(responseStream, {
              status: statusCode,
              headers: responseHeaders,
            }),
          );
        },
        write(chunk) {
          if (!responseEnded) {
            streamController?.enqueue(toBytes(chunk));
          }
          return true;
        },
        end(chunk) {
          if (responseEnded) {
            return;
          }
          if (chunk !== undefined) {
            streamController?.enqueue(toBytes(chunk));
          }
          responseEnded = true;
          streamController?.close();
        },
        on(event, listener) {
          const eventListeners = listeners.get(event) ?? new Set();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
          return res;
        },
      };

      request.signal.addEventListener(
        'abort',
        () => {
          res.destroyed = true;
          for (const listener of listeners.get('close') ?? []) {
            listener();
          }
          if (!responseEnded) {
            responseEnded = true;
            streamController?.error(request.signal.reason);
          }
        },
        { once: true },
      );

      void endpoint.handle(req, res, parsedBody).catch((error) => {
        if (!responseStarted) {
          rejectResponse(error);
        } else if (!responseEnded) {
          responseEnded = true;
          streamController?.error(error);
        }
      });

      return responsePromise;
    },
  };
}

function parseExpressJsonBody(headers: Headers, body: string): unknown {
  if (!headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return undefined;
  }
  return parseJson(body);
}

function parseJson(value: string): unknown {
  if (value.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBytes(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
}
