import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { TriageAnalyticsRepository } from '../triage-analytics.repository';
import { TriageAnalyticsService } from '../triage-analytics.service';

// ---------------------------------------------------------------------------
// Auth fixtures
// ---------------------------------------------------------------------------

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'test',
  isAuthenticated: true,
};

const AUTH_NO_ORG: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  provider: 'test',
  isAuthenticated: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TriageAnalyticsService', () => {
  let service: TriageAnalyticsService;
  let repoMock: {
    getPostureTrend: ReturnType<typeof mock>;
    getTriageVelocity: ReturnType<typeof mock>;
    getMttr: ReturnType<typeof mock>;
    getSlaCompliance: ReturnType<typeof mock>;
    getStatusDistribution: ReturnType<typeof mock>;
    getTopAssignees: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    repoMock = {
      getPostureTrend: mock(() => Promise.resolve([])),
      getTriageVelocity: mock(() => Promise.resolve([])),
      getMttr: mock(() => Promise.resolve([])),
      getSlaCompliance: mock(() => Promise.resolve([])),
      getStatusDistribution: mock(() => Promise.resolve([])),
      getTopAssignees: mock(() => Promise.resolve([])),
    };

    service = new TriageAnalyticsService(repoMock as unknown as TriageAnalyticsRepository);
  });

  // -----------------------------------------------------------------------
  // getPostureTrend
  // -----------------------------------------------------------------------

  describe('getPostureTrend', () => {
    it('returns correctly bucketed data by severity and date', async () => {
      repoMock.getPostureTrend.mockReturnValue(
        Promise.resolve([
          { day: '2026-03-01', severity: 'critical', count: 5 },
          { day: '2026-03-01', severity: 'high', count: 3 },
          { day: '2026-03-02', severity: 'medium', count: 2 },
        ]),
      );

      const result = await service.getPostureTrend(AUTH, '7d');

      expect(result.buckets).toBeDefined();
      expect(Array.isArray(result.buckets)).toBe(true);

      const march1 = result.buckets.find((b) => b.date === '2026-03-01');
      if (march1) {
        expect(march1.critical).toBe(5);
        expect(march1.high).toBe(3);
        expect(march1.medium).toBe(0);
        expect(march1.low).toBe(0);
        expect(march1.info).toBe(0);
      }

      const march2 = result.buckets.find((b) => b.date === '2026-03-02');
      if (march2) {
        expect(march2.critical).toBe(0);
        expect(march2.medium).toBe(2);
      }
    });

    it('fills empty date buckets with zeros', async () => {
      repoMock.getPostureTrend.mockReturnValue(Promise.resolve([]));

      const result = await service.getPostureTrend(AUTH, '7d');

      // With 7d period, we should have at least 7 buckets
      expect(result.buckets.length).toBeGreaterThanOrEqual(7);

      // All buckets should have zero values
      for (const bucket of result.buckets) {
        expect(bucket.date).toBeDefined();
        expect(bucket.critical).toBe(0);
        expect(bucket.high).toBe(0);
        expect(bucket.medium).toBe(0);
        expect(bucket.low).toBe(0);
        expect(bucket.info).toBe(0);
      }
    });

    it('calls repository with correct organizationId and startDate', async () => {
      await service.getPostureTrend(AUTH, '30d');

      expect(repoMock.getPostureTrend).toHaveBeenCalledTimes(1);
      const [orgId, startDate] = repoMock.getPostureTrend.mock.calls[0]!;
      expect(orgId).toBe('org-1');
      expect(startDate).toBeInstanceOf(Date);

      // 30 days ago should be roughly 30 * 86400 * 1000 ms in the past
      const expectedMs = Date.now() - 30 * 86_400_000;
      expect(Math.abs(startDate.getTime() - expectedMs)).toBeLessThan(1000);
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getPostureTrend(AUTH_NO_ORG, '7d')).rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // getTriageVelocity
  // -----------------------------------------------------------------------

  describe('getTriageVelocity', () => {
    it('groups events by status and date', async () => {
      repoMock.getTriageVelocity.mockReturnValue(
        Promise.resolve([
          { day: '2026-03-01', status: 'triaged', count: 4 },
          { day: '2026-03-01', status: 'fixed', count: 2 },
          { day: '2026-03-02', status: 'in_progress', count: 1 },
        ]),
      );

      const result = await service.getTriageVelocity(AUTH, '7d');

      expect(result.buckets).toBeDefined();
      const march1 = result.buckets.find((b) => b.date === '2026-03-01');
      if (march1) {
        expect(march1.triaged).toBe(4);
        expect(march1.fixed).toBe(2);
        expect(march1.new).toBe(0);
        expect(march1.in_progress).toBe(0);
      }

      const march2 = result.buckets.find((b) => b.date === '2026-03-02');
      if (march2) {
        expect(march2.in_progress).toBe(1);
        expect(march2.triaged).toBe(0);
      }
    });

    it('fills empty days with zero status counts', async () => {
      repoMock.getTriageVelocity.mockReturnValue(Promise.resolve([]));

      const result = await service.getTriageVelocity(AUTH, '7d');

      expect(result.buckets.length).toBe(7);
      for (const bucket of result.buckets) {
        expect(bucket.new).toBe(0);
        expect(bucket.triaged).toBe(0);
        expect(bucket.in_progress).toBe(0);
        expect(bucket.fixed).toBe(0);
        expect(bucket.verified).toBe(0);
        expect(bucket.wont_fix).toBe(0);
        expect(bucket.accepted_risk).toBe(0);
      }
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getTriageVelocity(AUTH_NO_ORG, '30d')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // getMttr
  // -----------------------------------------------------------------------

  describe('getMttr', () => {
    it('calculates correct MTTR per severity', async () => {
      repoMock.getMttr.mockReturnValue(
        Promise.resolve([
          { severity: 'critical', mttrSeconds: 3600.5, resolvedCount: 10 },
          { severity: 'high', mttrSeconds: 7200.2, resolvedCount: 5 },
        ]),
      );

      const result = await service.getMttr(AUTH, '30d');

      expect(result.severities).toHaveLength(5); // All 5 severities represented
      const critical = result.severities.find((s) => s.severity === 'critical');
      expect(critical).toBeDefined();
      expect(critical!.mttrSeconds).toBe(3601); // Rounded
      expect(critical!.resolvedCount).toBe(10);

      const high = result.severities.find((s) => s.severity === 'high');
      expect(high!.mttrSeconds).toBe(7200); // Rounded
      expect(high!.resolvedCount).toBe(5);
    });

    it('returns null mttrSeconds when no resolved findings exist for a severity', async () => {
      repoMock.getMttr.mockReturnValue(Promise.resolve([]));

      const result = await service.getMttr(AUTH, '30d');

      expect(result.severities).toHaveLength(5);
      for (const sev of result.severities) {
        expect(sev.mttrSeconds).toBeNull();
        expect(sev.resolvedCount).toBe(0);
      }
    });

    it('ensures all severity levels are represented in output', async () => {
      repoMock.getMttr.mockReturnValue(
        Promise.resolve([{ severity: 'info', mttrSeconds: 100, resolvedCount: 1 }]),
      );

      const result = await service.getMttr(AUTH, '7d');

      const severityNames = result.severities.map((s) => s.severity);
      expect(severityNames).toContain('critical');
      expect(severityNames).toContain('high');
      expect(severityNames).toContain('medium');
      expect(severityNames).toContain('low');
      expect(severityNames).toContain('info');
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getMttr(AUTH_NO_ORG, '7d')).rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // getSlaCompliance
  // -----------------------------------------------------------------------

  describe('getSlaCompliance', () => {
    it('correctly categorizes findings as met/missed SLA', async () => {
      repoMock.getSlaCompliance.mockReturnValue(
        Promise.resolve([
          { severity: 'critical', totalWithSla: 10, metSla: 7, missedSla: 3 },
          { severity: 'high', totalWithSla: 20, metSla: 18, missedSla: 2 },
        ]),
      );

      const result = await service.getSlaCompliance(AUTH, '30d');

      expect(result.severities).toHaveLength(5);

      const critical = result.severities.find((s) => s.severity === 'critical');
      expect(critical!.totalWithSla).toBe(10);
      expect(critical!.metSla).toBe(7);
      expect(critical!.missedSla).toBe(3);
      expect(critical!.complianceRate).toBe(70); // (7/10)*100 rounded to 2 decimals
    });

    it('calculates complianceRate with 2-decimal precision', async () => {
      repoMock.getSlaCompliance.mockReturnValue(
        Promise.resolve([{ severity: 'medium', totalWithSla: 3, metSla: 1, missedSla: 2 }]),
      );

      const result = await service.getSlaCompliance(AUTH, '30d');

      const medium = result.severities.find((s) => s.severity === 'medium');
      // 1/3 * 100 = 33.33... → Math.round(3333.33) / 100 = 33.33
      expect(medium!.complianceRate).toBe(33.33);
    });

    it('returns null complianceRate when no findings have SLA deadlines', async () => {
      repoMock.getSlaCompliance.mockReturnValue(Promise.resolve([]));

      const result = await service.getSlaCompliance(AUTH, '30d');

      for (const sev of result.severities) {
        expect(sev.totalWithSla).toBe(0);
        expect(sev.complianceRate).toBeNull();
      }
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getSlaCompliance(AUTH_NO_ORG, '30d')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // getStatusDistribution
  // -----------------------------------------------------------------------

  describe('getStatusDistribution', () => {
    it('returns counts for all statuses', async () => {
      repoMock.getStatusDistribution.mockReturnValue(
        Promise.resolve([
          { status: 'new', count: 10 },
          { status: 'triaged', count: 5 },
          { status: 'fixed', count: 3 },
        ]),
      );

      const result = await service.getStatusDistribution(AUTH);

      expect(result.statuses).toHaveLength(7); // All 7 statuses
      expect(result.total).toBe(18); // 10 + 5 + 3

      const newStatus = result.statuses.find((s) => s.status === 'new');
      expect(newStatus!.count).toBe(10);

      const inProgress = result.statuses.find((s) => s.status === 'in_progress');
      expect(inProgress!.count).toBe(0);
    });

    it('returns all zero counts when no findings exist', async () => {
      repoMock.getStatusDistribution.mockReturnValue(Promise.resolve([]));

      const result = await service.getStatusDistribution(AUTH);

      expect(result.total).toBe(0);
      for (const status of result.statuses) {
        expect(status.count).toBe(0);
      }
    });

    it('includes all 7 triage statuses', async () => {
      repoMock.getStatusDistribution.mockReturnValue(Promise.resolve([]));

      const result = await service.getStatusDistribution(AUTH);

      const statusNames = result.statuses.map((s) => s.status);
      expect(statusNames).toEqual([
        'new',
        'triaged',
        'in_progress',
        'fixed',
        'verified',
        'wont_fix',
        'accepted_risk',
      ]);
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getStatusDistribution(AUTH_NO_ORG)).rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // getTopAssignees
  // -----------------------------------------------------------------------

  describe('getTopAssignees', () => {
    it('returns assignees with calculated resolution rate', async () => {
      repoMock.getTopAssignees.mockReturnValue(
        Promise.resolve([
          { userId: 'user-1', totalCount: 20, resolvedCount: 15 },
          { userId: 'user-2', totalCount: 10, resolvedCount: 3 },
        ]),
      );

      const result = await service.getTopAssignees(AUTH, 10);

      expect(result.assignees).toHaveLength(2);
      expect(result.assignees[0]!.userId).toBe('user-1');
      expect(result.assignees[0]!.totalCount).toBe(20);
      expect(result.assignees[0]!.resolvedCount).toBe(15);
      expect(result.assignees[0]!.resolutionRate).toBe(75); // 15/20 * 100

      expect(result.assignees[1]!.resolutionRate).toBe(30); // 3/10 * 100
    });

    it('includes unassigned (null userId) findings', async () => {
      repoMock.getTopAssignees.mockReturnValue(
        Promise.resolve([
          { userId: null, totalCount: 15, resolvedCount: 5 },
          { userId: 'user-1', totalCount: 10, resolvedCount: 8 },
        ]),
      );

      const result = await service.getTopAssignees(AUTH, 10);

      expect(result.assignees).toHaveLength(2);
      expect(result.assignees[0]!.userId).toBeNull();
      expect(result.assignees[0]!.totalCount).toBe(15);
      expect(result.assignees[0]!.resolutionRate).toBe(33.33); // 5/15 * 100
    });

    it('returns null resolutionRate when totalCount is 0', async () => {
      repoMock.getTopAssignees.mockReturnValue(
        Promise.resolve([{ userId: 'user-1', totalCount: 0, resolvedCount: 0 }]),
      );

      const result = await service.getTopAssignees(AUTH, 10);

      expect(result.assignees[0]!.resolutionRate).toBeNull();
    });

    it('passes limit to repository', async () => {
      await service.getTopAssignees(AUTH, 5);

      expect(repoMock.getTopAssignees).toHaveBeenCalledTimes(1);
      const [orgId, limit] = repoMock.getTopAssignees.mock.calls[0]!;
      expect(orgId).toBe('org-1');
      expect(limit).toBe(5);
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getTopAssignees(AUTH_NO_ORG, 10)).rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // periodToStartDate (tested indirectly)
  // -----------------------------------------------------------------------

  describe('periodToStartDate (via getPostureTrend)', () => {
    it('returns correct start date for 7d period', async () => {
      await service.getPostureTrend(AUTH, '7d');

      const [, startDate] = repoMock.getPostureTrend.mock.calls[0]!;
      const expectedMs = Date.now() - 7 * 86_400_000;
      expect(Math.abs((startDate as Date).getTime() - expectedMs)).toBeLessThan(1000);
    });

    it('returns correct start date for 30d period', async () => {
      await service.getPostureTrend(AUTH, '30d');

      const [, startDate] = repoMock.getPostureTrend.mock.calls[0]!;
      const expectedMs = Date.now() - 30 * 86_400_000;
      expect(Math.abs((startDate as Date).getTime() - expectedMs)).toBeLessThan(1000);
    });

    it('returns correct start date for 90d period', async () => {
      await service.getPostureTrend(AUTH, '90d');

      const [, startDate] = repoMock.getPostureTrend.mock.calls[0]!;
      const expectedMs = Date.now() - 90 * 86_400_000;
      expect(Math.abs((startDate as Date).getTime() - expectedMs)).toBeLessThan(1000);
    });
  });
});
