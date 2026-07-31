import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/public.decorator';
import { McpAuthGuard, type McpGatewayRequest } from './mcp-auth.guard';
import { McpFacadeService, type McpFacadeEndpoint } from './mcp-facade.service';
import { McpGatewayService } from './mcp-gateway.service';
import { RunMcpScopeResolver } from './run-mcp-scope-resolver.service';

@ApiTags('mcp')
@Controller('mcp')
@Public()
@UseGuards(McpAuthGuard)
export class McpGatewayController {
  private readonly endpoint: McpFacadeEndpoint;

  constructor(
    facade: McpFacadeService,
    scopeResolver: RunMcpScopeResolver,
    gateway: McpGatewayService,
  ) {
    this.endpoint = facade.createEndpoint({
      createServer: async ({ authInfo }) => {
        const context = await scopeResolver.resolve(authInfo!);
        return gateway.createServerForRun(context);
      },
    });
  }

  @All('gateway')
  @ApiOperation({ summary: 'Unified MCP Gateway endpoint (Streamable HTTP)' })
  async handleGateway(@Req() req: McpGatewayRequest, @Res() res: Response): Promise<void> {
    await this.endpoint.handle(req, res, req.body);
  }
}
