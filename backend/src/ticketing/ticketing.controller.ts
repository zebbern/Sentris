import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { TicketingService } from './ticketing.service';
import {
  ConnectJiraDto,
  JiraCallbackQueryDto,
  JiraCallbackQuerySchema,
  UpdateTicketingConfigDto,
} from './dto/ticketing.dto';
import { ConfigureTicketingSchema } from '@sentris/shared';

@ApiTags('ticketing')
@Controller('ticketing')
export class TicketingController {
  constructor(private readonly ticketingService: TicketingService) {}

  @Get('connection')
  @ApiOperation({ summary: 'Get Jira connection status' })
  async getConnection(@CurrentAuth() auth: AuthContext | null) {
    this.requireAuth(auth);
    return this.ticketingService.getConnection(auth.organizationId!);
  }

  @Post('connect')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Initiate Jira OAuth 2.0 connection' })
  async connect(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(ConnectJiraDto.schema)) body: ConnectJiraDto,
  ) {
    this.requireAuth(auth);
    return this.ticketingService.startOAuthFlow(
      auth.organizationId!,
      auth.userId!,
      body.redirectUri,
    );
  }

  @Get('callback')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Handle Jira OAuth callback' })
  async callback(
    @Query(new ZodValidationPipe(JiraCallbackQuerySchema)) query: JiraCallbackQueryDto,
  ) {
    return this.ticketingService.handleOAuthCallback(query.code, query.state);
  }

  @Delete('disconnect')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Disconnect Jira integration' })
  async disconnect(@CurrentAuth() auth: AuthContext | null) {
    this.requireAuth(auth);
    await this.ticketingService.disconnect(auth.organizationId!);
    return { success: true };
  }

  @Put('config')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update ticketing configuration' })
  async updateConfig(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(ConfigureTicketingSchema)) body: UpdateTicketingConfigDto,
  ) {
    this.requireAuth(auth);
    return this.ticketingService.updateConfig(auth.organizationId!, body);
  }

  @Get('projects')
  @ApiOperation({ summary: 'List Jira projects' })
  async listProjects(@CurrentAuth() auth: AuthContext | null) {
    this.requireAuth(auth);
    return this.ticketingService.listProjects(auth.organizationId!);
  }

  @Get('issue-types/:projectKey')
  @ApiOperation({ summary: 'List Jira issue types for a project' })
  async listIssueTypes(
    @CurrentAuth() auth: AuthContext | null,
    @Param('projectKey') projectKey: string,
  ) {
    this.requireAuth(auth);
    return this.ticketingService.listIssueTypes(auth.organizationId!, projectKey);
  }

  /**
   * Require authenticated user with an organization context.
   */
  private requireAuth(auth: AuthContext | null): asserts auth is AuthContext & {
    isAuthenticated: true;
    organizationId: string;
    userId: string;
  } {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
  }
}
