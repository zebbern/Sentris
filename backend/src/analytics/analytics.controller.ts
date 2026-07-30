import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags, ApiHeader, ApiOperation } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { timingSafeCompare } from '../common/crypto-utils';

import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import {
  OPENSEARCH_TENANT_PROVISIONING_TIMEOUT_MS,
  OpenSearchTenantService,
} from './opensearch-tenant.service';
import {
  AnalyticsQueryRequestDto,
  AnalyticsQueryRequestSchema,
  AnalyticsQueryResponseDto,
} from './dto/analytics-query.dto';
import { EnsureTenantDto, EnsureTenantSchema } from './dto/analytics-tenant.dto';
import {
  AnalyticsSettingsResponseDto,
  UpdateAnalyticsSettingsDto,
  UpdateAnalyticsSettingsSchema,
  TIER_LIMITS,
} from './dto/analytics-settings.dto';
import { AuditLogService } from '../audit/audit-log.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { Public } from '../auth/public.decorator';
import type { AuthContext } from '../auth/types';
import type { Request } from 'express';

export function createTenantProvisioningAbortScope(
  request?: Request,
  timeoutMs = OPENSEARCH_TENANT_PROVISIONING_TIMEOUT_MS,
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const requestController = new AbortController();
  const handleRequestAbort = () => {
    requestController.abort(new Error('Tenant provisioning request aborted'));
  };
  const timeout = setTimeout(
    () =>
      requestController.abort(
        new DOMException(`Tenant provisioning exceeded ${timeoutMs}ms`, 'TimeoutError'),
      ),
    timeoutMs,
  );
  if (request?.aborted || request?.socket?.destroyed) {
    handleRequestAbort();
  } else {
    request?.once('aborted', handleRequestAbort);
    request?.socket?.once('close', handleRequestAbort);
  }

  return {
    signal: requestController.signal,
    dispose: () => {
      clearTimeout(timeout);
      request?.off('aborted', handleRequestAbort);
      request?.socket?.off('close', handleRequestAbort);
    },
  };
}

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);
  private readonly internalServiceToken: string;

  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly organizationSettingsService: OrganizationSettingsService,
    private readonly openSearchTenantService: OpenSearchTenantService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.internalServiceToken = this.configService.get<string>('INTERNAL_SERVICE_TOKEN') || '';
  }

  @Post('query')
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests per minute per user
  @ApiOperation({ summary: 'Query analytics data' })
  @ApiOkResponse({
    description: 'Query analytics data for the authenticated organization',
    type: AnalyticsQueryResponseDto,
  })
  @ApiHeader({
    name: 'X-RateLimit-Limit',
    description: 'Maximum number of requests allowed per minute',
    schema: { type: 'integer', example: 100 },
  })
  @ApiHeader({
    name: 'X-RateLimit-Remaining',
    description: 'Number of requests remaining in the current time window',
    schema: { type: 'integer', example: 99 },
  })
  async queryAnalytics(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(AnalyticsQueryRequestSchema)) queryDto: AnalyticsQueryRequestDto,
  ): Promise<AnalyticsQueryResponseDto> {
    // Require authentication
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    // Require organization context
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    // Set defaults
    const size = queryDto.size ?? 10;
    const from = queryDto.from ?? 0;

    this.auditLogService.recordBestEffort(auth, {
      action: 'analytics.query',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: {
        size,
        from,
        hasQuery: Boolean(queryDto.query),
        hasAggs: Boolean(queryDto.aggs),
      },
    });

    // Call the service to execute the query
    return this.securityAnalyticsService.query(auth.organizationId, {
      query: queryDto.query,
      size,
      from,
      aggs: queryDto.aggs,
    });
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get analytics settings' })
  @ApiOkResponse({
    description: 'Get analytics settings for the authenticated organization',
    type: AnalyticsSettingsResponseDto,
  })
  async getAnalyticsSettings(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<AnalyticsSettingsResponseDto> {
    // Require authentication
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    // Require organization context
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    // Get or create organization settings
    const settings = await this.organizationSettingsService.getOrganizationSettings(
      auth.organizationId,
    );

    // Get max retention days for tier
    const maxRetentionDays = this.organizationSettingsService.getMaxRetentionDays(
      settings.subscriptionTier,
    );

    return {
      organizationId: settings.organizationId,
      subscriptionTier: settings.subscriptionTier,
      analyticsRetentionDays: settings.analyticsRetentionDays,
      maxRetentionDays,
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update analytics settings' })
  @ApiOkResponse({
    description: 'Update analytics settings for the authenticated organization',
    type: AnalyticsSettingsResponseDto,
  })
  async updateAnalyticsSettings(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(UpdateAnalyticsSettingsSchema))
    updateDto: UpdateAnalyticsSettingsDto,
  ): Promise<AnalyticsSettingsResponseDto> {
    // Require authentication
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    // Require organization context
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    // Only org admins can update settings
    if (!auth.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only organization admins can update analytics settings');
    }

    // Get current settings to validate against tier
    const currentSettings = await this.organizationSettingsService.getOrganizationSettings(
      auth.organizationId,
    );

    // Determine the tier to validate against (use new tier if provided, otherwise current)
    const tierToValidate = updateDto.subscriptionTier ?? currentSettings.subscriptionTier;

    // Validate retention period is within tier limits
    if (updateDto.analyticsRetentionDays !== undefined) {
      if (
        typeof updateDto.analyticsRetentionDays !== 'number' ||
        !Number.isInteger(updateDto.analyticsRetentionDays)
      ) {
        throw new BadRequestException('Retention period must be an integer number of days');
      }

      const isValid = this.organizationSettingsService.validateRetentionPeriod(
        tierToValidate,
        updateDto.analyticsRetentionDays,
      );

      if (!isValid) {
        const maxDays = TIER_LIMITS[tierToValidate].maxRetentionDays;
        throw new BadRequestException(
          `Retention period of ${updateDto.analyticsRetentionDays} days exceeds the limit for ${TIER_LIMITS[tierToValidate].name} tier (${maxDays} days)`,
        );
      }
    }

    // Update settings
    const updated = await this.organizationSettingsService.updateOrganizationSettings(
      auth.organizationId,
      {
        analyticsRetentionDays: updateDto.analyticsRetentionDays,
        subscriptionTier: updateDto.subscriptionTier,
      },
    );

    // Get max retention days for updated tier
    const maxRetentionDays = this.organizationSettingsService.getMaxRetentionDays(
      updated.subscriptionTier,
    );

    return {
      organizationId: updated.organizationId,
      subscriptionTier: updated.subscriptionTier,
      analyticsRetentionDays: updated.analyticsRetentionDays,
      maxRetentionDays,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Ensure observation storage exists for an organization.
   * Called by the worker before indexing. In secured mode this also provisions
   * the tenant isolation resources.
   *
   * Requires X-Internal-Token header for authentication (internal service-to-service).
   * This endpoint is idempotent - safe to call multiple times.
   */
  @Public()
  @SkipThrottle()
  @Post('ensure-tenant')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ensure tenant resources exist for an organization' })
  @ApiOkResponse({
    description: 'Ensure tenant resources exist for organization',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        securityEnabled: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  async ensureTenant(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body(new ZodValidationPipe(EnsureTenantSchema)) body: EnsureTenantDto,
    @Req() request?: Request,
  ): Promise<{ success: boolean; securityEnabled: boolean; message: string }> {
    // Validate internal service token
    if (!this.internalServiceToken) {
      throw new UnauthorizedException('INTERNAL_SERVICE_TOKEN is not configured');
    }

    if (!internalToken || !timingSafeCompare(internalToken, this.internalServiceToken)) {
      throw new UnauthorizedException('Invalid internal service token');
    }

    const orgId = body.organizationId;

    const securityEnabled = this.openSearchTenantService.isSecurityEnabled();

    // Observation storage is required in both trusted-local and secured modes.
    // The tenant service conditionally skips only Security/Dashboards resources.
    const abortScope = createTenantProvisioningAbortScope(request);
    let success: boolean;
    try {
      success = await this.openSearchTenantService.ensureTenantExists(orgId, abortScope.signal);
    } finally {
      abortScope.dispose();
    }

    return {
      success,
      securityEnabled,
      message: success
        ? securityEnabled
          ? `Tenant provisioned for ${orgId}`
          : `Observation storage provisioned for ${orgId}; security mode disabled`
        : securityEnabled
          ? `Failed to provision tenant for ${orgId}`
          : `Failed to provision observation storage for ${orgId}`,
    };
  }
}
