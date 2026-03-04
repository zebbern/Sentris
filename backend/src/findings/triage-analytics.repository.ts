import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { findingTriageTable, findingTriageEventsTable } from '../database/schema';

const TERMINAL_STATUSES = ['fixed', 'verified', 'wont_fix', 'accepted_risk'] as const;

interface PostureRow {
  day: string;
  severity: string;
  count: number;
}

interface VelocityRow {
  day: string;
  status: string;
  count: number;
}

interface MttrRow {
  severity: string;
  mttrSeconds: number | null;
  resolvedCount: number;
}

interface SlaComplianceRow {
  severity: string;
  totalWithSla: number;
  metSla: number;
  missedSla: number;
}

interface StatusDistributionRow {
  status: string;
  count: number;
}

interface TopAssigneeRow {
  userId: string | null;
  totalCount: number;
  resolvedCount: number;
}

@Injectable()
export class TriageAnalyticsRepository {
  private readonly logger = new Logger(TriageAnalyticsRepository.name);

  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

  /**
   * Count findings created per day, grouped by severity.
   * Null severityOverride is bucketed as 'info'.
   */
  async getPostureTrend(organizationId: string, startDate: Date): Promise<PostureRow[]> {
    const rows = await this.db
      .select({
        day: sql<string>`date_trunc('day', ${findingTriageTable.createdAt})::date::text`,
        severity: sql<string>`COALESCE(${findingTriageTable.severityOverride}, 'info')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          gte(findingTriageTable.createdAt, startDate),
        ),
      )
      .groupBy(
        sql`date_trunc('day', ${findingTriageTable.createdAt})::date`,
        sql`COALESCE(${findingTriageTable.severityOverride}, 'info')`,
      )
      .orderBy(sql`date_trunc('day', ${findingTriageTable.createdAt})::date`)
      .limit(366);

    return rows;
  }

  /**
   * Count triage status-change events per day, grouped by resulting status.
   * JOINs through finding_triage for org scoping.
   */
  async getTriageVelocity(organizationId: string, startDate: Date): Promise<VelocityRow[]> {
    const rows = await this.db
      .select({
        day: sql<string>`date_trunc('day', ${findingTriageEventsTable.createdAt})::date::text`,
        status: sql<string>`${findingTriageEventsTable.newValue}`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(findingTriageEventsTable)
      .innerJoin(
        findingTriageTable,
        eq(findingTriageEventsTable.findingTriageId, findingTriageTable.id),
      )
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          eq(findingTriageEventsTable.fieldChanged, 'status'),
          gte(findingTriageEventsTable.createdAt, startDate),
        ),
      )
      .groupBy(
        sql`date_trunc('day', ${findingTriageEventsTable.createdAt})::date`,
        findingTriageEventsTable.newValue,
      )
      .orderBy(sql`date_trunc('day', ${findingTriageEventsTable.createdAt})::date`)
      .limit(366);

    return rows;
  }

  /**
   * Calculate Mean Time to Remediate per severity.
   * MTTR = average(updated_at - created_at) for findings in terminal status.
   */
  async getMttr(organizationId: string, startDate: Date): Promise<MttrRow[]> {
    const rows = await this.db
      .select({
        severity: sql<string>`COALESCE(${findingTriageTable.severityOverride}, 'info')`,
        mttrSeconds: sql<
          number | null
        >`EXTRACT(EPOCH FROM AVG(${findingTriageTable.updatedAt} - ${findingTriageTable.createdAt}))::double precision`,
        resolvedCount: sql<number>`COUNT(*)::int`,
      })
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          inArray(findingTriageTable.status, [...TERMINAL_STATUSES]),
          gte(findingTriageTable.updatedAt, startDate),
        ),
      )
      .groupBy(sql`COALESCE(${findingTriageTable.severityOverride}, 'info')`)
      .limit(10);

    return rows;
  }

  /**
   * SLA compliance per severity.
   * Only counts findings with a sla_deadline that have reached a terminal status.
   * Met SLA = updated_at <= sla_deadline.
   */
  async getSlaCompliance(organizationId: string, startDate: Date): Promise<SlaComplianceRow[]> {
    const rows = await this.db
      .select({
        severity: sql<string>`COALESCE(${findingTriageTable.severityOverride}, 'info')`,
        totalWithSla: sql<number>`COUNT(*)::int`,
        metSla: sql<number>`SUM(CASE WHEN ${findingTriageTable.updatedAt} <= ${findingTriageTable.slaDeadline} THEN 1 ELSE 0 END)::int`,
        missedSla: sql<number>`SUM(CASE WHEN ${findingTriageTable.updatedAt} > ${findingTriageTable.slaDeadline} THEN 1 ELSE 0 END)::int`,
      })
      .from(findingTriageTable)
      .where(
        and(
          eq(findingTriageTable.organizationId, organizationId),
          inArray(findingTriageTable.status, [...TERMINAL_STATUSES]),
          sql`${findingTriageTable.slaDeadline} IS NOT NULL`,
          gte(findingTriageTable.updatedAt, startDate),
        ),
      )
      .groupBy(sql`COALESCE(${findingTriageTable.severityOverride}, 'info')`)
      .limit(10);

    return rows;
  }

  /**
   * Current status distribution (no time filter).
   */
  async getStatusDistribution(organizationId: string): Promise<StatusDistributionRow[]> {
    const rows = await this.db
      .select({
        status: sql<string>`${findingTriageTable.status}`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(findingTriageTable)
      .where(eq(findingTriageTable.organizationId, organizationId))
      .groupBy(findingTriageTable.status)
      .limit(10);

    return rows;
  }

  /**
   * Top assignees by total assigned findings, with resolved count.
   */
  async getTopAssignees(organizationId: string, limit: number): Promise<TopAssigneeRow[]> {
    const rows = await this.db
      .select({
        userId: sql<string | null>`${findingTriageTable.assigneeUserId}`,
        totalCount: sql<number>`COUNT(*)::int`,
        resolvedCount: sql<number>`SUM(CASE WHEN ${findingTriageTable.status} IN (${sql.join(
          TERMINAL_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}) THEN 1 ELSE 0 END)::int`,
      })
      .from(findingTriageTable)
      .where(eq(findingTriageTable.organizationId, organizationId))
      .groupBy(findingTriageTable.assigneeUserId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit);

    return rows;
  }
}
