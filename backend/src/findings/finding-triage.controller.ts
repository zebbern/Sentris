import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { FindingTriageService } from './finding-triage.service';
import { TicketingService } from '../ticketing/ticketing.service';
import { TriageUpdateDto, TriageUpdateSchema } from './dto/triage-update.dto';
import { BulkTriageDto, BulkTriageSchema } from './dto/bulk-triage.dto';
import { TriageHistoryQueryDto, TriageHistoryQuerySchema } from './dto/triage-history.dto';
import { FindingIdParamSchema } from '../analytics/dto/findings-detail.dto';
import { presentTicketLink } from '../ticketing/ticket-link.presenter';
import { TicketLinkResponseDto } from '../ticketing/dto/ticketing.dto';

@ApiTags('findings')
@ApiExtraModels(TicketLinkResponseDto)
@Controller('findings')
export class FindingTriageController {
  private readonly logger = new Logger(FindingTriageController.name);

  constructor(
    private readonly findingTriageService: FindingTriageService,
    private readonly ticketingService: TicketingService,
  ) {}

  @Patch(':id/triage')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Update triage state for a finding' })
  @ApiParam({
    name: 'id',
    description: 'OpenSearch finding document identifier',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 512 },
  })
  async updateTriage(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FindingIdParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(TriageUpdateSchema)) body: TriageUpdateDto,
  ) {
    this.requireAuth(auth);
    return this.findingTriageService.upsertTriage(auth, params.id, body);
  }

  @Post('bulk-triage')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Bulk update triage state for multiple findings' })
  async bulkTriage(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(BulkTriageSchema)) body: BulkTriageDto,
  ) {
    this.requireAuth(auth);
    return this.findingTriageService.bulkTriage(auth, body.findingIds, {
      status: body.status,
      assigneeUserId: body.assigneeUserId,
      comment: body.comment,
    });
  }

  @Get(':id/history')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get triage event history for a finding' })
  @ApiParam({
    name: 'id',
    description: 'OpenSearch finding document identifier',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 512 },
  })
  async getHistory(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FindingIdParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(TriageHistoryQuerySchema)) query: TriageHistoryQueryDto,
  ) {
    this.requireAuth(auth);
    return this.findingTriageService.getHistory(auth, params.id, query.limit);
  }

  @Get(':id/ticket')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get linked ticket for a finding' })
  @ApiParam({
    name: 'id',
    description: 'OpenSearch finding document identifier',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 512 },
  })
  @ApiOkResponse({
    schema: {
      nullable: true,
      allOf: [{ $ref: getSchemaPath(TicketLinkResponseDto) }],
    },
  })
  async getTicket(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FindingIdParamSchema)) params: { id: string },
  ) {
    this.requireAuth(auth);
    const organizationId = auth.organizationId!;
    const triage = await this.findingTriageService.getTriageRecord(organizationId, params.id);
    if (!triage) {
      return null;
    }
    const link = await this.ticketingService.getTicketLink(organizationId, triage.id);
    if (!link) {
      return null;
    }
    return presentTicketLink(link);
  }

  /**
   * Require authenticated user with an organization context.
   */
  private requireAuth(auth: AuthContext | null): asserts auth is AuthContext & {
    isAuthenticated: true;
    organizationId: string;
  } {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
  }
}
