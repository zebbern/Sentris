import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  NotFoundException,
  Param,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Roles } from '../auth/roles.decorator';
import { timingSafeCompare } from '../common/crypto-utils';

import {
  CompleteOAuthDto,
  CompleteOAuthSchema,
  ConnectionTokenResponseDto,
  IntegrationConnectionResponse,
  IntegrationProviderResponse,
  ProviderConfigurationResponse,
  OAuthStartResponseDto,
  StartOAuthDto,
  StartOAuthSchema,
  UpsertProviderConfigDto,
  UpsertProviderConfigSchema,
} from './integrations.dto';
import { IntegrationsService } from './integrations.service';
import type { IntegrationsEnvConfig } from '../config';
import type { AppConfig } from '../config/app.config';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import type { Request } from 'express';

const OWNERSHIP_INPUT_FIELDS = ['userId', 'organizationId'] as const;

class RejectIntegrationOwnershipInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (this.containsOwnershipInput(request.query) || this.containsOwnershipInput(request.body)) {
      throw new BadRequestException('Ownership fields are derived from authenticated context');
    }
    return true;
  }

  private containsOwnershipInput(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }
    return OWNERSHIP_INPUT_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(value, field),
    );
  }
}

@ApiTags('integrations')
@Controller('integrations')
@UseGuards(RejectIntegrationOwnershipInputGuard)
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly configService: ConfigService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'List all integration providers' })
  @ApiOkResponse({ type: [IntegrationProviderResponse] })
  listProviders(@CurrentAuth() auth: AuthContext | null): IntegrationProviderResponse[] {
    return this.integrations.listProviders(this.requireOrganizationId(auth)).map((provider) => ({
      ...provider,
    }));
  }

  @Get('providers/:provider/config')
  @ApiOperation({ summary: 'Get provider OAuth configuration' })
  @ApiOkResponse({ type: ProviderConfigurationResponse })
  async getProviderConfiguration(
    @Param('provider') provider: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<ProviderConfigurationResponse> {
    const configuration = await this.integrations.getProviderConfiguration(
      provider,
      this.requireOrganizationId(auth),
    );
    return {
      provider: configuration.provider,
      clientId: configuration.clientId,
      hasClientSecret: configuration.hasClientSecret,
      configuredBy: configuration.configuredBy,
      updatedAt: configuration.updatedAt ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Put('providers/:provider/config')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create or update provider OAuth configuration' })
  @ApiOkResponse({ type: ProviderConfigurationResponse })
  async upsertProviderConfiguration(
    @Param('provider') provider: string,
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(UpsertProviderConfigSchema)) body: UpsertProviderConfigDto,
  ): Promise<ProviderConfigurationResponse> {
    const organizationId = this.requireOrganizationId(auth);
    await this.integrations.upsertProviderConfiguration(
      provider,
      {
        clientId: body.clientId,
        clientSecret: body.clientSecret,
      },
      organizationId,
      auth,
    );

    const configuration = await this.integrations.getProviderConfiguration(
      provider,
      organizationId,
    );
    return {
      provider: configuration.provider,
      clientId: configuration.clientId,
      hasClientSecret: configuration.hasClientSecret,
      configuredBy: configuration.configuredBy,
      updatedAt: configuration.updatedAt ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Delete('providers/:provider/config')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete provider OAuth configuration' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Provider configuration deleted' })
  async deleteProviderConfiguration(
    @Param('provider') provider: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<void> {
    await this.integrations.deleteProviderConfiguration(
      provider,
      this.requireOrganizationId(auth),
      auth,
    );
  }

  @Get('connections')
  @ApiOperation({ summary: 'List integration connections' })
  @ApiOkResponse({ type: [IntegrationConnectionResponse] })
  async listConnections(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<IntegrationConnectionResponse[]> {
    const connections = await this.integrations.listConnections(
      this.requireUserId(auth),
      this.requireOrganizationId(auth),
    );
    return connections.map((connection) => ({
      ...connection,
      expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    }));
  }

  @Post(':provider/start')
  @ApiOperation({ summary: 'Start OAuth authorization flow' })
  @ApiOkResponse({ type: OAuthStartResponseDto })
  async startOAuth(
    @Param('provider') provider: string,
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(StartOAuthSchema)) body: StartOAuthDto,
  ): Promise<OAuthStartResponseDto> {
    const response = await this.integrations.startOAuthSession(provider, {
      userId: this.requireUserId(auth),
      organizationId: this.requireOrganizationId(auth),
      redirectUri: body.redirectUri,
      scopes: body.scopes,
      auth,
    });

    return {
      provider: response.provider,
      authorizationUrl: response.authorizationUrl,
      state: response.state,
      expiresIn: response.expiresIn,
    };
  }

  @Post(':provider/exchange')
  @ApiOperation({ summary: 'Complete OAuth token exchange' })
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async completeOAuth(
    @Param('provider') provider: string,
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(CompleteOAuthSchema)) body: CompleteOAuthDto,
  ): Promise<IntegrationConnectionResponse> {
    const connection = await this.integrations.completeOAuthSession(provider, {
      userId: this.requireUserId(auth),
      organizationId: this.requireOrganizationId(auth),
      code: body.code,
      state: body.state,
      redirectUri: body.redirectUri,
      scopes: body.scopes,
      auth,
    });

    return {
      ...connection,
      expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }

  @Post('connections/:id/refresh')
  @ApiOperation({ summary: 'Refresh an integration connection' })
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async refreshConnection(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<IntegrationConnectionResponse> {
    const refreshed = await this.integrations.refreshConnection(
      id,
      this.requireUserId(auth),
      this.requireOrganizationId(auth),
      auth,
    );
    return {
      ...refreshed,
      expiresAt: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
      createdAt: refreshed.createdAt.toISOString(),
      updatedAt: refreshed.updatedAt.toISOString(),
    };
  }

  @Delete('connections/:id')
  @ApiOperation({ summary: 'Disconnect an integration connection' })
  @ApiOkResponse({ description: 'Connection removed' })
  async disconnectConnection(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<void> {
    await this.integrations.disconnect(
      id,
      this.requireUserId(auth),
      this.requireOrganizationId(auth),
      auth,
    );
  }

  @Post('connections/:id/token')
  @ApiOperation({ summary: 'Issue a connection access token' })
  @ApiOkResponse({ type: ConnectionTokenResponseDto })
  async issueConnectionToken(
    @Param('id') id: string,
    @Headers('x-internal-token') internalToken?: string,
    @Headers('x-organization-id') organizationId?: string,
    @Headers('x-run-id') runId?: string,
    @CurrentAuth() auth?: AuthContext | null,
  ): Promise<ConnectionTokenResponseDto> {
    this.assertInternalAccess(internalToken);
    const normalizedOrganizationId = organizationId?.trim();
    if (!normalizedOrganizationId || auth?.organizationId !== normalizedOrganizationId) {
      throw new UnauthorizedException('Authoritative execution organization is required');
    }
    const normalizedRunId = runId?.trim();
    if (!normalizedRunId) {
      throw new NotFoundException('Connection or workflow run was not found');
    }

    const token = await this.integrations.getConnectionToken(
      id,
      normalizedOrganizationId,
      auth ?? null,
      normalizedRunId,
    );
    return {
      provider: token.provider,
      userId: token.userId,
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      scopes: token.scopes,
      expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    };
  }

  private assertInternalAccess(token?: string): void {
    const intCfg = this.configService.get<IntegrationsEnvConfig>('integrations')!;
    const expected = intCfg.internalServiceToken;
    if (!expected) {
      throw new UnauthorizedException('INTERNAL_SERVICE_TOKEN is not configured');
    }

    if (!token || !timingSafeCompare(token, expected)) {
      throw new UnauthorizedException('Invalid internal access token');
    }
  }

  private requireUserId(auth: AuthContext | null): string {
    const userId = auth?.userId?.trim();
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }
    return userId;
  }

  private requireOrganizationId(auth: AuthContext | null): string | null {
    const organizationId = auth?.organizationId?.trim();
    if (organizationId) {
      return organizationId;
    }
    const appConfig = this.configService.get<AppConfig>('app');
    if (appConfig?.trustProfile === 'trusted-local') {
      return null;
    }
    throw new UnauthorizedException('Active organization context is required');
  }
}
