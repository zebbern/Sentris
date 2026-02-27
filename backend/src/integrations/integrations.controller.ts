import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  CompleteOAuthDto,
  CompleteOAuthSchema,
  DisconnectConnectionDto,
  DisconnectConnectionSchema,
  ConnectionTokenResponseDto,
  IntegrationConnectionResponse,
  IntegrationProviderResponse,
  ProviderConfigurationResponse,
  OAuthStartResponseDto,
  RefreshConnectionDto,
  RefreshConnectionSchema,
  StartOAuthDto,
  StartOAuthSchema,
  UpsertProviderConfigDto,
  UpsertProviderConfigSchema,
} from './integrations.dto';
import { IntegrationsService } from './integrations.service';
import type { IntegrationsEnvConfig } from '../config';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly configService: ConfigService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'List all integration providers' })
  @ApiOkResponse({ type: [IntegrationProviderResponse] })
  listProviders(): IntegrationProviderResponse[] {
    return this.integrations.listProviders().map((provider) => ({
      ...provider,
    }));
  }

  @Get('providers/:provider/config')
  @ApiOperation({ summary: 'Get provider OAuth configuration' })
  @ApiOkResponse({ type: ProviderConfigurationResponse })
  async getProviderConfiguration(
    @Param('provider') provider: string,
  ): Promise<ProviderConfigurationResponse> {
    const configuration = await this.integrations.getProviderConfiguration(provider);
    return {
      provider: configuration.provider,
      clientId: configuration.clientId,
      hasClientSecret: configuration.hasClientSecret,
      configuredBy: configuration.configuredBy,
      updatedAt: configuration.updatedAt ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Put('providers/:provider/config')
  @ApiOperation({ summary: 'Create or update provider OAuth configuration' })
  @ApiOkResponse({ type: ProviderConfigurationResponse })
  async upsertProviderConfiguration(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(UpsertProviderConfigSchema)) body: UpsertProviderConfigDto,
  ): Promise<ProviderConfigurationResponse> {
    await this.integrations.upsertProviderConfiguration(provider, {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });

    const configuration = await this.integrations.getProviderConfiguration(provider);
    return {
      provider: configuration.provider,
      clientId: configuration.clientId,
      hasClientSecret: configuration.hasClientSecret,
      configuredBy: configuration.configuredBy,
      updatedAt: configuration.updatedAt ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Delete('providers/:provider/config')
  @ApiOperation({ summary: 'Delete provider OAuth configuration' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Provider configuration deleted' })
  async deleteProviderConfiguration(@Param('provider') provider: string): Promise<void> {
    await this.integrations.deleteProviderConfiguration(provider);
  }

  @Get('connections')
  @ApiOperation({ summary: 'List integration connections' })
  @ApiOkResponse({ type: [IntegrationConnectionResponse] })
  async listConnections(
    @Query('userId') userId?: string,
  ): Promise<IntegrationConnectionResponse[]> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const connections = await this.integrations.listConnections(userId);
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
    @Body(new ZodValidationPipe(StartOAuthSchema)) body: StartOAuthDto,
  ): Promise<OAuthStartResponseDto> {
    const response = await this.integrations.startOAuthSession(provider, {
      userId: body.userId,
      redirectUri: body.redirectUri,
      scopes: body.scopes,
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
    @Body(new ZodValidationPipe(CompleteOAuthSchema)) body: CompleteOAuthDto,
  ): Promise<IntegrationConnectionResponse> {
    const connection = await this.integrations.completeOAuthSession(provider, {
      userId: body.userId,
      code: body.code,
      state: body.state,
      redirectUri: body.redirectUri,
      scopes: body.scopes,
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
    @Body(new ZodValidationPipe(RefreshConnectionSchema)) body: RefreshConnectionDto,
  ): Promise<IntegrationConnectionResponse> {
    const refreshed = await this.integrations.refreshConnection(id, body.userId);
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
    @Body(new ZodValidationPipe(DisconnectConnectionSchema)) body: DisconnectConnectionDto,
  ): Promise<void> {
    await this.integrations.disconnect(id, body.userId);
  }

  @Post('connections/:id/token')
  @ApiOperation({ summary: 'Issue a connection access token' })
  @ApiOkResponse({ type: ConnectionTokenResponseDto })
  async issueConnectionToken(
    @Param('id') id: string,
    @Headers('x-internal-token') internalToken?: string,
  ): Promise<ConnectionTokenResponseDto> {
    this.assertInternalAccess(internalToken);

    const token = await this.integrations.getConnectionToken(id);
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
      return;
    }

    if (token !== expected) {
      throw new UnauthorizedException('Invalid internal access token');
    }
  }
}
