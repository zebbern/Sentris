import { afterEach, describe, expect, it, jest } from 'bun:test';
import express, { type Request, type Response as ExpressResponse } from 'express';
import type { Server as HttpServer } from 'node:http';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';

import type { WorkflowRunRepository } from '../../workflows/repository/workflow-run.repository';
import { McpFacadeService } from '../mcp-facade.service';
import { McpGatewayController } from '../mcp-gateway.controller';
import type { McpGatewayRequest } from '../mcp-auth.guard';
import type { McpGatewayService } from '../mcp-gateway.service';
import { RunMcpScopeResolver } from '../run-mcp-scope-resolver.service';

const GRANT_ID = '97d45255-a20d-4f3b-82c7-0e464f57632b';
const AUTH_INFO: AuthInfo = {
  token: 'test-session-token',
  clientId: 'test-agent',
  scopes: ['tools:list', 'tools:call'],
  extra: {
    runId: 'run-1',
    organizationId: 'org-1',
    capabilityGrantId: GRANT_ID,
    allowedNodeIds: ['tool-node'],
  },
};

describe('McpGatewayController stateless protocol lifecycle', () => {
  const httpServers: HttpServer[] = [];
  const facades: McpFacadeService[] = [];
  const modernClients: Client[] = [];
  const legacyClients: MCPClient[] = [];

  afterEach(async () => {
    await Promise.allSettled(legacyClients.splice(0).map((client) => client.close()));
    await Promise.allSettled(modernClients.splice(0).map((client) => client.close()));
    await Promise.all(
      httpServers.splice(0).map(async (server) => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }),
    );
    await Promise.allSettled(facades.splice(0).map((facade) => facade.onModuleDestroy()));
  });

  it('serves official auto-negotiated and AI SDK legacy-stateless clients at one URL', async () => {
    const gateway = createGateway({ reply: 'same-registry' });
    const endpoint = await startGateway(AUTH_INFO, matchingScopeResolver(), gateway);

    const modernHeaders: Headers[] = [];
    const modern = new Client(
      { name: 'official-v2-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    modernClients.push(modern);
    await modern.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        fetch: recordingFetch(modernHeaders),
        requestInit: { headers: { Authorization: `Bearer ${AUTH_INFO.token}` } },
      }),
    );

    expect(modern.getProtocolEra()).toBe('modern');
    expect((await modern.listTools()).tools.map((tool) => tool.name)).toEqual(['echo']);
    expect(await modern.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: 'same-registry' }],
    });
    expectNoSessionState(modernHeaders);

    const legacyHeaders: Headers[] = [];
    const legacy = await createMCPClient({
      transport: {
        type: 'http',
        url: endpoint.url,
        headers: { Authorization: `Bearer ${AUTH_INFO.token}` },
        fetch: recordingFetch(legacyHeaders),
      },
    });
    legacyClients.push(legacy);
    const tools = await legacy.tools();

    expect(Object.keys(tools)).toEqual(['echo']);
    expect(await tools.echo.execute?.({}, {} as never)).toMatchObject({
      content: [{ type: 'text', text: 'same-registry' }],
    });
    expectNoSessionState(legacyHeaders);
  });

  it('rejects legacy session methods without breaking later POST requests', async () => {
    const endpoint = await startGateway(
      AUTH_INFO,
      matchingScopeResolver(),
      createGateway({ reply: 'still-stateless' }),
    );

    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(endpoint.url, {
        method,
        headers: { Authorization: `Bearer ${AUTH_INFO.token}` },
      });
      expect(response.status).toBe(405);
    }

    const modern = new Client(
      { name: 'post-after-method-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    modernClients.push(modern);
    await modern.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: { Authorization: `Bearer ${AUTH_INFO.token}` } },
      }),
    );

    expect((await modern.listTools()).tools.map((tool) => tool.name)).toEqual(['echo']);
  });

  it.each([
    ['missing', undefined],
    ['organization-mismatched', { organizationId: 'org-2' }],
  ])('rejects %s run scope before creating a server', async (_label, run) => {
    const createServerForRun = jest.fn(async () => createToolServer('must-not-run'));
    const gateway = { createServerForRun } as unknown as McpGatewayService;
    const resolver = new RunMcpScopeResolver({
      findByRunId: jest.fn(async () => run),
    } as unknown as WorkflowRunRepository);
    const endpoint = await startGateway(AUTH_INFO, resolver, gateway);
    const client = new Client(
      { name: 'scope-rejection-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    modernClients.push(client);

    await expect(
      client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.url), {
          requestInit: { headers: { Authorization: `Bearer ${AUTH_INFO.token}` } },
        }),
      ),
    ).rejects.toBeDefined();
    expect(createServerForRun).not.toHaveBeenCalled();
  });

  it('continues serving modern requests after a fresh facade and controller simulate restart', async () => {
    const registry = { reply: 'survives-restart' };
    const gateway = createGateway(registry);

    for (let attempt = 0; attempt < 2; attempt++) {
      const endpoint = await startGateway(AUTH_INFO, matchingScopeResolver(), gateway);
      const client = new Client(
        { name: `restart-test-${attempt}`, version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      );
      modernClients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.url), {
          requestInit: { headers: { Authorization: `Bearer ${AUTH_INFO.token}` } },
        }),
      );

      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'survives-restart' }],
      });
      await client.close();
      modernClients.splice(modernClients.indexOf(client), 1);
      endpoint.server.closeAllConnections();
      await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));
      httpServers.splice(httpServers.indexOf(endpoint.server), 1);
      await endpoint.facade.onModuleDestroy();
      facades.splice(facades.indexOf(endpoint.facade), 1);
    }
  });

  function matchingScopeResolver(): RunMcpScopeResolver {
    return new RunMcpScopeResolver({
      findByRunId: jest.fn(async () => ({ organizationId: 'org-1' })),
    } as unknown as WorkflowRunRepository);
  }

  function createGateway(registry: { reply: string }): McpGatewayService {
    return {
      createServerForRun: async () => createToolServer(registry.reply),
    } as unknown as McpGatewayService;
  }

  async function startGateway(
    authInfo: AuthInfo,
    scopeResolver: RunMcpScopeResolver,
    gateway: McpGatewayService,
  ): Promise<{ url: string; server: HttpServer; facade: McpFacadeService }> {
    const facade = new McpFacadeService();
    facades.push(facade);
    const controller = new McpGatewayController(facade, scopeResolver, gateway);
    const app = express();
    app.use(express.json());
    app.all('/gateway', async (req: Request, res: ExpressResponse) => {
      const gatewayRequest = req as McpGatewayRequest;
      gatewayRequest.auth = authInfo;
      await controller.handleGateway(gatewayRequest, res);
    });

    const server = app.listen(0, '127.0.0.1');
    httpServers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP port');
    }
    return {
      url: `http://127.0.0.1:${address.port}/gateway`,
      server,
      facade,
    };
  }
});

function createToolServer(reply: string): McpServer {
  const server = new McpServer({ name: 'sentris-test-gateway', version: '1.0.0' });
  server.registerTool('echo', { description: 'Return the registry value' }, async () => ({
    content: [{ type: 'text', text: reply }],
  }));
  return server;
}

function recordingFetch(headers: Headers[]): typeof fetch {
  const recordedFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const response = await fetch(input, init);
    headers.push(new Headers(response.headers));
    return response;
  };
  return Object.assign(recordedFetch, { preconnect: fetch.preconnect });
}

function expectNoSessionState(headers: Headers[]): void {
  expect(headers.length).toBeGreaterThan(0);
  for (const responseHeaders of headers) {
    expect(responseHeaders.get('mcp-session-id')).toBeNull();
    expect(responseHeaders.get('set-cookie')).toBeNull();
  }
}
