import { Body, Controller, Get, Logger, Put, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthContext } from '../auth/types';
import { TriageAnalyticsService } from './triage-analytics.service';
import { SlaPolicyService } from './sla-policy.service';
import {
  AnalyticsPeriodQueryDto,
  AnalyticsPeriodQuerySchema,
  TopAssigneesQueryDto,
  TopAssigneesQuerySchema,
} from './dto/triage-analytics.dto';
import { UpsertSlaPoliciesDto } from './dto/sla-policy.dto';
import { UpsertSlaPoliciesSchema } from '@sentris/shared';

@ApiTags('findings')
@Controller('findings')
export class TriageAnalyticsController {
  private readonly logger = new Logger(TriageAnalyticsController.name);

  constructor(
    private readonly analyticsService: TriageAnalyticsService,
    private readonly slaPolicyService: SlaPolicyService,
  ) {}

  // --- Analytics Endpoints ---

  @Get('analytics/posture-trend')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get posture trend over time by severity' })
  async getPostureTrend(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(AnalyticsPeriodQuerySchema)) query: AnalyticsPeriodQueryDto,
  ) {
    this.requireAuth(auth);
    return this.analyticsService.getPostureTrend(auth, query.period);
  }

  @Get('analytics/triage-velocity')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get triage velocity (status changes) over time' })
  async getTriageVelocity(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(AnalyticsPeriodQuerySchema)) query: AnalyticsPeriodQueryDto,
  ) {
    this.requireAuth(auth);
    return this.analyticsService.getTriageVelocity(auth, query.period);
  }

  @Get('analytics/mttr')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get Mean Time to Remediate by severity' })
  async getMttr(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(AnalyticsPeriodQuerySchema)) query: AnalyticsPeriodQueryDto,
  ) {
    this.requireAuth(auth);
    return this.analyticsService.getMttr(auth, query.period);
  }

  @Get('analytics/sla-compliance')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get SLA compliance rates by severity' })
  async getSlaCompliance(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(AnalyticsPeriodQuerySchema)) query: AnalyticsPeriodQueryDto,
  ) {
    this.requireAuth(auth);
    return this.analyticsService.getSlaCompliance(auth, query.period);
  }

  @Get('analytics/status-distribution')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get current status distribution of all findings' })
  async getStatusDistribution(@CurrentAuth() auth: AuthContext | null) {
    this.requireAuth(auth);
    return this.analyticsService.getStatusDistribution(auth);
  }

  @Get('analytics/top-assignees')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get top assignees by triage volume' })
  async getTopAssignees(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(TopAssigneesQuerySchema)) query: TopAssigneesQueryDto,
  ) {
    this.requireAuth(auth);
    return this.analyticsService.getTopAssignees(auth, query.limit);
  }

  // --- SLA Policy Endpoints ---

  @Get('sla-policies')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get SLA policies for the organization' })
  async getSlaPolicies(@CurrentAuth() auth: AuthContext | null) {
    this.requireAuth(auth);
    return this.slaPolicyService.getPolicies(auth);
  }

  @Put('sla-policies')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Upsert SLA policies for the organization' })
  async upsertSlaPolicies(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(UpsertSlaPoliciesSchema)) body: UpsertSlaPoliciesDto,
  ) {
    this.requireAuth(auth);
    return this.slaPolicyService.upsertPolicies(auth, body);
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
