import { Injectable, Logger } from '@nestjs/common';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { TriageAnalyticsRepository } from './triage-analytics.repository';
import type { AnalyticsPeriod } from './dto/triage-analytics.dto';
import { SEVERITY_VALUES, FINDING_TRIAGE_STATUSES } from './dto/triage-update.dto';
import type {
  PostureTrendResponse,
  TriageVelocityResponse,
  MttrResponse,
  SlaComplianceResponse,
  StatusDistributionResponse,
  TopAssigneesResponse,
} from '@sentris/shared';

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

@Injectable()
export class TriageAnalyticsService {
  private readonly logger = new Logger(TriageAnalyticsService.name);

  constructor(private readonly repository: TriageAnalyticsRepository) {}

  async getPostureTrend(auth: AuthContext, period: AnalyticsPeriod): Promise<PostureTrendResponse> {
    const organizationId = requireOrganizationId(auth);
    const startDate = this.periodToStartDate(period);

    const rows = await this.repository.getPostureTrend(organizationId, startDate);

    // Build a map of date -> severity counts
    const bucketMap = new Map<
      string,
      { critical: number; high: number; medium: number; low: number; info: number }
    >();

    for (const row of rows) {
      if (!bucketMap.has(row.day)) {
        bucketMap.set(row.day, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
      }
      const bucket = bucketMap.get(row.day)!;
      const sev = row.severity as keyof typeof bucket;
      if (sev in bucket) {
        bucket[sev] = row.count;
      }
    }

    // Fill empty days across the entire range
    const buckets = this.fillDateBuckets(startDate, bucketMap);

    return { buckets };
  }

  async getTriageVelocity(
    auth: AuthContext,
    period: AnalyticsPeriod,
  ): Promise<TriageVelocityResponse> {
    const organizationId = requireOrganizationId(auth);
    const startDate = this.periodToStartDate(period);

    const rows = await this.repository.getTriageVelocity(organizationId, startDate);

    const defaultStatuses = {
      new: 0,
      triaged: 0,
      in_progress: 0,
      fixed: 0,
      verified: 0,
      wont_fix: 0,
      accepted_risk: 0,
    };

    const bucketMap = new Map<string, typeof defaultStatuses>();

    for (const row of rows) {
      if (!bucketMap.has(row.day)) {
        bucketMap.set(row.day, { ...defaultStatuses });
      }
      const bucket = bucketMap.get(row.day)!;
      const status = row.status as keyof typeof bucket;
      if (status in bucket) {
        bucket[status] = row.count;
      }
    }

    // Fill empty days
    const days = PERIOD_DAYS[period];
    const buckets: TriageVelocityResponse['buckets'] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const existing = bucketMap.get(dateStr);
      buckets.push({
        date: dateStr,
        ...(existing ?? { ...defaultStatuses }),
      });
    }

    return { buckets };
  }

  async getMttr(auth: AuthContext, period: AnalyticsPeriod): Promise<MttrResponse> {
    const organizationId = requireOrganizationId(auth);
    const startDate = this.periodToStartDate(period);

    const rows = await this.repository.getMttr(organizationId, startDate);

    // Map results by severity and ensure all severities are represented
    const severityMap = new Map<string, { mttrSeconds: number | null; resolvedCount: number }>();
    for (const row of rows) {
      severityMap.set(row.severity, {
        mttrSeconds: row.mttrSeconds !== null ? Math.round(row.mttrSeconds) : null,
        resolvedCount: row.resolvedCount,
      });
    }

    const severities = SEVERITY_VALUES.map((sev) => ({
      severity: sev,
      mttrSeconds: severityMap.get(sev)?.mttrSeconds ?? null,
      resolvedCount: severityMap.get(sev)?.resolvedCount ?? 0,
    }));

    return { severities };
  }

  async getSlaCompliance(
    auth: AuthContext,
    period: AnalyticsPeriod,
  ): Promise<SlaComplianceResponse> {
    const organizationId = requireOrganizationId(auth);
    const startDate = this.periodToStartDate(period);

    const rows = await this.repository.getSlaCompliance(organizationId, startDate);

    const severityMap = new Map<
      string,
      { totalWithSla: number; metSla: number; missedSla: number }
    >();
    for (const row of rows) {
      severityMap.set(row.severity, {
        totalWithSla: row.totalWithSla,
        metSla: row.metSla,
        missedSla: row.missedSla,
      });
    }

    const severities = SEVERITY_VALUES.map((sev) => {
      const data = severityMap.get(sev);
      const totalWithSla = data?.totalWithSla ?? 0;
      return {
        severity: sev,
        totalWithSla,
        metSla: data?.metSla ?? 0,
        missedSla: data?.missedSla ?? 0,
        complianceRate:
          totalWithSla > 0 ? Math.round(((data?.metSla ?? 0) / totalWithSla) * 10000) / 100 : null,
      };
    });

    return { severities };
  }

  async getStatusDistribution(auth: AuthContext): Promise<StatusDistributionResponse> {
    const organizationId = requireOrganizationId(auth);

    const rows = await this.repository.getStatusDistribution(organizationId);

    // Ensure all statuses are represented
    const statusMap = new Map<string, number>();
    for (const row of rows) {
      statusMap.set(row.status, row.count);
    }

    let total = 0;
    const statuses = FINDING_TRIAGE_STATUSES.map((status) => {
      const count = statusMap.get(status) ?? 0;
      total += count;
      return { status, count };
    });

    return { statuses, total };
  }

  async getTopAssignees(auth: AuthContext, limit: number): Promise<TopAssigneesResponse> {
    const organizationId = requireOrganizationId(auth);

    const rows = await this.repository.getTopAssignees(organizationId, limit);

    const assignees = rows.map((row) => ({
      userId: row.userId,
      totalCount: row.totalCount,
      resolvedCount: row.resolvedCount,
      resolutionRate:
        row.totalCount > 0 ? Math.round((row.resolvedCount / row.totalCount) * 10000) / 100 : null,
    }));

    return { assignees };
  }

  /**
   * Convert an analytics period string to a start date.
   */
  private periodToStartDate(period: AnalyticsPeriod): Date {
    const days = PERIOD_DAYS[period];
    return new Date(Date.now() - days * 86_400_000);
  }

  /**
   * Fill in empty date buckets between startDate and today with zero counts.
   */
  private fillDateBuckets(
    startDate: Date,
    bucketMap: Map<
      string,
      { critical: number; high: number; medium: number; low: number; info: number }
    >,
  ): PostureTrendResponse['buckets'] {
    const buckets: PostureTrendResponse['buckets'] = [];
    const now = new Date();
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);

    while (current <= now) {
      const dateStr = current.toISOString().slice(0, 10);
      const existing = bucketMap.get(dateStr);
      buckets.push({
        date: dateStr,
        critical: existing?.critical ?? 0,
        high: existing?.high ?? 0,
        medium: existing?.medium ?? 0,
        low: existing?.low ?? 0,
        info: existing?.info ?? 0,
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return buckets;
  }
}
