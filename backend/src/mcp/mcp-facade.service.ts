import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  createMcpHandler,
  type McpRequestContext,
  type McpServer,
} from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  type NodeIncomingMessageLike,
  type NodeServerResponseLike,
} from '@modelcontextprotocol/node';

export interface McpFacadeServerProvider {
  createServer(context: McpRequestContext): Promise<McpServer>;
}

export interface McpFacadeEndpoint {
  handle(
    req: NodeIncomingMessageLike,
    res: NodeServerResponseLike,
    parsedBody?: unknown,
  ): Promise<void>;
  close(): Promise<void>;
}

@Injectable()
export class McpFacadeService implements OnModuleDestroy {
  private readonly logger = new Logger(McpFacadeService.name);
  private readonly endpoints = new Set<McpFacadeEndpoint>();

  createEndpoint(provider: McpFacadeServerProvider): McpFacadeEndpoint {
    const onerror = (error: Error) => this.logger.error(error.message, error.stack);
    const handler = createMcpHandler((context) => provider.createServer(context), {
      legacy: 'stateless',
      responseMode: 'auto',
      onerror,
    });
    const nodeHandler = toNodeHandler(handler, { onerror });
    let closed = false;

    const endpoint: McpFacadeEndpoint = {
      handle: (req, res, parsedBody) => nodeHandler(req, res, parsedBody),
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        this.endpoints.delete(endpoint);
        await handler.close();
      },
    };

    this.endpoints.add(endpoint);
    return endpoint;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.endpoints].map((endpoint) => endpoint.close()));
  }
}
