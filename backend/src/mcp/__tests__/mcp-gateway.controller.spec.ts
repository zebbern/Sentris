import { afterEach, describe, expect, it, jest } from 'bun:test';
import express, { type Request, type Response } from 'express';
import type { Server as HttpServer } from 'node:http';
import { createMCPClient } from '@ai-sdk/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpGatewayController } from '../mcp-gateway.controller';
import type { McpGatewayRequest } from '../mcp-auth.guard';
import type { McpGatewayService } from '../mcp-gateway.service';
import type { SessionRegistryService } from '../session-registry.service';

describe('McpGatewayController protocol lifecycle', () => {
  let httpServer: HttpServer | undefined;
  const createdServers: McpServer[] = [];

  afterEach(async () => {
    await Promise.all(createdServers.splice(0).map((server) => server.close().catch(() => {})));

    if (httpServer) {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it('rejects the AI SDK pre-initialize GET without breaking tool discovery', async () => {
    const mcpGateway = {
      getServerForRun: async () => {
        const server = new McpServer({ name: 'sentris-test-gateway', version: '1.0.0' });
        server.registerTool('echo', { description: 'Echo a value' }, async () => ({
          content: [{ type: 'text', text: 'ok' }],
        }));
        createdServers.push(server);
        return server;
      },
      cleanupSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as McpGatewayService;
    let markRegistrationStarted!: () => void;
    let releaseRegistration!: () => void;
    const registrationStarted = new Promise<void>((resolve) => {
      markRegistrationStarted = resolve;
    });
    const registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const sessionRegistry = {
      register: jest.fn(async () => {
        // The controller stores the transport immediately before registering it. Hold
        // this boundary open to exercise a GET that lands before initialize is handled.
        markRegistrationStarted();
        await registrationGate;
      }),
      deregister: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionRegistryService;
    const controller = new McpGatewayController(mcpGateway, sessionRegistry);

    const app = express();
    app.use(express.json());
    app.all('/gateway', async (req: Request, res: Response) => {
      const gatewayRequest = req as McpGatewayRequest;
      gatewayRequest.auth = {
        token: 'test-session-token',
        clientId: 'test-agent',
        scopes: ['tools:list', 'tools:call'],
        extra: {
          runId: 'run-1',
          organizationId: 'org-1',
          allowedNodeIds: ['tool-node'],
        },
      };
      await controller.handleGateway(gatewayRequest, res);
    });

    httpServer = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => httpServer?.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP port');
    }
    const gatewayUrl = `http://127.0.0.1:${address.port}/gateway`;

    const unknownSessionStream = await fetch(gatewayUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer test-session-token',
        'Mcp-Session-Id': 'missing-session',
      },
    });
    expect(unknownSessionStream.status).toBe(404);

    const preInitializeStream = await fetch(gatewayUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer test-session-token',
      },
    });
    expect(preInitializeStream.status).toBe(405);

    const clientPromise = createMCPClient({
      transport: {
        type: 'http',
        url: gatewayUrl,
        headers: { Authorization: 'Bearer test-session-token' },
      },
    });

    await registrationStarted;
    const overlappingPreInitializeStream = await fetch(gatewayUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer test-session-token',
      },
    });
    const overlappingStatus = overlappingPreInitializeStream.status;
    releaseRegistration();

    const client = await clientPromise;

    try {
      expect(overlappingStatus).toBe(405);

      // A preflight GET may be serviced after the SDK has assigned a server-side
      // session ID but before the client has received it, so it still has no header.
      const stalePreflightStream = await fetch(gatewayUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer test-session-token',
        },
      });
      expect(stalePreflightStream.status).toBe(405);

      const tools = await client.tools();
      expect(Object.keys(tools)).toEqual(['echo']);
    } finally {
      await client.close();
    }
  });
});
