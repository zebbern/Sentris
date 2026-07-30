import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  normalizeJiraStatusMappingEntry,
  TicketingConnectionConfigSchema,
  type SecretEncryptionMaterial,
  type TicketingConnectionConfig,
} from '@sentris/shared';
import type Redis from 'ioredis';

import { TICKETING_OAUTH_REDIS } from '../common/redis/redis.tokens';
import { TokenEncryptionService } from '../integrations/token.encryption';
import {
  type JiraWebhookRegistrationRequestedEvent,
  TicketingRepository,
  TicketReconciliationEventUnavailableError,
} from './ticketing.repository';
import { JiraAdapter, JiraApiError } from './jira/jira.adapter';
import { generateWebhookSecret, buildWebhookCallbackUrl } from './jira/webhook-secret';
import type { TicketingConnectionRecord, TicketLinkRecord } from '../database/schema';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';

const MAX_WEBHOOK_CLEANUPS_PER_REGISTRATION = 25;

export class TicketCreationAmbiguousError extends Error {
  constructor(message = 'Ticket creation outcome is unknown; manual reconciliation is required') {
    super(message);
    this.name = 'TicketCreationAmbiguousError';
  }
}

export class TicketTransitionUnavailableError extends Error {
  constructor(issueKey: string, transitionName: string) {
    super(`Transition '${transitionName}' not available for Jira issue ${issueKey}`);
    this.name = 'TicketTransitionUnavailableError';
  }
}

class JiraRetryPreparationError extends Error {
  constructor(readonly preparationCause: unknown) {
    super(
      preparationCause instanceof Error
        ? preparationCause.message
        : `Jira retry preparation failed: ${String(preparationCause)}`,
    );
    this.name = 'JiraRetryPreparationError';
  }
}

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
  webhookRegistration: {
    status: 'unregistered' | 'pending' | 'registered' | 'dead';
    version: number;
    lastError: string | null;
  } | null;
}

export type ReconcileTicketCreationInput =
  | {
      action: 'attach';
      issueKey: string;
    }
  | {
      action: 'clear_and_retry';
      confirmedNoIssueExists: true;
    };

export type ReconcileTicketCreationResult =
  | {
      action: 'attach';
      status: 'attached';
      findingTriageId: string;
      ticket: TicketLinkRecord;
    }
  | {
      action: 'clear_and_retry';
      status: 'retry_queued';
      findingTriageId: string;
      ticket: null;
    };

interface TicketCreationPayload {
  findingOpensearchId: string;
  title: string;
  description: string;
  severity?: string;
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
    private readonly auditLogService: AuditLogService,
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
        webhookRegistration: null,
      };
    }
    const config = TicketingConnectionConfigSchema.safeParse(conn.config);
    const registrationVersion = Number.isSafeInteger(conn.webhookRegistrationVersion)
      ? conn.webhookRegistrationVersion
      : 0;
    const storedRegistrationStatus =
      conn.webhookRegistrationStatus === 'pending' ||
      conn.webhookRegistrationStatus === 'registered'
        ? conn.webhookRegistrationStatus
        : 'unregistered';
    const delivery =
      storedRegistrationStatus === 'pending'
        ? await this.repository.findWebhookRegistrationDelivery(conn.id, registrationVersion)
        : undefined;
    return {
      id: conn.id,
      provider: 'jira',
      isConnected: true,
      cloudId: conn.cloudId,
      config: config.success ? config.data : null,
      createdAt: conn.createdAt.toISOString(),
      webhookRegistration: {
        status: delivery?.status === 'dead' ? 'dead' : storedRegistrationStatus,
        version: registrationVersion,
        lastError: delivery?.status === 'dead' ? delivery.lastError : null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth 2.0 (3LO)
  // ---------------------------------------------------------------------------

  async startOAuthFlow(
    organizationId: string,
    userId: string,
    redirectUri: string,
    auth: AuthContext | null = null,
  ): Promise<OAuthConnectResponse> {
    const configuredCallbackUrl = this.requireJiraConfig();
    const requestedCallbackUrl = this.normalizeOAuthCallbackUrl(redirectUri, 'OAuth redirect URI');
    if (requestedCallbackUrl !== configuredCallbackUrl) {
      throw new BadRequestException('OAuth redirect URI does not match JIRA_CALLBACK_URL');
    }

    const state = randomUUID();
    await this.auditLogService.recordDurable(
      auth,
      {
        action: 'ticketing.oauth.start',
        resourceType: 'ticketing_connection',
        resourceId: 'jira',
        metadata: { provider: 'jira', phase: 'requested' },
      },
      undefined,
      organizationId,
    );
    await this.storeOAuthState(state, {
      organizationId,
      userId,
      redirectUri: configuredCallbackUrl,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    });

    const url = new URL('https://auth.atlassian.com/authorize');
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', this.jiraClientId);
    url.searchParams.set(
      'scope',
      'read:jira-work write:jira-work manage:jira-webhook offline_access',
    );
    url.searchParams.set('redirect_uri', configuredCallbackUrl);
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
    const callbackAuth: AuthContext = {
      organizationId,
      userId,
      roles: [],
      isAuthenticated: true,
      provider: 'ticketing-oauth',
    };
    const redirectUri = this.normalizeOAuthCallbackUrl(
      cached.redirectUri,
      'Stored Jira OAuth callback URL',
    );

    await this.auditLogService.recordDurable(
      callbackAuth,
      {
        action: 'ticketing.oauth.exchange',
        resourceType: 'ticketing_connection',
        resourceId: 'jira',
        metadata: { provider: 'jira', phase: 'requested' },
      },
      undefined,
      organizationId,
    );
    const tokenResponse = await this.exchangeCodeForTokens(code, redirectUri);
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

    const webhookSecret = generateWebhookSecret();
    await this.repository.saveOAuthConnectionAndQueueWebhookRegistration(
      {
        organizationId,
        provider: 'jira',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
        cloudId,
        webhookSecret,
        createdBy: userId,
      },
      (executor, record) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          callbackAuth,
          {
            action: 'ticketing.oauth.connect',
            resourceType: 'ticketing_connection',
            resourceId: record.id,
            metadata: {
              provider: 'jira',
              cloudId,
              phase: 'completed',
            },
          },
          undefined,
          organizationId,
        ),
    );

    return { success: true };
  }

  async disconnect(organizationId: string, auth: AuthContext | null = null): Promise<void> {
    await this.repository.deleteConnection(organizationId, 'jira', (executor, record) =>
      this.auditLogService.recordDurableWithExecutor(
        executor,
        auth,
        {
          action: 'ticketing.oauth.disconnect',
          resourceType: 'ticketing_connection',
          resourceId: record.id,
          metadata: { provider: 'jira', phase: 'completed' },
        },
        undefined,
        organizationId,
      ),
    );
  }

  async registerPendingWebhook(event: JiraWebhookRegistrationRequestedEvent): Promise<void> {
    if (
      !event.organizationId ||
      !event.connectionId ||
      !Number.isSafeInteger(event.registrationVersion) ||
      event.registrationVersion < 1 ||
      (event.operation !== undefined && event.operation !== 'renewal')
    ) {
      throw new Error('Invalid Jira webhook registration event');
    }

    const connection = await this.repository.findConnectionForWebhookRegistration(
      event.connectionId,
      event.organizationId,
    );
    if (
      !connection ||
      connection.webhookRegistrationStatus !== 'pending' ||
      connection.webhookRegistrationVersion !== event.registrationVersion
    ) {
      return;
    }
    if (!connection.cloudId || !connection.webhookSecret) {
      throw new Error('Pending Jira webhook registration is missing its cloud ID or secret');
    }

    const cloudId = connection.cloudId;
    const webhookSecret = connection.webhookSecret;
    const callbackOrigin = new URL(this.requireJiraConfig()).origin;
    const callbackUrl = buildWebhookCallbackUrl(callbackOrigin, webhookSecret);
    await this.auditLogService.recordDurable(
      null,
      {
        action: 'ticketing.webhook.register',
        resourceType: 'ticketing_connection',
        resourceId: connection.id,
        metadata: {
          provider: 'jira',
          registrationVersion: event.registrationVersion,
          operation: event.operation ?? 'connect',
          phase: 'requested',
        },
      },
      undefined,
      event.organizationId,
    );
    const { callbackWebhooks, webhookId } = await this.withTokenRefresh(
      event.organizationId,
      async (accessToken) => {
        const listedWebhooks = await this.jiraAdapter.listWebhooks(cloudId, accessToken);
        const callbackWebhooks = listedWebhooks.filter((webhook) => webhook.url === callbackUrl);
        const compatibleWebhooks = callbackWebhooks
          .filter(
            (webhook) => webhook.events.includes('jira:issue_updated') && webhook.jqlFilter === '*',
          )
          .sort((left, right) => {
            const leftNumber = Number(left.id);
            const rightNumber = Number(right.id);
            if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) {
              return leftNumber - rightNumber;
            }
            return left.id.localeCompare(right.id);
          });
        const storedWebhook =
          connection.webhookCloudId === cloudId && connection.webhookId
            ? compatibleWebhooks.find((webhook) => webhook.id === connection.webhookId)
            : undefined;
        const reusableWebhook = storedWebhook ?? compatibleWebhooks[0];
        let webhookId: string;
        if (reusableWebhook) {
          await this.jiraAdapter.refreshWebhook(cloudId, accessToken, reusableWebhook.id);
          webhookId = reusableWebhook.id;
        } else {
          webhookId = await this.jiraAdapter.registerWebhook(cloudId, accessToken, callbackUrl);
        }
        return { callbackWebhooks, webhookId };
      },
    );
    if (!webhookId) {
      throw new Error('Jira webhook registration did not return a webhook ID');
    }

    let completed: TicketingConnectionRecord | undefined;
    try {
      completed = await this.repository.completeWebhookRegistration(
        {
          id: event.connectionId,
          organizationId: event.organizationId,
          registrationVersion: event.registrationVersion,
          webhookSecret,
          webhookId,
          webhookCloudId: cloudId,
        },
        (executor, record) =>
          this.auditLogService.recordDurableWithExecutor(
            executor,
            null,
            {
              action: 'ticketing.webhook.register',
              resourceType: 'ticketing_connection',
              resourceId: record.id,
              metadata: {
                provider: 'jira',
                registrationVersion: event.registrationVersion,
                webhookId,
                phase: 'completed',
              },
            },
            undefined,
            event.organizationId,
          ),
      );
    } catch (error) {
      let current: TicketingConnectionRecord | undefined;
      try {
        current = await this.repository.findConnectionForWebhookRegistration(
          event.connectionId,
          event.organizationId,
        );
      } catch (rereadError) {
        this.logger.warn(
          `Unable to resolve an ambiguous Jira webhook registration write for ` +
            `${event.connectionId}:${event.registrationVersion}; retaining webhook ${webhookId} ` +
            `for bounded discovery on retry: ${rereadError}`,
        );
        throw error;
      }
      if (
        !this.isExactWebhookRegistration(
          current,
          event.registrationVersion,
          webhookSecret,
          cloudId,
          webhookId,
        )
      ) {
        throw error;
      }
      completed = current;
    }
    if (!completed) {
      const current = await this.repository.findConnectionForWebhookRegistration(
        event.connectionId,
        event.organizationId,
      );
      if (
        !this.isExactWebhookRegistration(
          current,
          event.registrationVersion,
          webhookSecret,
          cloudId,
          webhookId,
        )
      ) {
        this.logger.debug(
          `Retaining Jira webhook ${webhookId} after registration ${event.connectionId}:` +
            `${event.registrationVersion} lost its CAS; a current reconnect can reuse it`,
        );
        return;
      }
      completed = current;
    }

    const cleanupTargets = callbackWebhooks
      .filter((webhook) => webhook.id !== webhookId)
      .map((webhook) => ({ cloudId, webhookId: webhook.id, reason: 'duplicate registration' }));
    if (
      connection.webhookId &&
      connection.webhookCloudId &&
      (connection.webhookId !== webhookId || connection.webhookCloudId !== cloudId)
    ) {
      cleanupTargets.push({
        cloudId: connection.webhookCloudId,
        webhookId: connection.webhookId,
        reason: 'superseded registration',
      });
    }
    await this.cleanupWebhookTargetsBestEffort(
      event.organizationId,
      cloudId,
      webhookId,
      cleanupTargets,
    );
  }

  private isExactWebhookRegistration(
    connection: TicketingConnectionRecord | undefined,
    registrationVersion: number,
    webhookSecret: string,
    cloudId: string,
    webhookId: string,
  ): connection is TicketingConnectionRecord {
    return (
      connection?.webhookRegistrationStatus === 'registered' &&
      connection.webhookRegistrationVersion === registrationVersion &&
      connection.webhookSecret === webhookSecret &&
      connection.webhookCloudId === cloudId &&
      connection.webhookId === webhookId
    );
  }

  private async cleanupWebhookTargetsBestEffort(
    organizationId: string,
    activeCloudId: string,
    activeWebhookId: string,
    targets: { cloudId: string; webhookId: string; reason: string }[],
  ): Promise<void> {
    const uniqueTargets = [
      ...new Map(
        targets
          .filter(
            (target) => target.cloudId !== activeCloudId || target.webhookId !== activeWebhookId,
          )
          .map((target) => [`${target.cloudId}:${target.webhookId}`, target]),
      ).values(),
    ];
    const boundedTargets = uniqueTargets.slice(0, MAX_WEBHOOK_CLEANUPS_PER_REGISTRATION);
    for (const target of boundedTargets) {
      await this.deleteWebhookBestEffort(
        organizationId,
        target.cloudId,
        target.webhookId,
        target.reason,
      );
    }
    if (uniqueTargets.length > boundedTargets.length) {
      this.logger.warn(
        `Retained ${uniqueTargets.length - boundedTargets.length} excess Jira webhook(s) after ` +
          `the bounded cleanup limit; exact-callback duplicates are safe, convergent residuals ` +
          `and Jira expires dynamic webhooks`,
      );
    }
  }

  async updateConfig(
    organizationId: string,
    config: TicketingConnectionConfig,
    auth: AuthContext | null = null,
  ): Promise<ConnectionStatus> {
    const conn = await this.requireConnection(organizationId);
    await this.repository.updateConnection(conn.id, { config }, (executor, record) =>
      this.auditLogService.recordDurableWithExecutor(
        executor,
        auth,
        {
          action: 'ticketing.config.update',
          resourceType: 'ticketing_connection',
          resourceId: record.id,
          metadata: { provider: 'jira', phase: 'completed' },
        },
        undefined,
        organizationId,
      ),
    );
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

  async getCurrentJiraIssue(
    organizationId: string,
    issueKey: string,
  ): Promise<Record<string, unknown>> {
    const connection = await this.requireConnection(organizationId);
    if (!connection.cloudId) {
      throw new BadRequestException('Jira cloud ID is not set');
    }
    const cloudId = connection.cloudId;
    return this.withTokenRefresh(organizationId, (accessToken) =>
      this.jiraAdapter.getIssue(cloudId, accessToken, issueKey),
    );
  }

  async getTicketLink(organizationId: string, findingTriageId: string) {
    return (
      (await this.repository.findTicketLinkByTriageId(findingTriageId, organizationId)) ?? null
    );
  }

  async createTicket(
    organizationId: string,
    findingTriageId: string,
    findingData: TicketCreationPayload,
    projectionVersion: number,
  ) {
    const conn = await this.requireConnection(organizationId);
    const config = conn.config as TicketingConnectionConfig | null;
    if (!config?.projectKey || !config.issueTypeId) {
      throw new BadRequestException('Ticketing connection is not fully configured');
    }
    if (!conn.cloudId) {
      throw new BadRequestException('Jira cloud ID is not set');
    }
    const cloudId = conn.cloudId;
    const summary =
      `[${findingData.severity?.toUpperCase() ?? 'FINDING'}] ${findingData.title}`.slice(0, 255);
    const description = `Finding ID: ${findingData.findingOpensearchId}\nSeverity: ${findingData.severity ?? 'unknown'}\n\n${findingData.description}`;

    const reservation = await this.repository.reserveTicketCreation(
      {
        findingTriageId,
        organizationId,
        provider: 'jira',
        metadata: {
          lastAttemptedProjectionVersion: projectionVersion,
          retryPayload: findingData,
        },
      },
      (executor, record) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          null,
          {
            action: 'ticketing.issue.create',
            resourceType: 'ticketing_connection',
            resourceId: conn.id,
            metadata: {
              provider: 'jira',
              findingTriageId,
              ticketIntentId: record.id,
              projectionVersion,
              phase: 'requested',
            },
          },
          undefined,
          organizationId,
        ),
    );
    if (!reservation.acquired) {
      if (!this.isUnresolvedTicketIntent(reservation.record)) {
        return reservation.record;
      }
      throw new TicketCreationAmbiguousError();
    }

    let siteUrl: string;
    try {
      siteUrl = await this.withTokenRefresh(organizationId, async (accessToken) => {
        const resources = await this.jiraAdapter.getAccessibleResources(accessToken);
        return (
          resources.find((resource) => resource.id === cloudId)?.url ?? 'https://jira.atlassian.com'
        );
      });
    } catch (error) {
      await this.repository.releaseTicketCreationReservation({
        id: reservation.record.id,
        findingTriageId,
        organizationId,
        provider: 'jira',
      });
      throw error;
    }

    let issue: { id: string; key: string };
    let createRequestStarted = false;
    try {
      issue = await this.withTokenRefresh(organizationId, (accessToken) => {
        createRequestStarted = true;
        return this.jiraAdapter.createIssue(cloudId, accessToken, {
          projectKey: config.projectKey,
          issueTypeId: config.issueTypeId,
          summary,
          description,
        });
      });
    } catch (error) {
      if (
        !createRequestStarted ||
        error instanceof JiraRetryPreparationError ||
        (error instanceof JiraApiError && error.statusCode < 500)
      ) {
        await this.repository.releaseTicketCreationReservation({
          id: reservation.record.id,
          findingTriageId,
          organizationId,
          provider: 'jira',
        });
      } else {
        await this.markTicketCreationUnknown(reservation.record, error);
      }
      throw error;
    }

    let finalized: TicketLinkRecord | undefined;
    try {
      finalized = await this.repository.finalizeTicketCreation(
        {
          id: reservation.record.id,
          findingTriageId,
          organizationId,
          provider: 'jira',
          externalId: issue.key,
          externalUrl: `${siteUrl}/browse/${issue.key}`,
          lastSyncedAt: new Date(),
          metadata: {
            ...(reservation.record.metadata as Record<string, unknown> | null),
            jiraIssueId: issue.id,
            lastAppliedProjectionVersion: projectionVersion,
          },
        },
        (executor) =>
          this.auditLogService.recordDurableWithExecutor(
            executor,
            null,
            {
              action: 'ticketing.issue.create',
              resourceType: 'ticketing_connection',
              resourceId: conn.id,
              metadata: {
                provider: 'jira',
                findingTriageId,
                issueKey: issue.key,
                projectionVersion,
                phase: 'completed',
              },
            },
            undefined,
            organizationId,
          ),
      );
    } catch (error) {
      await this.markTicketCreationUnknown(reservation.record, error);
      throw new TicketCreationAmbiguousError(
        `Jira issue ${issue.key} was created but its local link could not be finalized`,
      );
    }
    if (!finalized) {
      throw new TicketCreationAmbiguousError(
        `Jira issue ${issue.key} was created but its local reservation was no longer pending`,
      );
    }
    const link = finalized;
    this.logger.log(`Created Jira ticket ${issue.key} for finding triage ${findingTriageId}`);
    return link;
  }

  async reconcileTicketCreation(
    auth: AuthContext,
    findingTriageId: string,
    input: ReconcileTicketCreationInput,
  ): Promise<ReconcileTicketCreationResult> {
    const organizationId = auth.organizationId;
    if (!organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    const unresolved = await this.repository.findUnresolvedTicketIntent({
      findingTriageId,
      organizationId,
      provider: 'jira',
    });
    if (!unresolved) {
      throw new NotFoundException('Unresolved Jira ticket creation intent not found');
    }

    if (input.action === 'attach') {
      const ticket = await this.attachVerifiedJiraIssue(
        auth,
        organizationId,
        unresolved,
        input.issueKey,
      );
      return {
        action: 'attach',
        status: 'attached',
        findingTriageId,
        ticket,
      };
    }

    if (input.confirmedNoIssueExists !== true) {
      throw new BadRequestException('Operator confirmation is required before retrying');
    }

    const metadata = this.ticketLinkMetadata(unresolved);
    const retryPayload = this.ticketCreationPayload(metadata.retryPayload);
    const cleared = await this.runTicketReconciliationMutation(() =>
      this.repository.clearUnresolvedTicketIntent(
        {
          id: unresolved.id,
          findingTriageId,
          organizationId,
          provider: 'jira',
          outboxAggregateId: retryPayload.findingOpensearchId,
        },
        (executor) =>
          this.auditLogService.recordDurableWithExecutor(executor, auth, {
            action: 'ticketing.reconcile.clear_and_retry',
            resourceType: 'finding_triage',
            resourceId: findingTriageId,
            metadata: {
              provider: 'jira',
            },
          }),
      ),
    );
    if (!cleared) {
      throw new NotFoundException('Unresolved Jira ticket creation intent not found');
    }

    return {
      action: 'clear_and_retry',
      status: 'retry_queued',
      findingTriageId,
      ticket: null,
    };
  }

  async updateTicketStatus(
    organizationId: string,
    findingTriageId: string,
    newStatus: string,
    projectionVersion: number,
  ): Promise<void> {
    const conn = await this.requireConnection(organizationId);
    const link = await this.repository.findTicketLinkByTriageId(findingTriageId, organizationId);
    if (!link) {
      this.logger.debug(`No ticket link for triage ${findingTriageId}`);
      return;
    }
    if (this.lastAppliedProjectionVersion(link) >= projectionVersion) {
      return;
    }

    const statusMapping = (conn.config as TicketingConnectionConfig | null)?.statusMapping ?? {};
    const mappingEntry = statusMapping[newStatus];
    if (!mappingEntry) {
      this.logger.debug(`No Jira mapping for status '${newStatus}'`);
      await this.repository.updateTicketLink(link.id, {
        metadata: {
          ...(link.metadata as Record<string, unknown>),
          lastAppliedProjectionVersion: projectionVersion,
        },
      });
      return;
    }
    const { transitionName, resultingStatus } = normalizeJiraStatusMappingEntry(mappingEntry);

    if (!conn.cloudId) {
      const message = 'Jira cloud ID is not set';
      await this.repository.updateTicketLink(link.id, {
        syncStatus: 'error',
        metadata: {
          ...(link.metadata as Record<string, unknown>),
          lastError: message,
        },
      });
      throw new BadRequestException(message);
    }
    const cloudId = conn.cloudId;

    await this.auditLogService.recordDurable(
      null,
      {
        action: 'ticketing.issue.transition',
        resourceType: 'ticketing_connection',
        resourceId: conn.id,
        metadata: {
          provider: 'jira',
          findingTriageId,
          issueKey: link.externalId,
          transitionName,
          resultingStatus,
          projectionVersion,
          phase: 'requested',
        },
      },
      undefined,
      organizationId,
    );
    const success = await this.withTokenRefresh(organizationId, (accessToken) =>
      this.jiraAdapter.transitionIssue(
        cloudId,
        accessToken,
        link.externalId,
        transitionName,
        resultingStatus,
      ),
    );

    if (!success) {
      await this.repository.updateTicketLink(link.id, {
        syncStatus: 'error',
        metadata: {
          ...(link.metadata as Record<string, unknown>),
          lastError: `Transition '${transitionName}' not available`,
        },
      });
      throw new TicketTransitionUnavailableError(link.externalId, transitionName);
    }

    await this.repository.updateTicketLink(
      link.id,
      {
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        metadata: {
          ...(link.metadata as Record<string, unknown>),
          lastAppliedProjectionVersion: projectionVersion,
        },
      },
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          null,
          {
            action: 'ticketing.issue.transition',
            resourceType: 'ticketing_connection',
            resourceId: conn.id,
            metadata: {
              provider: 'jira',
              findingTriageId,
              issueKey: link.externalId,
              transitionName,
              resultingStatus,
              projectionVersion,
              phase: 'completed',
            },
          },
          undefined,
          organizationId,
        ),
    );
  }

  // ---------------------------------------------------------------------------
  // Token management (private)
  // ---------------------------------------------------------------------------

  private async deleteWebhookBestEffort(
    organizationId: string,
    cloudId: string,
    webhookId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.auditLogService.recordDurable(
        null,
        {
          action: 'ticketing.webhook.delete',
          resourceType: 'ticketing_connection',
          resourceId: webhookId,
          metadata: {
            provider: 'jira',
            cloudId,
            reason,
            phase: 'requested',
          },
        },
        undefined,
        organizationId,
      );
      await this.withTokenRefresh(organizationId, (accessToken) =>
        this.jiraAdapter.deleteWebhook(cloudId, accessToken, webhookId),
      );
    } catch (error) {
      this.logger.warn(
        `Unable to clean up ${reason} Jira webhook ${webhookId} in ${cloudId}: ${error}`,
      );
    }
  }

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
    await this.auditLogService.recordDurable(
      null,
      {
        action: 'ticketing.oauth.refresh',
        resourceType: 'ticketing_connection',
        resourceId: conn.id,
        metadata: { provider: 'jira', phase: 'requested' },
      },
      undefined,
      organizationId,
    );
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
    await this.repository.updateConnection(
      conn.id,
      {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
      },
      (executor, record) =>
        this.auditLogService.recordDurableWithExecutor(
          executor,
          null,
          {
            action: 'ticketing.oauth.refresh',
            resourceType: 'ticketing_connection',
            resourceId: record.id,
            metadata: { provider: 'jira', phase: 'completed' },
          },
          undefined,
          organizationId,
        ),
    );
    this.logger.log(`Refreshed Jira token for org ${organizationId}`);
  }

  private async withTokenRefresh<T>(
    orgId: string,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const { accessToken } = await this.getDecryptedTokens(orgId);
    try {
      return await fn(accessToken);
    } catch (error) {
      if (error instanceof JiraApiError && error.statusCode === 401) {
        let latestConnection: TicketingConnectionRecord;
        try {
          latestConnection = await this.requireConnection(orgId);
        } catch (preparationError) {
          throw new JiraRetryPreparationError(preparationError);
        }
        if (!latestConnection.refreshToken) {
          throw error;
        }
        this.logger.log(`Got 401, attempting token refresh for org ${orgId}`);
        let newToken: string;
        try {
          await this.refreshAccessToken(orgId, latestConnection);
          ({ accessToken: newToken } = await this.getDecryptedTokens(orgId));
        } catch (preparationError) {
          throw new JiraRetryPreparationError(preparationError);
        }
        return fn(newToken);
      }
      throw error;
    }
  }

  private async exchangeCodeForTokens(code: string, redirectUri: string) {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.jiraClientId,
        client_secret: this.jiraClientSecret,
        code,
        redirect_uri: redirectUri,
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

  private requireJiraConfig(): string {
    if (!this.jiraClientId || !this.jiraClientSecret || !this.jiraCallbackUrl) {
      throw new BadRequestException(
        'Jira OAuth not configured. Set JIRA_CLIENT_ID, JIRA_CLIENT_SECRET, and JIRA_CALLBACK_URL.',
      );
    }
    return this.normalizeOAuthCallbackUrl(this.jiraCallbackUrl, 'JIRA_CALLBACK_URL');
  }

  private normalizeOAuthCallbackUrl(value: string, label: string): string {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
      return url.toString();
    } catch {
      throw new BadRequestException(`${label} must be a valid HTTP(S) URL`);
    }
  }

  private isUnresolvedTicketIntent(link: TicketLinkRecord): boolean {
    return (
      link.syncStatus === 'pending' ||
      link.syncStatus === 'unknown' ||
      link.externalId.startsWith('sentris-pending:')
    );
  }

  private lastAppliedProjectionVersion(link: TicketLinkRecord): number {
    const value = (link.metadata as Record<string, unknown> | null)?.lastAppliedProjectionVersion;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private async attachVerifiedJiraIssue(
    auth: AuthContext,
    organizationId: string,
    unresolved: TicketLinkRecord,
    requestedIssueKey: string,
  ): Promise<TicketLinkRecord> {
    const conn = await this.requireConnection(organizationId);
    if (!conn.cloudId) {
      throw new BadRequestException('Jira cloud ID is not set');
    }
    const cloudId = conn.cloudId;
    const issueKey = requestedIssueKey.toUpperCase();
    const { issue, siteUrl } = await this.withTokenRefresh(organizationId, async (accessToken) => {
      const verifiedIssue = await this.jiraAdapter.getIssue(cloudId, accessToken, issueKey);
      const resources = await this.jiraAdapter.getAccessibleResources(accessToken);
      return {
        issue: verifiedIssue,
        siteUrl:
          resources.find((resource) => resource.id === cloudId)?.url ??
          'https://jira.atlassian.com',
      };
    });

    const verifiedIssueKey = issue.key;
    const verifiedIssueId = issue.id;
    if (
      typeof verifiedIssueKey !== 'string' ||
      verifiedIssueKey.toUpperCase() !== issueKey ||
      typeof verifiedIssueId !== 'string' ||
      verifiedIssueId.length === 0
    ) {
      throw new BadRequestException('Jira did not return the requested issue');
    }

    const metadata = this.ticketLinkMetadata(unresolved);
    const retryPayload = this.ticketCreationPayload(metadata.retryPayload);
    const attemptedVersion = this.projectionVersion(
      metadata.lastAttemptedProjectionVersion,
      'Stored ticket projection version is invalid',
    );
    const attached = await this.runTicketReconciliationMutation(() =>
      this.repository.attachUnresolvedTicketIntent(
        {
          id: unresolved.id,
          findingTriageId: unresolved.findingTriageId,
          organizationId,
          provider: 'jira',
          outboxAggregateId: retryPayload.findingOpensearchId,
          externalId: verifiedIssueKey,
          externalUrl: `${siteUrl}/browse/${encodeURIComponent(verifiedIssueKey)}`,
          lastSyncedAt: new Date(),
          metadata: {
            ...metadata,
            jiraIssueId: verifiedIssueId,
            lastAppliedProjectionVersion: attemptedVersion,
            reconciliationRequired: false,
          },
        },
        (executor) =>
          this.auditLogService.recordDurableWithExecutor(executor, auth, {
            action: 'ticketing.reconcile.attach',
            resourceType: 'finding_triage',
            resourceId: unresolved.findingTriageId,
            metadata: {
              provider: 'jira',
              issueKey: verifiedIssueKey,
            },
          }),
      ),
    );
    if (!attached) {
      throw new NotFoundException('Unresolved Jira ticket creation intent not found');
    }
    return attached;
  }

  private async runTicketReconciliationMutation<T>(mutation: () => Promise<T>): Promise<T> {
    try {
      return await mutation();
    } catch (error) {
      if (error instanceof TicketReconciliationEventUnavailableError) {
        throw new ConflictException(
          'The durable triage event is unavailable; recover the outbox event before reconciling',
        );
      }
      throw error;
    }
  }

  private ticketLinkMetadata(link: TicketLinkRecord): Record<string, unknown> {
    return link.metadata && typeof link.metadata === 'object'
      ? (link.metadata as Record<string, unknown>)
      : {};
  }

  private projectionVersion(value: unknown, errorMessage: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new BadRequestException(errorMessage);
    }
    return value;
  }

  private ticketCreationPayload(value: unknown): TicketCreationPayload {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Stored ticket retry payload is unavailable');
    }
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.findingOpensearchId !== 'string' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.description !== 'string' ||
      (candidate.severity !== undefined && typeof candidate.severity !== 'string')
    ) {
      throw new BadRequestException('Stored ticket retry payload is invalid');
    }
    const severity = typeof candidate.severity === 'string' ? candidate.severity : undefined;
    return {
      findingOpensearchId: candidate.findingOpensearchId,
      title: candidate.title,
      description: candidate.description,
      ...(severity !== undefined && { severity }),
    };
  }

  private async markTicketCreationUnknown(
    reservation: TicketLinkRecord,
    error: unknown,
  ): Promise<void> {
    try {
      await this.repository.markTicketCreationUnknown({
        id: reservation.id,
        findingTriageId: reservation.findingTriageId,
        organizationId: reservation.organizationId,
        provider: reservation.provider,
        metadata: {
          ...(reservation.metadata as Record<string, unknown> | null),
          lastError: error instanceof Error ? error.message : String(error),
          reconciliationRequired: true,
        },
      });
    } catch (markError) {
      this.logger.error(
        `Unable to persist unknown Jira delivery state for ${reservation.findingTriageId}: ${markError}`,
      );
    }
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
