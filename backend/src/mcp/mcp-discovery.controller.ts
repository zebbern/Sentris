import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerApiResponse } from '@nestjs/swagger';

import { ZodValidationPipe } from 'nestjs-zod';

import { McpDiscoveryOrchestratorService } from './mcp-discovery-orchestrator.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthContext } from '../auth/types';
import {
  GroupDiscoveryInputDto,
  GroupDiscoveryInputSchema,
  GroupDiscoveryStartResponseDto,
  GroupDiscoveryStatusDto,
} from './dto/mcp-discovery.dto';

@ApiTags('mcp')
@Controller('mcp')
export class McpDiscoveryController {
  constructor(private readonly orchestrator: McpDiscoveryOrchestratorService) {}

  @Post('discover-group')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start MCP group tool discovery',
    description:
      'Initiates an asynchronous discovery workflow for multiple MCP servers. Returns 202 ACCEPTED with a workflow ID for tracking progress.',
  })
  @SwaggerApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Group discovery workflow started successfully',
    type: GroupDiscoveryStartResponseDto,
  })
  async discoverGroup(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(GroupDiscoveryInputSchema)) input: GroupDiscoveryInputDto,
  ): Promise<GroupDiscoveryStartResponseDto> {
    return this.orchestrator.startGroupDiscovery(input, auth);
  }

  @Get('discover-group/:workflowId')
  @ApiOperation({
    summary: 'Get MCP group discovery status',
    description:
      'Queries the status of an MCP group discovery workflow by workflow ID. Returns current status and discovered tools if available.',
  })
  @SwaggerApiResponse({
    status: HttpStatus.OK,
    description: 'Group discovery status retrieved successfully',
    type: GroupDiscoveryStatusDto,
  })
  @Roles('ADMIN')
  async getGroupStatus(
    @CurrentAuth() auth: AuthContext | null,
    @Param('workflowId') workflowId: string,
  ): Promise<GroupDiscoveryStatusDto> {
    return this.orchestrator.getGroupStatus(workflowId, auth);
  }
}
