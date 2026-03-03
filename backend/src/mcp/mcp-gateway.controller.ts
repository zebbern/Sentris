import { Controller, All, UseGuards, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { Public } from '../auth/public.decorator';
import { McpAuthGuard, type McpGatewayRequest } from './mcp-auth.guard';
import { McpGatewayService } from './mcp-gateway.service';

@ApiTags('mcp')
@Controller('mcp')
@Public()
@UseGuards(McpAuthGuard)
export class McpGatewayController {
  private readonly logger = new Logger(McpGatewayController.name);

  // Mapping of runId to its current Streamable HTTP transport
  // NOTE: In-memory transport storage for active sessions. Single-instance design.
  // SCALING LIMITATION: For horizontal scaling, implement sticky sessions via load balancer
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  // Pending initialization promises to prevent race conditions when GET SSE and POST
  // initialize requests arrive concurrently (@ai-sdk/mcp HttpMCPTransport fires both
  // simultaneously via `void this.openInboundSse()` followed by POST initialize)
  private readonly pendingInits = new Map<string, Promise<StreamableHTTPServerTransport>>();

  constructor(private readonly mcpGateway: McpGatewayService) {}

  @All('gateway')
  @ApiOperation({ summary: 'Unified MCP Gateway endpoint (Streamable HTTP)' })
  async handleGateway(@Req() req: McpGatewayRequest, @Res() res: Response) {
    const auth = req.auth;
    if (!auth || !auth.extra) {
      return res.status(401).send('Authentication missing');
    }

    const runId = auth.extra.runId as string;
    const organizationId = auth.extra.organizationId as string | null;
    const allowedNodeIds = auth.extra.allowedNodeIds as string[] | undefined;

    if (!runId) {
      return res.status(400).send('runId missing in session token');
    }

    // Cache key includes allowedNodeIds to support multiple agents with different tool scopes
    const cacheKey =
      allowedNodeIds && allowedNodeIds.length > 0
        ? `${runId}:${allowedNodeIds.sort().join(',')}`
        : runId;

    let transport = this.transports.get(cacheKey);
    const body = req.body as unknown;
    const isPost = req.method === 'POST';
    const isGet = req.method === 'GET';
    const isDelete = req.method === 'DELETE';
    const isInitRequest =
      isPost &&
      (isInitializeRequest(body) ||
        (Array.isArray(body) && body.some((item) => isInitializeRequest(item))));

    // Initialization if transport doesn't exist
    if (!transport) {
      if (!isInitRequest && !isGet && !isPost) {
        return res.status(400).send('Bad Request: No valid session ID provided');
      }

      // If another request already started initialization for this cache key, await it
      // instead of creating a duplicate transport (prevents race between GET SSE and POST)
      const pending = this.pendingInits.get(cacheKey);
      if (pending) {
        try {
          transport = await pending;
        } catch (error) {
          this.logger.error(`Pending MCP init failed for run ${runId}: ${error}`);
          return res
            .status(error instanceof Error && error.name === 'NotFoundException' ? 404 : 403)
            .send(error instanceof Error ? error.message : 'Access denied');
        }
      } else {
        this.logger.log(
          `Initializing new MCP transport for run: ${runId} with allowedNodeIds: ${allowedNodeIds?.join(',') ?? 'none'}`,
        );

        const allowedToolsHeader = req.headers['x-allowed-tools'];
        const ALLOWED_TOOLS_MAX = 100;
        const ALLOWED_TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
        const allowedTools =
          typeof allowedToolsHeader === 'string'
            ? allowedToolsHeader
                .split(',')
                .map((t) => t.trim())
                .filter((t) => ALLOWED_TOOL_NAME_REGEX.test(t))
                .slice(0, ALLOWED_TOOLS_MAX)
            : undefined;

        // Create transport and connect server inside a shared promise so concurrent
        // requests (GET SSE + POST initialize) both await the same initialization
        const initPromise = (async () => {
          const t = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          const server = await this.mcpGateway.getServerForRun(
            runId,
            organizationId,
            allowedTools,
            allowedNodeIds,
          );
          await server.connect(t);
          return t;
        })();
        this.pendingInits.set(cacheKey, initPromise);

        try {
          transport = await initPromise;
          this.transports.set(cacheKey, transport);
        } catch (error) {
          this.logger.error(`Failed to initialize MCP server for run ${runId}: ${error}`);
          return res
            .status(error instanceof Error && error.name === 'NotFoundException' ? 404 : 403)
            .send(error instanceof Error ? error.message : 'Access denied');
        } finally {
          this.pendingInits.delete(cacheKey);
        }
      }
    }

    if (isDelete && !transport.sessionId) {
      return res.status(400).send('Bad Request: Server not initialized');
    }

    if (isGet) {
      // Cleanup on client disconnect (specifically for the SSE stream)
      res.on('close', async () => {
        this.logger.log(
          `MCP SSE connection closed for run: ${runId} with allowedNodeIds: ${allowedNodeIds?.join(',') ?? 'none'}`,
        );
        // We don't necessarily want to delete the transport here if POSTs are still allowed,
        // but for Sentris run-bounded sessions, closing SSE usually means the agent is done.
        this.transports.delete(cacheKey);
        await this.mcpGateway.cleanupRun(runId);
      });

      // Handle the initial GET request to start the SSE stream
      // We don't await this because for SSE, it blocks until the connection is closed.
      void transport.handleRequest(req, res);
    } else {
      // Handle POST (Messages) or DELETE (Session termination)
      await transport.handleRequest(req, res, req.body);
    }
  }
}
