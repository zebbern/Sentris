import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretEncryptionMaterial } from '@sentris/shared';
import { randomBytes, createHash } from 'crypto';
import type Redis from 'ioredis';

import {
  IntegrationProviderConfig,
  IntegrationProviderSummary,
  generateState,
  loadIntegrationProviders,
  summarizeProvider,
} from './integration-providers';
import { IntegrationsRepository } from './integrations.repository';
import { TokenEncryptionService } from './token.encryption';
import { INTEGRATION_CACHE_REDIS } from './integrations.tokens';
import type { IntegrationTokenRecord } from '../database/schema';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';

export interface OAuthStartResponse {
  provider: string;
  authorizationUrl: string;
  state: string;
  expiresIn: number;
}

export interface IntegrationConnection {
  id: string;
  provider: string;
  providerName: string;
  userId: string;
  scopes: string[];
  tokenType: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'expired';
  supportsRefresh: boolean;
  hasRefreshToken: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderTokenResponse {
  provider: string;
  userId: string;
  accessToken: string;
  tokenType: string;
  scopes: string[];
  expiresAt: Date | null;
}

type ResolvedProviderConfig = IntegrationProviderConfig & {
  clientId: string;
  clientSecret: string;
};

const TOKEN_REFRESH_BUFFER_MS = 60_000; // proactively refresh 1 minute before expiry

/** Polling interval for version-counter based cache invalidation */
const VERSION_POLL_INTERVAL_MS = 30_000; // 30 seconds

/** Redis key for the monotonic version counter */
const PROVIDER_OVERRIDES_VERSION_KEY = 'sentris:provider-overrides:version';

const NOOP_AUDIT_LOG_SERVICE = {
  recordDurable: async () => undefined,
  recordDurableWithExecutor: async () => undefined,
} as unknown as AuditLogService;

interface TokenRequestOptions {
  grantType: 'authorization_code' | 'refresh_token';
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
  codeVerifier?: string | null;
  scopes?: string[];
  additionalParams?: Record<string, string>;
}

interface ProviderCredentialOverride {
  organizationId: string | null;
  provider: string;
  clientId: string;
  clientSecret: SecretEncryptionMaterial;
  updatedAt: Date;
}

@Injectable()
export class IntegrationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly providers: Record<string, IntegrationProviderConfig>;
  private providerOverrides = new Map<string, ProviderCredentialOverride>();

  /** Locally-tracked version of the provider overrides cache */
  private cachedVersion = 0;
  /** Interval handle for polling the version counter */
  private versionCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: IntegrationsRepository,
    private readonly encryption: TokenEncryptionService,
    private readonly configService: ConfigService,
    @Inject(INTEGRATION_CACHE_REDIS) private readonly redis: Redis | null,
    @Optional()
    private readonly auditLogService: AuditLogService = NOOP_AUDIT_LOG_SERVICE,
  ) {
    const intConfig = this.configService.get('integrations')!;
    this.providers = loadIntegrationProviders(intConfig);
  }

  async onModuleInit(): Promise<void> {
    await this.reloadProviderOverrides();
    await this.syncVersionFromRedis();

    // Start version-counter polling for cross-instance invalidation
    this.versionCheckInterval = setInterval(
      () => this.checkVersionAndReload(),
      VERSION_POLL_INTERVAL_MS,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.versionCheckInterval) {
      clearInterval(this.versionCheckInterval);
      this.versionCheckInterval = null;
    }
    try {
      await this.redis?.quit();
    } catch {
      // ignore — shutting down
    }
  }

  /**
   * Read the current version counter from Redis and sync local state.
   * Called once at startup so the instance knows the baseline version.
   */
  private async syncVersionFromRedis(): Promise<void> {
    if (!this.redis) return;
    try {
      const version = Number(await this.redis.get(PROVIDER_OVERRIDES_VERSION_KEY)) || 0;
      this.cachedVersion = version;
    } catch (error) {
      this.logger.warn(`Failed to read provider-overrides version from Redis: ${error}`);
    }
  }

  /**
   * Poll Redis for version changes. If the remote version exceeds the local
   * version, reload providerOverrides from the database.
   */
  private async checkVersionAndReload(): Promise<void> {
    if (!this.redis) return;
    try {
      const version = Number(await this.redis.get(PROVIDER_OVERRIDES_VERSION_KEY)) || 0;
      if (version > this.cachedVersion) {
        this.logger.log(
          `Provider overrides version changed (${this.cachedVersion} → ${version}), reloading from DB`,
        );
        await this.reloadProviderOverrides();
        this.cachedVersion = version;
      }
    } catch (error) {
      this.logger.warn(`Failed to check provider-overrides version: ${error}`);
    }
  }

  /**
   * Increment the version counter in Redis. Called after any mutation
   * to providerOverrides so other instances pick up the change.
   */
  private async incrementVersion(): Promise<void> {
    if (!this.redis) return;
    try {
      const newVersion = await this.redis.incr(PROVIDER_OVERRIDES_VERSION_KEY);
      this.cachedVersion = newVersion;
    } catch (error) {
      this.logger.warn(`Failed to increment provider-overrides version: ${error}`);
    }
  }

  listProviders(organizationId: string | null = null): IntegrationProviderSummary[] {
    return Object.values(this.providers).map((config) =>
      summarizeProvider(this.mergeProviderConfig(config, organizationId)),
    );
  }

  private async reloadProviderOverrides(): Promise<void> {
    const records = await this.repository.listProviderConfigs();
    this.providerOverrides = new Map(
      records.map((record) => [
        this.providerOverrideKey(record.organizationId, record.provider),
        {
          organizationId: record.organizationId,
          provider: record.provider,
          clientId: record.clientId,
          clientSecret: record.clientSecret as SecretEncryptionMaterial,
          updatedAt: new Date(record.updatedAt),
        },
      ]),
    );
  }

  private mergeProviderConfig(
    config: IntegrationProviderConfig,
    organizationId: string | null,
  ): IntegrationProviderConfig {
    const override = this.providerOverrides.get(
      this.providerOverrideKey(organizationId, config.id),
    );
    if (!override) {
      return config;
    }

    return {
      ...config,
      clientId: override.clientId,
      clientSecret: 'configured',
    };
  }

  async getProviderConfiguration(
    providerId: string,
    organizationId: string | null = null,
  ): Promise<{
    provider: string;
    clientId: string | null;
    hasClientSecret: boolean;
    configuredBy: 'environment' | 'user';
    updatedAt: Date | null;
  }> {
    const base = this.requireProvider(providerId);
    const override = this.providerOverrides.get(
      this.providerOverrideKey(organizationId, providerId),
    );

    if (override) {
      return {
        provider: providerId,
        clientId: override.clientId,
        hasClientSecret: true,
        configuredBy: 'user',
        updatedAt: override.updatedAt,
      };
    }

    const envClientId = base.clientId ?? null;
    const envClientSecret = base.clientSecret ?? null;
    const configuredBy = envClientId && envClientSecret ? 'environment' : 'user';

    return {
      provider: providerId,
      clientId: envClientId,
      hasClientSecret: Boolean(envClientSecret),
      configuredBy,
      updatedAt: null,
    };
  }

  async upsertProviderConfiguration(
    providerId: string,
    input: {
      clientId: string;
      clientSecret?: string;
    },
    organizationId: string | null = null,
    auth: AuthContext | null = null,
  ): Promise<void> {
    this.requireProvider(providerId);

    const trimmedClientId = input.clientId.trim();
    if (!trimmedClientId) {
      throw new BadRequestException('clientId is required');
    }

    const override = this.providerOverrides.get(
      this.providerOverrideKey(organizationId, providerId),
    );
    const providedSecret = input.clientSecret?.trim();

    let secretMaterial: SecretEncryptionMaterial | null = null;
    if (providedSecret && providedSecret.length > 0) {
      secretMaterial = await this.encryption.encrypt(providedSecret);
    } else if (override) {
      secretMaterial = override.clientSecret;
    }

    if (!secretMaterial) {
      throw new BadRequestException('clientSecret is required');
    }

    const record = await this.repository.upsertProviderConfig(
      {
        organizationId,
        provider: providerId,
        clientId: trimmedClientId,
        clientSecret: secretMaterial,
      },
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          auth,
          {
            action: 'integration.provider_config.upsert',
            resourceType: 'integration',
            resourceId: providerId,
            metadata: { phase: 'completed' },
          },
          undefined,
          organizationId,
        ),
    );

    this.providerOverrides.set(this.providerOverrideKey(organizationId, providerId), {
      organizationId,
      provider: record.provider,
      clientId: record.clientId,
      clientSecret: record.clientSecret as SecretEncryptionMaterial,
      updatedAt: new Date(record.updatedAt),
    });

    await this.incrementVersion();
  }

  async deleteProviderConfiguration(
    providerId: string,
    organizationId: string | null = null,
    auth: AuthContext | null = null,
  ): Promise<void> {
    this.requireProvider(providerId);

    await this.repository.deleteProviderConfig(organizationId, providerId, (executor) =>
      this.auditLogService.recordDurableWithExecutor(
        executor,
        auth,
        {
          action: 'integration.provider_config.delete',
          resourceType: 'integration',
          resourceId: providerId,
          metadata: { phase: 'completed' },
        },
        undefined,
        organizationId,
      ),
    );
    this.providerOverrides.delete(this.providerOverrideKey(organizationId, providerId));

    await this.incrementVersion();
  }

  async listConnections(
    userId: string,
    organizationId: string | null = null,
  ): Promise<IntegrationConnection[]> {
    const records = await this.repository.listConnections(userId, organizationId);
    return records.map((record) => this.toConnection(record));
  }

  async startOAuthSession(
    providerId: string,
    input: {
      organizationId?: string | null;
      userId: string;
      redirectUri: string;
      scopes?: string[];
      auth?: AuthContext | null;
    },
  ): Promise<OAuthStartResponse> {
    const organizationId = input.organizationId ?? null;
    const provider = await this.resolveProviderForAuth(providerId, organizationId);

    const state = generateState();
    const scopes = this.normalizeScopes(input.scopes, provider);

    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', scopes.join(provider.scopeSeparator));
    url.searchParams.set('state', state);

    let codeVerifier: string | undefined;
    if (provider.usesPkce) {
      codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    if (provider.extraAuthorizeParams) {
      for (const [key, value] of Object.entries(provider.extraAuthorizeParams)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    await this.repository.createOAuthState(
      {
        state,
        organizationId,
        userId: input.userId,
        provider: providerId,
        codeVerifier,
      },
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          input.auth ?? null,
          {
            action: 'integration.oauth.start',
            resourceType: 'integration',
            resourceId: providerId,
            metadata: { phase: 'requested' },
          },
          undefined,
          organizationId,
        ),
    );

    // OAuth states are short-lived (5 minutes) but we rely on DB TTL/cleanup.
    return {
      provider: providerId,
      authorizationUrl: url.toString(),
      state,
      expiresIn: 300,
    };
  }

  async completeOAuthSession(
    providerId: string,
    input: {
      organizationId?: string | null;
      userId: string;
      state: string;
      code: string;
      redirectUri: string;
      scopes?: string[];
      auth?: AuthContext | null;
    },
  ): Promise<IntegrationConnection> {
    const organizationId = input.organizationId ?? null;
    const provider = await this.resolveProviderForAuth(providerId, organizationId);
    const stateRecord = await this.repository.consumeOAuthState(
      input.state,
      input.userId,
      providerId,
      organizationId,
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          input.auth ?? null,
          {
            action: 'integration.oauth.exchange',
            resourceType: 'integration',
            resourceId: providerId,
            metadata: { phase: 'requested' },
          },
          undefined,
          organizationId,
        ),
    );

    if (
      !stateRecord ||
      stateRecord.userId !== input.userId ||
      stateRecord.organizationId !== organizationId
    ) {
      throw new NotFoundException('OAuth state was not found');
    }
    if (stateRecord.provider !== providerId) {
      throw new BadRequestException('OAuth state does not match the provider');
    }

    const scopes = this.normalizeScopes(input.scopes, provider);

    const rawResponse = await this.requestTokens(provider, {
      grantType: 'authorization_code',
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: stateRecord.codeVerifier,
      scopes,
    });

    const persisted = await this.persistTokenResponse({
      organizationId,
      userId: input.userId,
      provider,
      scopes,
      rawResponse,
      previous: await this.repository.findByProvider(input.userId, providerId, organizationId),
      auth: input.auth ?? null,
    });

    return this.toConnection(persisted);
  }

  async refreshConnection(
    id: string,
    userId: string,
    organizationId: string | null = null,
    auth: AuthContext | null = null,
  ): Promise<IntegrationConnection> {
    const record = await this.repository.findById(id, organizationId);
    if (!record || record.userId !== userId) {
      throw new NotFoundException('Connection was not found');
    }

    const refreshed = await this.refreshTokenRecord(record, auth);
    return this.toConnection(refreshed);
  }

  async disconnect(
    id: string,
    userId: string,
    organizationId: string | null = null,
    auth: AuthContext | null = null,
  ): Promise<void> {
    const deleted = await this.repository.deleteConnection(
      id,
      userId,
      organizationId,
      (executor, record) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          auth,
          {
            action: 'integration.oauth.disconnect',
            resourceType: 'integration',
            resourceId: record.id,
            metadata: { provider: record.provider, phase: 'completed' },
          },
          undefined,
          organizationId,
        ),
    );
    if (!deleted) {
      throw new NotFoundException('Connection was not found');
    }
  }

  async getProviderToken(
    providerId: string,
    userId: string,
    organizationId: string | null = null,
    auth: AuthContext | null = null,
  ): Promise<ProviderTokenResponse> {
    const record = await this.repository.findByProvider(userId, providerId, organizationId);
    if (!record) {
      throw new NotFoundException(`No credentials found for provider ${providerId}`);
    }

    await this.auditLogService.recordDurable(
      auth,
      {
        action: 'integration.token.issue',
        resourceType: 'integration',
        resourceId: record.id,
        metadata: {
          provider: providerId,
          selection: 'provider',
          phase: 'requested',
        },
      },
      undefined,
      organizationId,
    );

    const provider = this.requireProvider(providerId);
    const hydratedRecord = await this.ensureFreshToken(record, provider, auth);

    const accessToken = await this.encryption.decrypt(
      hydratedRecord.accessToken as SecretEncryptionMaterial,
    );

    return {
      provider: providerId,
      userId,
      accessToken,
      tokenType: hydratedRecord.tokenType ?? 'Bearer',
      scopes: hydratedRecord.scopes ?? [],
      expiresAt: this.parseDate(hydratedRecord.expiresAt),
    };
  }

  async getConnectionToken(
    connectionId: string,
    organizationId: string | null = null,
    auth: AuthContext | null = null,
    runId?: string,
  ): Promise<ProviderTokenResponse> {
    const normalizedRunId = runId?.trim();
    if (!normalizedRunId) {
      throw new NotFoundException('Connection or workflow run was not found');
    }

    const [record, runBelongsToOrganization] = await Promise.all([
      this.repository.findById(connectionId, organizationId),
      this.repository.runBelongsToOrganization(normalizedRunId, organizationId),
    ]);
    if (!record || !runBelongsToOrganization) {
      throw new NotFoundException('Connection or workflow run was not found');
    }

    await this.auditLogService.recordDurable(
      auth,
      {
        action: 'integration.token.issue',
        resourceType: 'integration',
        resourceId: connectionId,
        metadata: {
          provider: record.provider,
          runId: normalizedRunId,
          phase: 'requested',
        },
      },
      undefined,
      organizationId,
    );

    const provider = this.requireProvider(record.provider);
    const hydratedRecord = await this.ensureFreshToken(record, provider, auth);

    const accessToken = await this.encryption.decrypt(
      hydratedRecord.accessToken as SecretEncryptionMaterial,
    );

    return {
      provider: record.provider,
      userId: hydratedRecord.userId,
      accessToken,
      tokenType: hydratedRecord.tokenType ?? 'Bearer',
      scopes: hydratedRecord.scopes ?? [],
      expiresAt: this.parseDate(hydratedRecord.expiresAt),
    };
  }

  private cleanScopes(scopes: string[]): string[] {
    return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean))).sort();
  }

  private parseScopeString(scope: string, separator: string): string[] {
    if (separator === ' ') {
      return this.cleanScopes(scope.split(/\s+/));
    }
    return this.cleanScopes(scope.split(separator));
  }

  private normalizeScopes(
    scopes: string[] | undefined,
    provider: IntegrationProviderConfig,
  ): string[] {
    const source = scopes && scopes.length > 0 ? scopes : provider.defaultScopes;
    return this.cleanScopes(source);
  }

  private async resolveProviderForAuth(
    providerId: string,
    organizationId: string | null,
  ): Promise<ResolvedProviderConfig> {
    const base = this.requireProvider(providerId);
    const override = this.providerOverrides.get(
      this.providerOverrideKey(organizationId, providerId),
    );

    const clientId = (override?.clientId ?? base.clientId ?? '').trim();
    const decryptedSecret = override
      ? await this.encryption.decrypt(override.clientSecret)
      : (base.clientSecret ?? '');
    const clientSecret = decryptedSecret.trim();

    if (!clientId || !clientSecret) {
      throw new BadRequestException(`Provider ${providerId} is not configured for OAuth`);
    }

    return {
      ...base,
      clientId,
      clientSecret,
    };
  }

  private requireProvider(providerId: string): IntegrationProviderConfig {
    const provider = this.providers[providerId];
    if (!provider) {
      throw new NotFoundException(`Unknown provider '${providerId}'`);
    }
    return provider;
  }

  private toConnection(record: IntegrationTokenRecord): IntegrationConnection {
    const provider = this.requireProvider(record.provider);
    const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
    const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;

    return {
      id: record.id,
      provider: record.provider,
      providerName: provider.name,
      userId: record.userId,
      scopes: record.scopes ?? [],
      tokenType: record.tokenType ?? 'Bearer',
      expiresAt,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      status: isExpired ? 'expired' : 'active',
      supportsRefresh: provider.supportsRefresh,
      hasRefreshToken: Boolean(record.refreshToken),
      metadata: this.coerceMetadata(record.metadata),
    };
  }

  private coerceMetadata(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }
    return metadata as Record<string, unknown>;
  }

  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private async requestTokens(
    provider: IntegrationProviderConfig,
    options: TokenRequestOptions,
  ): Promise<Record<string, any>> {
    if (!provider.clientId || !provider.clientSecret) {
      throw new BadRequestException(`Provider ${provider.id} is not configured for OAuth`);
    }

    const params: Record<string, string> = {
      grant_type: options.grantType,
      ...(provider.extraTokenParams ?? {}),
      ...(options.additionalParams ?? {}),
    };

    if (options.code) {
      params.code = options.code;
    }
    if (options.redirectUri) {
      params.redirect_uri = options.redirectUri;
    }
    if (options.refreshToken) {
      params.refresh_token = options.refreshToken;
    }
    if (options.codeVerifier) {
      params.code_verifier = options.codeVerifier;
    }
    if (options.scopes && options.scopes.length > 0) {
      params.scope = options.scopes.join(provider.scopeSeparator);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const bodyParams = { ...params };

    if (provider.tokenAuthMethod === 'client_secret_post') {
      bodyParams.client_id = provider.clientId;
      bodyParams.client_secret = provider.clientSecret;
    } else if (provider.tokenAuthMethod === 'client_secret_basic') {
      headers.Authorization = `Basic ${Buffer.from(
        `${provider.clientId}:${provider.clientSecret}`,
      ).toString('base64')}`;
      bodyParams.client_id = provider.clientId;
    }

    let response: Response;
    try {
      if (provider.tokenRequestEncoding === 'json') {
        headers['Content-Type'] = 'application/json';
        response = await fetch(provider.tokenUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyParams),
        });
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        response = await fetch(provider.tokenUrl, {
          method: 'POST',
          headers,
          body: new URLSearchParams(bodyParams).toString(),
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Token request to ${provider.id} failed: ${message}`);
      throw new BadRequestException(`Failed to contact ${provider.name} token endpoint`);
    }

    const rawPayload = await response.text();

    let payload: Record<string, any> = {};
    try {
      payload = rawPayload ? JSON.parse(rawPayload) : {};
    } catch {
      payload = Object.fromEntries(new URLSearchParams(rawPayload));
    }

    if (!response.ok) {
      const message =
        payload.error_description ??
        payload.error ??
        `${provider.name} token exchange failed with ${response.status}`;
      throw new BadRequestException(message);
    }

    return payload;
  }

  private async persistTokenResponse(input: {
    organizationId: string | null;
    userId: string;
    provider: IntegrationProviderConfig;
    scopes: string[];
    rawResponse: Record<string, any>;
    previous?: IntegrationTokenRecord | undefined;
    auth: AuthContext | null;
  }): Promise<IntegrationTokenRecord> {
    const accessToken = this.extractToken(input.rawResponse.access_token, 'access_token');
    const refreshToken = this.extractOptionalToken(input.rawResponse.refresh_token);
    const tokenType =
      typeof input.rawResponse.token_type === 'string'
        ? input.rawResponse.token_type
        : (input.previous?.tokenType ?? 'Bearer');

    const expiresAt = this.resolveExpiry(input.rawResponse.expires_in, input.previous?.expiresAt);
    const grantedScopes = this.resolveScopes(
      input.rawResponse.scope,
      input.scopes,
      input.provider.scopeSeparator,
    );

    const accessMaterial = await this.encryption.encrypt(accessToken);
    const refreshMaterial = refreshToken ? await this.encryption.encrypt(refreshToken) : null;

    const metadata = this.mergeMetadata(input.previous?.metadata, {
      providerPayload: this.safeProviderPayload(input.rawResponse),
      lastTokenSync: new Date().toISOString(),
      lastGrantType: 'authorization_code',
    });

    return this.repository.upsertConnection(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: input.provider.id,
        scopes: grantedScopes,
        accessToken: accessMaterial,
        refreshToken: refreshMaterial,
        tokenType,
        expiresAt,
        metadata,
      },
      (executor, record) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          input.auth,
          {
            action: 'integration.oauth.connected',
            resourceType: 'integration',
            resourceId: record.id,
            metadata: { provider: record.provider, phase: 'completed' },
          },
          undefined,
          input.organizationId,
        ),
    );
  }

  private async refreshTokenRecord(
    record: IntegrationTokenRecord,
    auth: AuthContext | null,
  ): Promise<IntegrationTokenRecord> {
    const provider = await this.resolveProviderForAuth(record.provider, record.organizationId);

    if (!provider.supportsRefresh) {
      throw new BadRequestException(`${provider.name} tokens cannot be refreshed`);
    }
    if (!record.refreshToken) {
      throw new BadRequestException(`No refresh token stored for ${provider.name}`);
    }

    const refreshToken = await this.encryption.decrypt(
      record.refreshToken as SecretEncryptionMaterial,
    );

    await this.auditLogService.recordDurable(
      auth,
      {
        action: 'integration.oauth.refresh',
        resourceType: 'integration',
        resourceId: record.id,
        metadata: { provider: record.provider, phase: 'requested' },
      },
      undefined,
      record.organizationId,
    );

    const payload = await this.requestTokens(provider, {
      grantType: 'refresh_token',
      refreshToken,
      scopes: record.scopes ?? provider.defaultScopes,
    });

    const nextRefreshToken = this.extractOptionalToken(payload.refresh_token) ?? refreshToken;

    const accessToken = this.extractToken(payload.access_token, 'access_token');
    const tokenType =
      typeof payload.token_type === 'string' ? payload.token_type : (record.tokenType ?? 'Bearer');
    const expiresAt = this.resolveExpiry(payload.expires_in, record.expiresAt);

    const grantedScopes = this.resolveScopes(
      payload.scope,
      record.scopes ?? provider.defaultScopes,
      provider.scopeSeparator,
    );

    const accessMaterial = await this.encryption.encrypt(accessToken);
    const refreshMaterial = nextRefreshToken
      ? await this.encryption.encrypt(nextRefreshToken)
      : null;

    const metadata = this.mergeMetadata(record.metadata, {
      providerPayload: this.safeProviderPayload(payload),
      lastTokenSync: new Date().toISOString(),
      lastGrantType: 'refresh_token',
    });

    return this.repository.upsertConnection(
      {
        organizationId: record.organizationId,
        userId: record.userId,
        provider: record.provider,
        scopes: grantedScopes,
        accessToken: accessMaterial,
        refreshToken: refreshMaterial,
        tokenType,
        expiresAt,
        metadata,
      },
      (executor, refreshed) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          auth,
          {
            action: 'integration.oauth.refresh',
            resourceType: 'integration',
            resourceId: refreshed.id,
            metadata: { provider: refreshed.provider, phase: 'completed' },
          },
          undefined,
          record.organizationId,
        ),
    );
  }

  private extractToken(value: unknown, field: string): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    throw new BadRequestException(`OAuth provider did not return a valid ${field}`);
  }

  private extractOptionalToken(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    return null;
  }

  private resolveExpiry(expiresIn: unknown, fallback?: Date | string | null): Date | null {
    const parsed =
      typeof expiresIn === 'number'
        ? expiresIn
        : typeof expiresIn === 'string'
          ? Number(expiresIn)
          : null;

    if (parsed && Number.isFinite(parsed)) {
      return new Date(Date.now() + parsed * 1000);
    }

    if (!fallback) {
      return null;
    }

    return new Date(fallback);
  }

  private resolveScopes(scopeValue: unknown, defaults: string[], separator: string): string[] {
    if (typeof scopeValue !== 'string' || scopeValue.trim().length === 0) {
      return this.cleanScopes(defaults);
    }

    return this.parseScopeString(scopeValue, separator);
  }

  private mergeMetadata(
    existing: unknown,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...this.coerceMetadata(existing),
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    };
  }

  private safeProviderPayload(payload: Record<string, any>): Record<string, unknown> {
    const { access_token, refresh_token, id_token, ...rest } = payload;
    return rest;
  }

  private async ensureFreshToken(
    record: IntegrationTokenRecord,
    provider: IntegrationProviderConfig,
    auth: AuthContext | null,
  ): Promise<IntegrationTokenRecord> {
    if (this.shouldRefreshToken(record, provider)) {
      return this.refreshTokenRecord(record, auth);
    }
    return record;
  }

  private shouldRefreshToken(
    record: IntegrationTokenRecord,
    provider: IntegrationProviderConfig,
  ): boolean {
    if (!provider.supportsRefresh || !record.refreshToken) {
      return false;
    }

    const expiresAt = this.parseDate(record.expiresAt);
    if (!expiresAt) {
      return false;
    }

    return expiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;
  }

  private parseDate(value: Date | string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp);
  }

  private providerOverrideKey(organizationId: string | null, providerId: string): string {
    return `${organizationId ?? '<trusted-local>'}\u0000${providerId}`;
  }
}
