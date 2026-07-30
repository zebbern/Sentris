import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, like, lte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  outboxEventsTable,
  ticketingConnectionsTable,
  ticketLinksTable,
  type TicketingConnectionRecord,
  type TicketingConnectionInsert,
  type TicketLinkRecord,
  type TicketLinkInsert,
} from '../database/schema';
import { ensureAggregateEventScheduledWithExecutor } from '../outbox/outbox.repository';
import { enqueueOutboxEvent, type OutboxExecutor } from '../outbox/enqueue-outbox-event';

export const JIRA_WEBHOOK_REGISTRATION_EVENT_TYPE = 'ticketing.jira.webhook.register.v1';

export interface JiraWebhookRegistrationRequestedEvent {
  organizationId: string;
  connectionId: string;
  registrationVersion: number;
  operation?: 'renewal';
}

export interface WebhookRegistrationDelivery {
  status: 'pending' | 'processing' | 'completed' | 'dead';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
}

export class TicketReconciliationEventUnavailableError extends Error {
  constructor() {
    super('No durable triage event is available for ticket reconciliation');
    this.name = 'TicketReconciliationEventUnavailableError';
  }
}

type TicketReconciliationMutationHook = (
  executor: OutboxExecutor,
  record: TicketLinkRecord,
) => Promise<void>;
type TicketingConnectionMutationHook = (
  executor: OutboxExecutor,
  record: TicketingConnectionRecord,
) => Promise<void>;

@Injectable()
export class TicketingRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  async findConnectionByOrg(
    organizationId: string,
    provider = 'jira',
  ): Promise<TicketingConnectionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketingConnectionsTable)
      .where(
        and(
          eq(ticketingConnectionsTable.organizationId, organizationId),
          eq(ticketingConnectionsTable.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async findConnectionByWebhookSecret(
    webhookSecret: string,
  ): Promise<TicketingConnectionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketingConnectionsTable)
      .where(eq(ticketingConnectionsTable.webhookSecret, webhookSecret))
      .limit(1);
    return record;
  }

  async createConnection(data: TicketingConnectionInsert): Promise<TicketingConnectionRecord> {
    const values =
      data.config === null
        ? {
            ...data,
            config: sql`'null'::jsonb`,
          }
        : data;
    const [record] = await this.db.insert(ticketingConnectionsTable).values(values).returning();
    return record;
  }

  async saveOAuthConnectionAndQueueWebhookRegistration(
    data: Pick<
      TicketingConnectionInsert,
      | 'organizationId'
      | 'provider'
      | 'accessToken'
      | 'refreshToken'
      | 'tokenExpiresAt'
      | 'cloudId'
      | 'createdBy'
    > & { webhookSecret: string },
    onPersisted?: TicketingConnectionMutationHook,
  ): Promise<TicketingConnectionRecord> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(ticketingConnectionsTable)
        .values({
          ...data,
          config: sql`'null'::jsonb`,
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: 1,
          webhookRegisteredAt: null,
        })
        .onConflictDoUpdate({
          target: [ticketingConnectionsTable.organizationId, ticketingConnectionsTable.provider],
          set: {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            tokenExpiresAt: data.tokenExpiresAt,
            cloudId: data.cloudId,
            webhookSecret: sql`COALESCE(${ticketingConnectionsTable.webhookSecret}, ${data.webhookSecret})`,
            webhookRegistrationStatus: 'pending',
            webhookRegistrationVersion: sql`${ticketingConnectionsTable.webhookRegistrationVersion} + 1`,
            webhookRegisteredAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!record) {
        throw new Error('Unable to persist Jira OAuth connection');
      }
      const registrationVersion = record.webhookRegistrationVersion;
      const event: JiraWebhookRegistrationRequestedEvent = {
        organizationId: record.organizationId,
        connectionId: record.id,
        registrationVersion,
      };
      await enqueueOutboxEvent(tx, {
        eventType: JIRA_WEBHOOK_REGISTRATION_EVENT_TYPE,
        organizationId: record.organizationId,
        aggregateType: 'ticketing_connection_webhook',
        aggregateId: `${record.id}:${registrationVersion}`,
        dedupeKey: `ticketing.jira.webhook.register:${record.id}:${registrationVersion}`,
        payload: { ...event },
        maxAttempts: 8,
      });
      await onPersisted?.(tx, record);
      return record;
    });
  }

  async queueDueJiraWebhookRenewals(cutoff: Date, limit: number): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({
          id: ticketingConnectionsTable.id,
          organizationId: ticketingConnectionsTable.organizationId,
        })
        .from(ticketingConnectionsTable)
        .where(
          and(
            eq(ticketingConnectionsTable.provider, 'jira'),
            eq(ticketingConnectionsTable.webhookRegistrationStatus, 'registered'),
            isNotNull(ticketingConnectionsTable.webhookId),
            isNotNull(ticketingConnectionsTable.webhookCloudId),
            isNotNull(ticketingConnectionsTable.webhookSecret),
            isNotNull(ticketingConnectionsTable.webhookRegisteredAt),
            lte(ticketingConnectionsTable.webhookRegisteredAt, cutoff),
          ),
        )
        .orderBy(
          asc(ticketingConnectionsTable.webhookRegisteredAt),
          asc(ticketingConnectionsTable.id),
        )
        .limit(boundedLimit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) {
        return 0;
      }

      const updated = await tx
        .update(ticketingConnectionsTable)
        .set({
          webhookRegistrationStatus: 'pending',
          webhookRegistrationVersion: sql`${ticketingConnectionsTable.webhookRegistrationVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(
              ticketingConnectionsTable.id,
              candidates.map(({ id }) => id),
            ),
            eq(ticketingConnectionsTable.provider, 'jira'),
            eq(ticketingConnectionsTable.webhookRegistrationStatus, 'registered'),
            lte(ticketingConnectionsTable.webhookRegisteredAt, cutoff),
          ),
        )
        .returning({
          id: ticketingConnectionsTable.id,
          organizationId: ticketingConnectionsTable.organizationId,
          registrationVersion: ticketingConnectionsTable.webhookRegistrationVersion,
        });
      if (updated.length === 0) {
        return 0;
      }

      await tx
        .insert(outboxEventsTable)
        .values(
          updated.map((connection) => {
            const event: JiraWebhookRegistrationRequestedEvent = {
              organizationId: connection.organizationId,
              connectionId: connection.id,
              registrationVersion: connection.registrationVersion,
              operation: 'renewal',
            };
            return {
              eventType: JIRA_WEBHOOK_REGISTRATION_EVENT_TYPE,
              organizationId: connection.organizationId,
              aggregateType: 'ticketing_connection_webhook',
              aggregateId: `${connection.id}:${connection.registrationVersion}`,
              dedupeKey:
                `ticketing.jira.webhook.register:${connection.id}:` +
                connection.registrationVersion,
              payload: { ...event },
              maxAttempts: 8,
            };
          }),
        )
        .onConflictDoNothing({ target: outboxEventsTable.dedupeKey });
      return updated.length;
    });
  }

  async findConnectionForWebhookRegistration(
    id: string,
    organizationId: string,
  ): Promise<TicketingConnectionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketingConnectionsTable)
      .where(
        and(
          eq(ticketingConnectionsTable.id, id),
          eq(ticketingConnectionsTable.organizationId, organizationId),
          eq(ticketingConnectionsTable.provider, 'jira'),
        ),
      )
      .limit(1);
    return record;
  }

  async completeWebhookRegistration(
    input: {
      id: string;
      organizationId: string;
      registrationVersion: number;
      webhookSecret: string;
      webhookId: string;
      webhookCloudId: string;
    },
    onCompleted?: TicketingConnectionMutationHook,
  ): Promise<TicketingConnectionRecord | undefined> {
    const operation = async (executor: NodePgDatabase) => {
      const [record] = await executor
        .update(ticketingConnectionsTable)
        .set({
          webhookId: input.webhookId,
          webhookCloudId: input.webhookCloudId,
          webhookRegistrationStatus: 'registered',
          webhookRegisteredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ticketingConnectionsTable.id, input.id),
            eq(ticketingConnectionsTable.organizationId, input.organizationId),
            eq(ticketingConnectionsTable.provider, 'jira'),
            eq(ticketingConnectionsTable.webhookRegistrationVersion, input.registrationVersion),
            eq(ticketingConnectionsTable.webhookRegistrationStatus, 'pending'),
            eq(ticketingConnectionsTable.webhookSecret, input.webhookSecret),
          ),
        )
        .returning();
      if (record) {
        await onCompleted?.(executor, record);
      }
      return record;
    };
    return onCompleted
      ? this.db.transaction((tx) => operation(tx as unknown as NodePgDatabase))
      : operation(this.db);
  }

  async findWebhookRegistrationDelivery(
    connectionId: string,
    registrationVersion: number,
  ): Promise<WebhookRegistrationDelivery | undefined> {
    const [event] = await this.db
      .select({
        status: outboxEventsTable.status,
        attempts: outboxEventsTable.attempts,
        maxAttempts: outboxEventsTable.maxAttempts,
        lastError: outboxEventsTable.lastError,
      })
      .from(outboxEventsTable)
      .where(
        eq(
          outboxEventsTable.dedupeKey,
          `ticketing.jira.webhook.register:${connectionId}:${registrationVersion}`,
        ),
      )
      .limit(1);
    return event;
  }

  async updateConnection(
    id: string,
    data: Partial<Omit<TicketingConnectionInsert, 'id'>>,
    onUpdated?: TicketingConnectionMutationHook,
  ): Promise<TicketingConnectionRecord> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(ticketingConnectionsTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(ticketingConnectionsTable.id, id))
        .returning();
      if (record) {
        await onUpdated?.(tx, record);
      }
      return record;
    });
  }

  async deleteConnection(
    organizationId: string,
    provider = 'jira',
    onDeleted?: TicketingConnectionMutationHook,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .delete(ticketingConnectionsTable)
        .where(
          and(
            eq(ticketingConnectionsTable.organizationId, organizationId),
            eq(ticketingConnectionsTable.provider, provider),
          ),
        )
        .returning();
      if (!record) {
        return false;
      }
      await onDeleted?.(tx, record);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Ticket links
  // ---------------------------------------------------------------------------

  async findTicketLinkByTriageId(
    findingTriageId: string,
    organizationId: string,
    provider = 'jira',
  ): Promise<TicketLinkRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.findingTriageId, findingTriageId),
          eq(ticketLinksTable.organizationId, organizationId),
          eq(ticketLinksTable.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async findTicketLinkByExternalId(
    externalId: string,
    organizationId: string,
    provider = 'jira',
  ): Promise<TicketLinkRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.externalId, externalId),
          eq(ticketLinksTable.organizationId, organizationId),
          eq(ticketLinksTable.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async findTicketLinksByExternalId(
    externalId: string,
    organizationId: string,
    provider = 'jira',
  ): Promise<TicketLinkRecord[]> {
    return this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.externalId, externalId),
          eq(ticketLinksTable.organizationId, organizationId),
          eq(ticketLinksTable.provider, provider),
        ),
      );
  }

  async createTicketLink(data: TicketLinkInsert): Promise<TicketLinkRecord> {
    const [record] = await this.db.insert(ticketLinksTable).values(data).returning();
    return record;
  }

  async reserveTicketCreation(
    input: {
      findingTriageId: string;
      organizationId: string;
      provider?: string;
      metadata?: Record<string, unknown>;
    },
    onReserved?: TicketReconciliationMutationHook,
  ): Promise<{
    acquired: boolean;
    record: TicketLinkRecord;
  }> {
    const provider = input.provider ?? 'jira';
    const operation = async (executor: NodePgDatabase) => {
      const [created] = await executor
        .insert(ticketLinksTable)
        .values({
          findingTriageId: input.findingTriageId,
          organizationId: input.organizationId,
          provider,
          externalId: `sentris-pending:${input.findingTriageId}`,
          externalUrl: '',
          syncStatus: 'pending',
          metadata: {
            ...input.metadata,
            intentCreatedAt: new Date().toISOString(),
          },
        })
        .onConflictDoNothing({
          target: [ticketLinksTable.findingTriageId, ticketLinksTable.provider],
        })
        .returning();

      if (created) {
        await onReserved?.(executor, created);
        return { acquired: true, record: created };
      }
      const [existing] = await executor
        .select()
        .from(ticketLinksTable)
        .where(
          and(
            eq(ticketLinksTable.findingTriageId, input.findingTriageId),
            eq(ticketLinksTable.organizationId, input.organizationId),
            eq(ticketLinksTable.provider, provider),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error('Ticket creation reservation conflicted but no ticket link exists');
      }
      return { acquired: false, record: existing };
    };
    return onReserved
      ? this.db.transaction((tx) => operation(tx as unknown as NodePgDatabase))
      : operation(this.db);
  }

  async finalizeTicketCreation(
    input: {
      id: string;
      findingTriageId: string;
      organizationId: string;
      provider?: string;
      externalId: string;
      externalUrl: string;
      lastSyncedAt: Date;
      metadata: Record<string, unknown>;
    },
    onFinalized?: TicketReconciliationMutationHook,
  ): Promise<TicketLinkRecord | undefined> {
    const provider = input.provider ?? 'jira';
    const operation = async (executor: NodePgDatabase) => {
      const [record] = await executor
        .update(ticketLinksTable)
        .set({
          externalId: input.externalId,
          externalUrl: input.externalUrl,
          syncStatus: 'synced',
          lastSyncedAt: input.lastSyncedAt,
          metadata: input.metadata,
        })
        .where(
          and(
            eq(ticketLinksTable.id, input.id),
            eq(ticketLinksTable.findingTriageId, input.findingTriageId),
            eq(ticketLinksTable.organizationId, input.organizationId),
            eq(ticketLinksTable.provider, provider),
            eq(ticketLinksTable.syncStatus, 'pending'),
            like(ticketLinksTable.externalId, 'sentris-pending:%'),
          ),
        )
        .returning();
      if (record) {
        await onFinalized?.(executor, record);
      }
      return record;
    };
    return onFinalized
      ? this.db.transaction((tx) => operation(tx as unknown as NodePgDatabase))
      : operation(this.db);
  }

  async markTicketCreationUnknown(input: {
    id: string;
    findingTriageId: string;
    organizationId: string;
    provider?: string;
    metadata: Record<string, unknown>;
  }): Promise<TicketLinkRecord | undefined> {
    const provider = input.provider ?? 'jira';
    const [record] = await this.db
      .update(ticketLinksTable)
      .set({
        syncStatus: 'unknown',
        metadata: input.metadata,
      })
      .where(
        and(
          eq(ticketLinksTable.id, input.id),
          eq(ticketLinksTable.findingTriageId, input.findingTriageId),
          eq(ticketLinksTable.organizationId, input.organizationId),
          eq(ticketLinksTable.provider, provider),
          eq(ticketLinksTable.syncStatus, 'pending'),
          like(ticketLinksTable.externalId, 'sentris-pending:%'),
        ),
      )
      .returning();
    return record;
  }

  async findUnresolvedTicketIntent(input: {
    findingTriageId: string;
    organizationId: string;
    provider?: string;
  }): Promise<TicketLinkRecord | undefined> {
    const provider = input.provider ?? 'jira';
    const [record] = await this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.findingTriageId, input.findingTriageId),
          eq(ticketLinksTable.organizationId, input.organizationId),
          eq(ticketLinksTable.provider, provider),
          inArray(ticketLinksTable.syncStatus, ['pending', 'unknown']),
          like(ticketLinksTable.externalId, 'sentris-pending:%'),
        ),
      )
      .limit(1);
    return record;
  }

  async attachUnresolvedTicketIntent(
    input: {
      id: string;
      findingTriageId: string;
      organizationId: string;
      provider?: string;
      outboxAggregateId: string;
      externalId: string;
      externalUrl: string;
      lastSyncedAt: Date;
      metadata: Record<string, unknown>;
    },
    onMutated?: TicketReconciliationMutationHook,
  ): Promise<TicketLinkRecord | undefined> {
    const provider = input.provider ?? 'jira';
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(ticketLinksTable)
        .set({
          externalId: input.externalId,
          externalUrl: input.externalUrl,
          syncStatus: 'synced',
          lastSyncedAt: input.lastSyncedAt,
          metadata: input.metadata,
        })
        .where(
          and(
            eq(ticketLinksTable.id, input.id),
            eq(ticketLinksTable.findingTriageId, input.findingTriageId),
            eq(ticketLinksTable.organizationId, input.organizationId),
            eq(ticketLinksTable.provider, provider),
            inArray(ticketLinksTable.syncStatus, ['pending', 'unknown']),
            like(ticketLinksTable.externalId, 'sentris-pending:%'),
          ),
        )
        .returning();
      if (!record) return undefined;

      await this.ensureReconciliationEventScheduled(tx, input);
      await onMutated?.(tx, record);
      return record;
    });
  }

  async clearUnresolvedTicketIntent(
    input: {
      id: string;
      findingTriageId: string;
      organizationId: string;
      provider?: string;
      outboxAggregateId: string;
    },
    onMutated?: TicketReconciliationMutationHook,
  ): Promise<TicketLinkRecord | undefined> {
    const provider = input.provider ?? 'jira';
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .delete(ticketLinksTable)
        .where(
          and(
            eq(ticketLinksTable.id, input.id),
            eq(ticketLinksTable.findingTriageId, input.findingTriageId),
            eq(ticketLinksTable.organizationId, input.organizationId),
            eq(ticketLinksTable.provider, provider),
            inArray(ticketLinksTable.syncStatus, ['pending', 'unknown']),
            like(ticketLinksTable.externalId, 'sentris-pending:%'),
          ),
        )
        .returning();
      if (!record) return undefined;

      await this.ensureReconciliationEventScheduled(tx, input);
      await onMutated?.(tx, record);
      return record;
    });
  }

  async releaseTicketCreationReservation(input: {
    id: string;
    findingTriageId: string;
    organizationId: string;
    provider?: string;
  }): Promise<void> {
    const provider = input.provider ?? 'jira';
    await this.db
      .delete(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.id, input.id),
          eq(ticketLinksTable.findingTriageId, input.findingTriageId),
          eq(ticketLinksTable.organizationId, input.organizationId),
          eq(ticketLinksTable.provider, provider),
          eq(ticketLinksTable.syncStatus, 'pending'),
          like(ticketLinksTable.externalId, 'sentris-pending:%'),
        ),
      );
  }

  async updateTicketLink(
    id: string,
    data: Partial<Omit<TicketLinkInsert, 'id'>>,
    onUpdated?: TicketReconciliationMutationHook,
  ): Promise<TicketLinkRecord> {
    const operation = async (executor: NodePgDatabase) => {
      const [record] = await executor
        .update(ticketLinksTable)
        .set(data)
        .where(eq(ticketLinksTable.id, id))
        .returning();
      if (record) {
        await onUpdated?.(executor, record);
      }
      return record;
    };
    return onUpdated
      ? this.db.transaction((tx) => operation(tx as unknown as NodePgDatabase))
      : operation(this.db);
  }

  async updateTicketLinksByIds(
    ids: string[],
    organizationId: string,
    data: Partial<Omit<TicketLinkInsert, 'id'>>,
    provider = 'jira',
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(ticketLinksTable)
      .set(data)
      .where(
        and(
          inArray(ticketLinksTable.id, ids),
          eq(ticketLinksTable.organizationId, organizationId),
          eq(ticketLinksTable.provider, provider),
        ),
      );
  }

  async findTicketLinksByTriageIds(
    findingTriageIds: string[],
    provider = 'jira',
  ): Promise<TicketLinkRecord[]> {
    if (findingTriageIds.length === 0) return [];
    return this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          inArray(ticketLinksTable.findingTriageId, findingTriageIds),
          eq(ticketLinksTable.provider, provider),
        ),
      );
  }

  private async ensureReconciliationEventScheduled(
    executor: Parameters<typeof ensureAggregateEventScheduledWithExecutor>[0],
    input: { organizationId: string; outboxAggregateId: string },
  ): Promise<void> {
    const scheduled = await ensureAggregateEventScheduledWithExecutor(executor, {
      organizationId: input.organizationId,
      eventType: 'finding.triage.changed',
      aggregateType: 'finding',
      aggregateId: input.outboxAggregateId,
    });
    if (!scheduled) {
      throw new TicketReconciliationEventUnavailableError();
    }
  }
}
