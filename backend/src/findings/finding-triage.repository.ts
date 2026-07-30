import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { buildFindingObservationIndexName } from '@sentris/shared/finding-observation-id';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { enqueueOutboxEvent, type OutboxExecutor } from '../outbox/enqueue-outbox-event';
import {
  findingTriageTable,
  findingTriageEventsTable,
  findingProjectionReconciliationTable,
  type FindingTriageRecord,
  type FindingTriageEventRecord,
  type FindingProjectionReconciliationRecord,
} from '../database/schema';
import type { FindingTriageStatus } from './dto/triage-update.dto';
import {
  FINDING_TRIAGE_CHANGED_EVENT,
  FINDING_TRIAGE_PROJECTION_EVENT,
} from './finding-triage.events';

export class FindingTriageWriteConflictError extends Error {
  constructor() {
    super('Finding triage changed concurrently');
    this.name = 'FindingTriageWriteConflictError';
  }
}

export interface CommitFindingTriageChangeInput {
  organizationId: string;
  findingOpensearchId: string;
  triageId: string;
  expectedVersion: number;
  previousStatus: FindingTriageStatus;
  source: string;
  userId: string;
  data: {
    status?: FindingTriageStatus;
    assigneeUserId?: string | null;
    severityOverride?: string | null;
    notes?: string | null;
  };
  events: {
    eventType: string;
    fieldChanged: string | null;
    oldValue: string | null;
    newValue: string | null;
    comment: string | null;
  }[];
}

export interface SaveFindingProjectionReconciliationState {
  organizationId: string;
  cursor: string | null;
  cycleStartedAt: Date | null;
  cycleCutoff: Date | null;
  checked: number;
  repaired: number;
  failed: number;
  lastCompletedAt: Date | null;
  reconciledThrough: Date | null;
}

export interface FindingObservationDiscoveryCursor {
  indexName: string;
  organizationId: string;
}

// C0 control characters are rejected by the exact organization-ID contract,
// so this row can never collide with a provisionable tenant identity.
const FINDING_OBSERVATION_DISCOVERY_STATE_ID = '\u001esentris:finding-observation-discovery:v1';

@Injectable()
export class FindingTriageRepository {
  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

  async transaction<T>(callback: (executor: OutboxExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx));
  }

  async findByOrgAndFindingId(
    organizationId: string,
    findingOpensearchId: string,
  ): Promise<FindingTriageRecord | null> {
    const [record] = await this.db
      .select()
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          eq(findingTriageTable.findingOpensearchId, findingOpensearchId),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  async findByIds(
    organizationId: string,
    findingOpensearchIds: string[],
  ): Promise<FindingTriageRecord[]> {
    if (findingOpensearchIds.length === 0) return [];

    return this.db
      .select()
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          inArray(findingTriageTable.findingOpensearchId, findingOpensearchIds),
        ),
      );
  }

  /**
   * Atomically commits mutable triage state, its relational audit history, and
   * durable projection/integration events. expectedVersion prevents a stale
   * transition decision from overwriting a concurrent operator update.
   */
  async commitChange(
    input: CommitFindingTriageChangeInput,
    executor?: OutboxExecutor,
  ): Promise<FindingTriageRecord> {
    const commit = async (tx: OutboxExecutor) => {
      const now = new Date();
      const [record] = await tx
        .insert(findingTriageTable)
        .values({
          id: input.triageId,
          organizationId: input.organizationId,
          findingOpensearchId: input.findingOpensearchId,
          status: input.data.status ?? 'new',
          assigneeUserId: input.data.assigneeUserId ?? null,
          severityOverride: input.data.severityOverride ?? null,
          notes: input.data.notes ?? null,
          projectionVersion: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [findingTriageTable.organizationId, findingTriageTable.findingOpensearchId],
          set: {
            ...(input.data.status !== undefined && { status: input.data.status }),
            ...(input.data.assigneeUserId !== undefined && {
              assigneeUserId: input.data.assigneeUserId,
            }),
            ...(input.data.severityOverride !== undefined && {
              severityOverride: input.data.severityOverride,
            }),
            ...(input.data.notes !== undefined && { notes: input.data.notes }),
            projectionVersion: sql`${findingTriageTable.projectionVersion} + 1`,
            updatedAt: now,
          },
          where: eq(findingTriageTable.projectionVersion, input.expectedVersion),
        })
        .returning();

      if (!record) {
        throw new FindingTriageWriteConflictError();
      }

      if (input.events.length > 0) {
        await tx.insert(findingTriageEventsTable).values(
          input.events.map((event) => ({
            ...event,
            findingTriageId: record.id,
            userId: input.userId,
          })),
        );
      }

      const payload = {
        findingTriageId: record.id,
        findingOpensearchId: record.findingOpensearchId,
        organizationId: record.organizationId,
        status: record.status,
        previousStatus: input.previousStatus,
        assigneeUserId: record.assigneeUserId,
        severityOverride: record.severityOverride,
        notes: record.notes,
        updatedAt: record.updatedAt.toISOString(),
        projectionVersion: record.projectionVersion,
        source: input.source,
        userId: input.userId,
      };

      await enqueueOutboxEvent(tx, {
        eventType: FINDING_TRIAGE_PROJECTION_EVENT,
        organizationId: input.organizationId,
        aggregateType: 'finding',
        aggregateId: input.findingOpensearchId,
        dedupeKey: `finding-triage-project:${input.organizationId}:${input.findingOpensearchId}:v${record.projectionVersion}`,
        payload,
        maxAttempts: 12,
      });
      await enqueueOutboxEvent(tx, {
        eventType: FINDING_TRIAGE_CHANGED_EVENT,
        organizationId: input.organizationId,
        aggregateType: 'finding',
        aggregateId: input.findingOpensearchId,
        dedupeKey: `finding-triage-changed:${input.organizationId}:${input.findingOpensearchId}:v${record.projectionVersion}`,
        payload,
        maxAttempts: 8,
      });

      return record;
    };

    return executor ? commit(executor) : this.db.transaction((tx) => commit(tx));
  }

  async listEvents(findingTriageId: string, limit: number): Promise<FindingTriageEventRecord[]> {
    return this.db
      .select()
      .from(findingTriageEventsTable)
      .where(eq(findingTriageEventsTable.findingTriageId, findingTriageId))
      .orderBy(desc(findingTriageEventsTable.createdAt))
      .limit(limit);
  }

  async listProjectionOrganizationsPage(
    afterOrganizationId: string | undefined,
    limit: number,
  ): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const rows = await this.db
      .selectDistinct({ organizationId: findingTriageTable.organizationId })
      .from(findingTriageTable)
      .where(
        afterOrganizationId
          ? gt(findingTriageTable.organizationId, afterOrganizationId)
          : undefined,
      )
      .orderBy(asc(findingTriageTable.organizationId))
      .limit(boundedLimit);
    return rows.map((row) => row.organizationId);
  }

  async listExistingProjectionOrganizations(organizationIds: string[]): Promise<string[]> {
    if (organizationIds.length === 0) return [];
    const boundedOrganizationIds = [...new Set(organizationIds)].slice(0, 100);
    const rows = await this.db
      .selectDistinct({ organizationId: findingTriageTable.organizationId })
      .from(findingTriageTable)
      .where(inArray(findingTriageTable.organizationId, boundedOrganizationIds))
      .orderBy(asc(findingTriageTable.organizationId));
    return rows.map((row) => row.organizationId);
  }

  async getFindingObservationDiscoveryCursor(): Promise<FindingObservationDiscoveryCursor | null> {
    const rows = await this.db
      .select({ cursor: findingProjectionReconciliationTable.cursor })
      .from(findingProjectionReconciliationTable)
      .where(
        eq(
          findingProjectionReconciliationTable.organizationId,
          FINDING_OBSERVATION_DISCOVERY_STATE_ID,
        ),
      )
      .limit(1);
    const encoded = rows[0]?.cursor;
    if (encoded === null || encoded === undefined) return null;
    return this.parseFindingObservationDiscoveryCursor(encoded);
  }

  async saveFindingObservationDiscoveryCursor(
    cursor: FindingObservationDiscoveryCursor | null,
  ): Promise<void> {
    if (cursor) this.assertFindingObservationDiscoveryCursor(cursor);
    const encoded = cursor ? JSON.stringify(cursor) : null;
    await this.db
      .insert(findingProjectionReconciliationTable)
      .values({
        organizationId: FINDING_OBSERVATION_DISCOVERY_STATE_ID,
        cursor: encoded,
      })
      .onConflictDoUpdate({
        target: findingProjectionReconciliationTable.organizationId,
        set: {
          cursor: encoded,
          updatedAt: new Date(),
        },
      });
  }

  async listProjectionPage(
    organizationId: string,
    afterId: string | undefined,
    updatedThrough: Date,
    limit: number,
  ): Promise<FindingTriageRecord[]> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    return this.db
      .select()
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          lte(findingTriageTable.updatedAt, updatedThrough),
          afterId ? gt(findingTriageTable.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(findingTriageTable.id))
      .limit(boundedLimit);
  }

  async getProjectionReconciliationState(
    organizationId: string,
  ): Promise<FindingProjectionReconciliationRecord | null> {
    const rows = await this.db
      .select()
      .from(findingProjectionReconciliationTable)
      .where(eq(findingProjectionReconciliationTable.organizationId, organizationId))
      .limit(1);
    return rows[0] ?? null;
  }

  async saveProjectionReconciliationState(
    input: SaveFindingProjectionReconciliationState,
  ): Promise<FindingProjectionReconciliationRecord> {
    const [record] = await this.db
      .insert(findingProjectionReconciliationTable)
      .values(input)
      .onConflictDoUpdate({
        target: findingProjectionReconciliationTable.organizationId,
        set: {
          cursor: input.cursor,
          cycleStartedAt: input.cycleStartedAt,
          cycleCutoff: input.cycleCutoff,
          checked: input.checked,
          repaired: input.repaired,
          failed: input.failed,
          lastCompletedAt: input.lastCompletedAt,
          reconciledThrough: input.reconciledThrough,
          updatedAt: new Date(),
        },
      })
      .returning();
    return record!;
  }

  async hasTriageRecords(organizationId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: findingTriageTable.id })
      .from(findingTriageTable)
      .where(eq(findingTriageTable.organizationId, organizationId))
      .limit(1);
    return rows.length > 0;
  }

  async hasAuthoritativeChangesAfter(
    organizationId: string,
    reconciledThrough: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: findingTriageTable.id })
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          gt(findingTriageTable.updatedAt, reconciledThrough),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private parseFindingObservationDiscoveryCursor(
    encoded: string,
  ): FindingObservationDiscoveryCursor {
    let value: unknown;
    try {
      value = JSON.parse(encoded);
    } catch {
      throw new Error('Stored finding observation discovery cursor is malformed');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Stored finding observation discovery cursor is malformed');
    }
    const cursor = value as Record<string, unknown>;
    if (typeof cursor.indexName !== 'string' || typeof cursor.organizationId !== 'string') {
      throw new Error('Stored finding observation discovery cursor is malformed');
    }
    const parsed = {
      indexName: cursor.indexName,
      organizationId: cursor.organizationId,
    };
    this.assertFindingObservationDiscoveryCursor(parsed);
    return parsed;
  }

  private assertFindingObservationDiscoveryCursor(cursor: FindingObservationDiscoveryCursor): void {
    if (buildFindingObservationIndexName(cursor.organizationId) !== cursor.indexName) {
      throw new Error('Finding observation discovery cursor does not match tenant identity');
    }
  }
}
