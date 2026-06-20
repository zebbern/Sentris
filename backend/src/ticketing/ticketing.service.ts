import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { SecretEncryptionMaterial } from '@sentris/shared';
import type { TicketingConnectionConfig } from '@sentris/shared';
import type Redis from 'ioredis';

import { TICKETING_OAUTH_REDIS } from '../common/redis/redis.tokens';
import { TokenEncryptionService } from '../integrations/token.encryption';
import { TicketingRepository } from './ticketing.repository';
import { JiraAdapter, JiraApiError } from './jira/jira.adapter';
import { generateWebhookSecret, buildWebhookCallbackUrl } from './jira/webhook-secret';
import type { TicketingConnectionRecord } from '../database/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthConnectResponse {
  authorizationUrl: string;
  state: string;
}

export interface ConnectionStatus {
  id: string | null;
  provider: 'jira';
  isConnected: boolean;
  cloudId: string | null;
  config: TicketingConnectionConfig | null;
  createdAt: string | null;
}

// ---------------------------------------------------------------------------
// OAuth state cache (Redis-backed with local fallback, TTL 5 minutes)
// ---------------------------------------------------------------------------

interface OAuthStateCacheEntry {
  organizationId: string;
  userId: string;
  redirectUri: string;
  expiresAt: number;
}

const OAUTH_STATE_TTL_SECONDS = 5 * 60;
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const OAUTH_STATE_KEY_PREFIX = 'sentris:ticketing:oauth-state:';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TicketingService implements OnModuleDestroy {
  private readonly logger = new Logger(TicketingService.name);
  private readonly jiraClientId: string;
  private readonly jiraClientSecret: string;
  private readonly jiraCallbackUrl: string;
  private readonly oauthStateCache = new Map<string, OAuthStateCacheEntry>();
  private readonly refreshPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: TicketingRepository,
    private readonly jiraAdapter: JiraAdapter,
    private readonly encryption: TokenEncryptionService,
    configService: ConfigService,
    @Inject(TICKETING_OAUTH_REDIS) private readonly oauthStateRedis: Redis | null,
  ) {
    this.jiraClientId = configService.get<string>('JIRA_CLIENT_ID', '');
    this.jiraClientSecret = configService.get<string>('JIRA_CLIENT_SECRET', '');
    this.jiraCallbackUrl = configService.get<string>('JIRA_CALLBACK_URL', '');
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.oauthStateRedis?.quit();
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Connection status
  // ---------------------------------------------------------------------------

  async getConnection(organizationId: string): Promise<ConnectionStatus> {
    const conn = await this.repository.findConnectionByOrg(organizationId);
    if (!conn) {
      return {
        id: null,
        provider: 'jira',
        isConnected: false,
        cloudId: null,
        config: null,
        createdAt: null,
      };
    }
    return {
      id: conn.id,
      provider: 'jira',
      isConnected: true,
      cloudId: conn.cloudId,
      config: conn.config as TicketingConnectionConfig | null,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth 2.0 (3LO)
  // ---------------------------------------------------------------------------

  async startOAuthFlow(
    organizationId: string,
    userId: string,
    redirectUri: string,
  ): Promise<OAuthConnectResponse> {
    this.requireJiraConfig();
    const state = randomUUID();
    await this.storeOAuthState(state, {
      organizationId,
      userId,
      redirectUri,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    });

    const url = new URL('https://auth.atlassian.com/authorize');
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', this.jiraClientId);
    url.searchParams.set(
      'scope',
      'read:jira-work write:jira-work manage:jira-webhook offline_access',
    );
    url.searchParams.set('redirect_uri', this.jiraCallbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');

    return { authorizationUrl: url.toString(), state };
  }

  async handleOAuthCallback(code: string, state: string): Promise<{ success: boolean }> {
    this.requireJiraConfig();
    const cached = await this.consumeOAuthState(state);
    if (!cached) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    const { organizationId, userId } = cached;

    const tokenResponse = await this.exchangeCodeForTokens(code);
    const accessToken = tokenResponse.access_token;
    const refreshToken = tokenResponse.refresh_token ?? null;
    const expiresIn = tokenResponse.expires_in;

    const resources = await this.jiraAdapter.getAccessibleResources(accessToken);
    if (resources.length === 0) {
      throw new BadRequestException('No accessible Jira Cloud sites found');
    }
    const cloudId = resources[0].id;

    const encryptedAccess = await this.encryption.encrypt(accessToken);
    const encryptedRefresh = refreshToken ? await this.encryption.encrypt(refreshToken) : null;
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    const existing = await this.repository.findConnectionByOrg(organizationId);
    let connectionId: string;
    if (existing) {
      await this.repository.updateConnection(existing.id, {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
        cloudId,
      });
      connectionId = existing.id;
    } else {
      const created = await this.repository.createConnection({
        organizationId,
        provider: 'jira',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
        cloudId,
        config: {} as TicketingConnectionConfig,
        createdBy: userId,
      });
      connectionId = created.id;
    }

    // Register inbound webhook (best-effort — don't fail OAuth if this fails)
    const webhookSecret = generateWebhookSecret();
    await this.repository.updateConnection(connectionId, { webhookSecret });
    try {
      const appBaseUrl = new URL(this.jiraCallbackUrl).origin;
      const callbackUrl = buildWebhookCallbackUrl(appBaseUrl, webhookSecret);
      await this.jiraAdapter.registerWebhook(cloudId, accessToken, callbackUrl);
    } catch (err) {
      this.logger.warn(`Failed to register Jira webhook — manual setup may be required: ${err}`);
    }

    return { success: true };
  }

  async disconnect(organizationId: string): Promise<void> {
    await this.repository.deleteConnection(organizationId);
  }

  async updateConfig(
    organizationId: string,
    config: TicketingConnectionConfig,
  ): Promise<ConnectionStatus> {
    const conn = await this.requireConnection(organizationId);
    await this.repository.updateConnection(conn.id, { config });
    return this.getConnection(organizationId);
  }

  // ---------------------------------------------------------------------------
  // Jira API proxies
  // ---------------------------------------------------------------------------

  async listProjects(organizationId: string) {
    const { accessToken, cloudId } = await this.getDecryptedTokens(organizationId);
    const projects = await this.jiraAdapter.listProjects(cloudId, accessToken);
    return projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      avatarUrl: p.avatarUrls?.['48x48'] ?? null,
    }));
  }

  async listIssueTypes(organizationId: string, projectKey: string) {
    const { accessToken, cloudId } = await this.getDecryptedTokens(organizationId);
    const types = await this.jiraAdapter.listIssueTypes(cloudId, accessToken, projectKey);
    return types.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description ?? null,
      iconUrl: it.iconUrl ?? null,
    }));
  }

  async getTicketLink(findingTriageId: string) {
    return (await this.repository.findTicketLinkByTriageId(findingTriageId)) ?? null;
  }

  async createTicket(
    organizationId: string,
    findingTriageId: string,
    findingData: {
      findingOpensearchId: string;
      title: string;
      description: string;
      severity?: string;
    },
  ) {
    const conn = await this.requireConnection(organizationId);
    const config = conn.config as TicketingConnectionConfig;
    if (!config.projectKey || !config.issueTypeId) {
      throw new BadRequestException('Ticketing connection is not fully configured');
    }
    if (!conn.cloudId) {
      throw new BadRequestException('Jira cloud ID is not set');
    }
    const cloudId = conn.cloudId;
    const summary =
      `[${findingData.severity?.toUpperCase() ?? 'FINDING'}] ${findingData.title}`.slice(0, 255);
    const description = `Finding ID: ${findingData.findingOpensearchId}\nSeverity: ${findingData.severity ?? 'unknown'}\n\n${findingData.description}`;

    const { issue, siteUrl } = await this.withTokenRefresh(
      organizationId,
      conn,
      async (accessToken) => {
        const created = await this.jiraAdapter.createIssue(cloudId, accessToken, {
          projectKey: config.projectKey,
          issueTypeId: config.issueTypeId,
          summary,
          description,
        });
        const resources = await this.jiraAdapter.getAccessibleResources(accessToken);
        const url = resources.find((r) => r.id === cloudId)?.url ?? 'https://jira.atlassian.com';
        return { issue: created, siteUrl: url };
      },
    );

    const link = await this.repository.createTicketLink({
      findingTriageId,
      organizationId,
      provider: 'jira',
      externalId: issue.key,
      externalUrl: `${siteUrl}/browse/${issue.key}`,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      metadata: { jiraIssueId: issue.id },
    });
    this.logger.log(`Created Jira ticket ${issue.key} for finding triage ${findingTriageId}`);
    return link;
  }

  async updateTicketStatus(
    organizationId: string,
    findingTriageId: string,
    newStatus: string,
  ): Promise<void> {
    const conn = await this.requireConnection(organizationId);
    const link = await this.repository.findTicketLinkByTriageId(findingTriageId);
    if (!link) {
      this.logger.debug(`No ticket link for triage ${findingTriageId}`);
      return;
    }

    const statusMap: Record<string, string> =
      (conn.config as unknown as { statusMapping?: Record<string, string> })?.statusMapping ?? {};
    const transitionName = statusMap[newStatus];
    if (!transitionName) {
      this.logger.debug(`No Jira mapping for status '${newStatus}'`);
      return;
    }

    if (!conn.cloudId) {
      this.logger.debug(`No cloud ID for org ${organizationId}`);
      return;
    }
    const cloudId = conn.cloudId;

    const success = await this.withTokenRefresh(organizationId, conn, (accessToken) =>
      this.jiraAdapter.transitionIssue(cloudId, accessToken, link.externalId, transitionName),
    );

    await this.repository.updateTicketLink(
      link.id,
      success
        ? { syncStatus: 'synced', lastSyncedAt: new Date() }
        : {
            syncStatus: 'error',
            metadata: {
              ...(link.metadata as Record<string, unknown>),
              lastError: `Transition '${transitionName}' not available`,
            },
          },
    );
  }

  // ---------------------------------------------------------------------------
  // Token management (private)
  // ---------------------------------------------------------------------------

  private async getDecryptedTokens(organizationId: string) {
    const conn = await this.requireConnection(organizationId);
    if (!conn.cloudId) throw new BadRequestException('Jira cloud ID is not set');

    if (this.isTokenExpiringSoon(conn)) {
      await this.refreshAccessToken(organizationId, conn);
      const refreshed = await this.requireConnection(organizationId);
      return {
        accessToken: await this.encryption.decrypt(
          refreshed.accessToken as SecretEncryptionMaterial,
        ),
        cloudId: refreshed.cloudId!,
        connection: refreshed,
      };
    }
    return {
      accessToken: await this.encryption.decrypt(conn.accessToken as SecretEncryptionMaterial),
      cloudId: conn.cloudId,
      connection: conn,
    };
  }

  private isTokenExpiringSoon(conn: TicketingConnectionRecord): boolean {
    if (!conn.tokenExpiresAt) return false;
    return conn.tokenExpiresAt.getTime() - Date.now() < 60_000;
  }

  private async refreshAccessToken(
    organizationId: string,
    conn: TicketingConnectionRecord,
  ): Promise<void> {
    const existing = this.refreshPromises.get(organizationId);
    if (existing) return existing;

    const promise = this._doRefresh(organizationId, conn).finally(() =>
      this.refreshPromises.delete(organizationId),
    );
    this.refreshPromises.set(organizationId, promise);
    return promise;
  }

  private async _doRefresh(organizationId: string, conn: TicketingConnectionRecord): Promise<void> {
    if (!conn.refreshToken) {
      this.logger.warn(`No refresh token for org ${organizationId}`);
      return;
    }
    this.requireJiraConfig();
    const refreshToken = await this.encryption.decrypt(
      conn.refreshToken as SecretEncryptionMaterial,
    );
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.jiraClientId,
        client_secret: this.jiraClientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Jira token refresh failed: ${response.status} ${text}`);
      throw new Error('Failed to refresh Jira access token');
    }
    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const encryptedAccess = await this.encryption.encrypt(data.access_token);
    const encryptedRefresh = data.refresh_token
      ? await this.encryption.encrypt(data.refresh_token)
      : conn.refreshToken;
    const tokenExpiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : conn.tokenExpiresAt;
    await this.repository.updateConnection(conn.id, {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
    });
    this.logger.log(`Refreshed Jira token for org ${organizationId}`);
  }

  private async withTokenRefresh<T>(
    orgId: string,
    conn: TicketingConnectionRecord,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const { accessToken } = await this.getDecryptedTokens(orgId);
    try {
      return await fn(accessToken);
    } catch (error) {
      if (error instanceof JiraApiError && error.statusCode === 401 && conn.refreshToken) {
        this.logger.log(`Got 401, attempting token refresh for org ${orgId}`);
        await this.refreshAccessToken(orgId, conn);
        const { accessToken: newToken } = await this.getDecryptedTokens(orgId);
        return fn(newToken);
      }
      throw error;
    }
  }

  private async exchangeCodeForTokens(code: string) {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.jiraClientId,
        client_secret: this.jiraClientSecret,
        code,
        redirect_uri: this.jiraCallbackUrl,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Jira token exchange failed: ${response.status} ${text}`);
      throw new BadRequestException('Failed to exchange authorization code');
    }
    return response.json() as Promise<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    }>;
  }

  private async requireConnection(organizationId: string): Promise<TicketingConnectionRecord> {
    const conn = await this.repository.findConnectionByOrg(organizationId);
    if (!conn) throw new NotFoundException('No Jira connection found for this organization');
    return conn;
  }

  private requireJiraConfig(): void {
    if (!this.jiraClientId || !this.jiraClientSecret)
      throw new BadRequestException(
        'Jira OAuth not configured. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.',
      );
  }

  private cleanExpiredStates(): void {
    const now = Date.now();
    for (const [key, entry] of this.oauthStateCache) {
      if (entry.expiresAt < now) this.oauthStateCache.delete(key);
    }
  }

  private async storeOAuthState(state: string, entry: OAuthStateCacheEntry): Promise<void> {
    if (this.oauthStateRedis) {
      try {
        await this.oauthStateRedis.set(
          this.oauthStateKey(state),
          JSON.stringify(entry),
          'EX',
          OAUTH_STATE_TTL_SECONDS,
        );
        return;
      } catch (error) {
        this.logger.warn(`Failed to store Jira OAuth state in Redis: ${error}`);
      }
    }

    this.oauthStateCache.set(state, entry);
    this.cleanExpiredStates();
  }

  private async consumeOAuthState(state: string): Promise<OAuthStateCacheEntry | null> {
    if (this.oauthStateRedis) {
      try {
        const key = this.oauthStateKey(state);
        const raw = await this.oauthStateRedis.get(key);
        if (raw) {
          await this.oauthStateRedis.del(key);
          const parsed = JSON.parse(raw) as OAuthStateCacheEntry;
          if (parsed.expiresAt < Date.now()) return null;
          return parsed;
        }
      } catch (error) {
        this.logger.warn(`Failed to consume Jira OAuth state from Redis: ${error}`);
      }
    }

    const cached = this.oauthStateCache.get(state);
    if (!cached || cached.expiresAt < Date.now()) {
      this.oauthStateCache.delete(state);
      return null;
    }
    this.oauthStateCache.delete(state);
    return cached;
  }

  private oauthStateKey(state: string): string {
    return `${OAUTH_STATE_KEY_PREFIX}${state}`;
  }
}
