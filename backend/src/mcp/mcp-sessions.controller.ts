import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionRegistryService } from './session-registry.service';

@ApiTags('mcp')
@Controller('mcp/sessions')
export class McpSessionsController {
  constructor(private readonly sessionRegistry: SessionRegistryService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List active MCP sessions (admin only)' })
  @ApiOkResponse({ description: 'Returns all active MCP sessions across instances' })
  async listSessions() {
    return this.sessionRegistry.listActiveSessions();
  }
}
