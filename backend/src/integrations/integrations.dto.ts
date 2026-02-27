import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StartOAuthSchema = z.object({
  userId: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).optional(),
});

export class StartOAuthDto extends createZodDto(StartOAuthSchema) {}

export const CompleteOAuthSchema = StartOAuthSchema.extend({
  state: z.string().min(1),
  code: z.string().min(1),
});

export class CompleteOAuthDto extends createZodDto(CompleteOAuthSchema) {}

export const RefreshConnectionSchema = z.object({
  userId: z.string().min(1),
});

export class RefreshConnectionDto extends createZodDto(RefreshConnectionSchema) {}

export const DisconnectConnectionSchema = z.object({
  userId: z.string().min(1),
});

export class DisconnectConnectionDto extends createZodDto(DisconnectConnectionSchema) {}

export const UpsertProviderConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
});

export class UpsertProviderConfigDto extends createZodDto(UpsertProviderConfigSchema) {}

export class ProviderConfigurationResponse {
  @ApiProperty()
  provider!: string;

  @ApiPropertyOptional({ description: 'Stored OAuth client identifier' })
  clientId?: string | null;

  @ApiProperty({ description: 'True when a client secret has been stored for this provider' })
  hasClientSecret!: boolean;

  @ApiProperty({
    enum: ['environment', 'user'],
    description: 'Origin of the credential configuration',
  })
  configuredBy!: 'environment' | 'user';

  @ApiPropertyOptional({ description: 'Last update timestamp in ISO 8601 format' })
  updatedAt?: string | null;
}

export class IntegrationProviderResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional()
  docsUrl?: string;

  @ApiProperty({ type: [String] })
  defaultScopes!: string[];

  @ApiProperty()
  supportsRefresh!: boolean;

  @ApiProperty({
    description: 'Indicates whether the provider has been configured with client credentials',
  })
  isConfigured!: boolean;
}

export class OAuthStartResponseDto {
  @ApiProperty()
  provider!: string;

  @ApiProperty()
  authorizationUrl!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty({ description: 'Suggested client-side TTL for the authorization URL', example: 300 })
  expiresIn!: number;
}

export class IntegrationConnectionResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  providerName!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty()
  tokenType!: string;

  @ApiPropertyOptional()
  expiresAt?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ enum: ['active', 'expired'] })
  status!: 'active' | 'expired';

  @ApiProperty()
  supportsRefresh!: boolean;

  @ApiProperty()
  hasRefreshToken!: boolean;

  @ApiPropertyOptional({ description: 'Provider-specific metadata saved alongside the connection' })
  metadata?: Record<string, unknown>;
}

export class ConnectionTokenResponseDto {
  @ApiProperty()
  provider!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  tokenType!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiPropertyOptional()
  expiresAt?: string | null;
}
