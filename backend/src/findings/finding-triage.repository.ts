import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  findingTriageTable,
  findingTriageEventsTable,
  type FindingTriageRecord,
  type FindingTriageEventRecord,
} from '../database/schema';
import type { FindingTriageStatus } from './dto/triage-update.dto';

@Injectable()
export class FindingTriageRepository {
  private readonly logger = new Logger(FindingTriageRepository.name);

  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

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

  async upsert(
    organizationId: string,
    findingOpensearchId: string,
    data: {
      status?: FindingTriageStatus;
      assigneeUserId?: string | null;
      severityOverride?: string | null;
      notes?: string | null;
    },
  ): Promise<FindingTriageRecord> {
    const now = new Date();
    const [record] = await this.db
      .insert(findingTriageTable)
      .values({
        organizationId,
        findingOpensearchId,
        status: data.status ?? 'new',
        assigneeUserId: data.assigneeUserId ?? null,
        severityOverride: data.severityOverride ?? null,
        notes: data.notes ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [findingTriageTable.organizationId, findingTriageTable.findingOpensearchId],
        set: {
          ...(data.status !== undefined && { status: data.status }),
          ...(data.assigneeUserId !== undefined && { assigneeUserId: data.assigneeUserId }),
          ...(data.severityOverride !== undefined && { severityOverride: data.severityOverride }),
          ...(data.notes !== undefined && { notes: data.notes }),
          updatedAt: now,
        },
      })
      .returning();

    return record!;
  }

  async addEvents(
    events: {
      findingTriageId: string;
      eventType: string;
      fieldChanged: string | null;
      oldValue: string | null;
      newValue: string | null;
      userId: string;
      comment: string | null;
    }[],
  ): Promise<void> {
    if (events.length === 0) return;
    await this.db.insert(findingTriageEventsTable).values(events);
  }

  async listEvents(findingTriageId: string, limit: number): Promise<FindingTriageEventRecord[]> {
    return this.db
      .select()
      .from(findingTriageEventsTable)
      .where(eq(findingTriageEventsTable.findingTriageId, findingTriageId))
      .orderBy(desc(findingTriageEventsTable.createdAt))
      .limit(limit);
  }

  async findByStatus(organizationId: string, statuses: FindingTriageStatus[]): Promise<string[]> {
    const records = await this.db
      .select({ findingOpensearchId: findingTriageTable.findingOpensearchId })
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          inArray(findingTriageTable.status, statuses),
        ),
      );

    return records.map((r) => r.findingOpensearchId);
  }

  async getAllTriagedIds(organizationId: string): Promise<string[]> {
    const MAX_TRIAGED_IDS = 10_000;
    const records = await this.db
      .select({ findingOpensearchId: findingTriageTable.findingOpensearchId })
      .from(findingTriageTable)
      .where(eq(findingTriageTable.organizationId, organizationId))
      .limit(MAX_TRIAGED_IDS);

    if (records.length === MAX_TRIAGED_IDS) {
      this.logger.warn(
        `getAllTriagedIds hit limit of ${MAX_TRIAGED_IDS} for org ${organizationId}`,
      );
    }

    return records.map((r) => r.findingOpensearchId);
  }
}
