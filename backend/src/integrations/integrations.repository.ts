import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SecretEncryptionMaterial } from '@sentris/shared';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  integrationTokens,
  integrationOAuthStates,
  integrationProviderConfigs,
  workflowRunsTable,
  type IntegrationTokenRecord,
  type IntegrationOAuthStateRecord,
  type IntegrationProviderConfigRecord,
} from '../database/schema';
import type { OutboxExecutor } from '../outbox/enqueue-outbox-event';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

interface UpsertIntegrationTokenInput {
  organizationId?: string | null;
  userId: string;
  provider: string;
  scopes: string[];
  accessToken: SecretEncryptionMaterial;
  refreshToken: SecretEncryptionMaterial | null;
  tokenType: string;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

type IntegrationMutationHook<T> = (executor: OutboxExecutor, record: T) => Promise<void>;

function organizationCondition(column: AnyPgColumn, organizationId: string | null): SQL {
  return organizationId === null ? isNull(column) : eq(column, organizationId);
}

@Injectable()
export class IntegrationsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listConnections(
    userId: string,
    organizationId: string | null = null,
  ): Promise<IntegrationTokenRecord[]> {
    return await this.db
      .select()
      .from(integrationTokens)
      .where(
        and(
          organizationCondition(integrationTokens.organizationId, organizationId),
          eq(integrationTokens.userId, userId),
        ),
      )
      .orderBy(integrationTokens.provider);
  }

  async findById(
    id: string,
    organizationId: string | null,
  ): Promise<IntegrationTokenRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationTokens)
      .where(
        and(
          eq(integrationTokens.id, id),
          organizationCondition(integrationTokens.organizationId, organizationId),
        ),
      )
      .limit(1);
    return record;
  }

  async findByProvider(
    userId: string,
    provider: string,
    organizationId: string | null = null,
  ): Promise<IntegrationTokenRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationTokens)
      .where(
        and(
          organizationCondition(integrationTokens.organizationId, organizationId),
          eq(integrationTokens.userId, userId),
          eq(integrationTokens.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async runBelongsToOrganization(runId: string, organizationId: string | null): Promise<boolean> {
    const [record] = await this.db
      .select({ runId: workflowRunsTable.runId })
      .from(workflowRunsTable)
      .where(
        and(
          eq(workflowRunsTable.runId, runId),
          organizationCondition(workflowRunsTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    return Boolean(record);
  }

  async upsertConnection(
    input: UpsertIntegrationTokenInput,
    onPersisted?: IntegrationMutationHook<IntegrationTokenRecord>,
  ): Promise<IntegrationTokenRecord> {
    const payload = {
      organizationId: input.organizationId ?? null,
      userId: input.userId,
      provider: input.provider,
      scopes: input.scopes,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenType: input.tokenType,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      updatedAt: new Date(),
    };

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(integrationTokens)
        .values({
          ...payload,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            integrationTokens.organizationId,
            integrationTokens.userId,
            integrationTokens.provider,
          ],
          set: payload,
        })
        .returning();
      if (!record) {
        throw new Error('Unable to persist integration connection');
      }
      await onPersisted?.(tx, record);
      return record;
    });
  }

  async deleteConnection(
    id: string,
    userId: string,
    organizationId: string | null = null,
    onDeleted?: IntegrationMutationHook<IntegrationTokenRecord>,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .delete(integrationTokens)
        .where(
          and(
            eq(integrationTokens.id, id),
            organizationCondition(integrationTokens.organizationId, organizationId),
            eq(integrationTokens.userId, userId),
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

  async deleteByProvider(
    userId: string,
    provider: string,
    organizationId: string | null = null,
  ): Promise<void> {
    await this.db
      .delete(integrationTokens)
      .where(
        and(
          organizationCondition(integrationTokens.organizationId, organizationId),
          eq(integrationTokens.userId, userId),
          eq(integrationTokens.provider, provider),
        ),
      );
  }

  async createOAuthState(
    payload: {
      state: string;
      organizationId: string | null;
      userId: string;
      provider: string;
      codeVerifier?: string | null;
    },
    onCreated?: IntegrationMutationHook<IntegrationOAuthStateRecord>,
  ): Promise<IntegrationOAuthStateRecord> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(integrationOAuthStates)
        .values({
          state: payload.state,
          organizationId: payload.organizationId ?? null,
          userId: payload.userId,
          provider: payload.provider,
          codeVerifier: payload.codeVerifier ?? null,
        })
        .onConflictDoUpdate({
          target: integrationOAuthStates.state,
          set: {
            organizationId: payload.organizationId ?? null,
            userId: payload.userId,
            provider: payload.provider,
            codeVerifier: payload.codeVerifier ?? null,
            createdAt: new Date(),
          },
        })
        .returning();
      if (!record) {
        throw new Error('Unable to persist OAuth state');
      }
      await onCreated?.(tx, record);
      return record;
    });
  }

  async consumeOAuthState(
    state: string,
    userId: string,
    provider: string,
    organizationId: string | null = null,
    onConsumed?: IntegrationMutationHook<IntegrationOAuthStateRecord>,
  ): Promise<IntegrationOAuthStateRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .delete(integrationOAuthStates)
        .where(
          and(
            eq(integrationOAuthStates.state, state),
            organizationCondition(integrationOAuthStates.organizationId, organizationId),
            eq(integrationOAuthStates.userId, userId),
            eq(integrationOAuthStates.provider, provider),
          ),
        )
        .returning();
      if (!record) {
        return undefined;
      }
      await onConsumed?.(tx, record);
      return record;
    });
  }

  async upsertProviderConfig(
    input: {
      organizationId?: string | null;
      provider: string;
      clientId: string;
      clientSecret: SecretEncryptionMaterial;
    },
    onPersisted?: IntegrationMutationHook<IntegrationProviderConfigRecord>,
  ): Promise<IntegrationProviderConfigRecord> {
    const payload = {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      updatedAt: new Date(),
    };

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(integrationProviderConfigs)
        .values({
          organizationId: input.organizationId ?? null,
          provider: input.provider,
          ...payload,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrationProviderConfigs.organizationId, integrationProviderConfigs.provider],
          set: payload,
        })
        .returning();
      if (!record) {
        throw new Error('Unable to persist provider configuration');
      }
      await onPersisted?.(tx, record);
      return record;
    });
  }

  async findProviderConfig(
    organizationId: string | null,
    provider: string,
  ): Promise<IntegrationProviderConfigRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationProviderConfigs)
      .where(
        and(
          organizationCondition(integrationProviderConfigs.organizationId, organizationId),
          eq(integrationProviderConfigs.provider, provider),
        ),
      )
      .limit(1);

    return record;
  }

  async listProviderConfigs(): Promise<IntegrationProviderConfigRecord[]> {
    return await this.db.select().from(integrationProviderConfigs);
  }

  async deleteProviderConfig(
    organizationId: string | null,
    provider: string,
    onDeleted?: IntegrationMutationHook<IntegrationProviderConfigRecord>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [record] = await tx
        .delete(integrationProviderConfigs)
        .where(
          and(
            organizationCondition(integrationProviderConfigs.organizationId, organizationId),
            eq(integrationProviderConfigs.provider, provider),
          ),
        )
        .returning();
      if (record) {
        await onDeleted?.(tx, record);
      }
    });
  }
}
