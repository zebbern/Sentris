import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { FindingTriageRecord, FindingTriageEventRecord } from '../../database/schema';
import type { FindingTriageRepository } from '../finding-triage.repository';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { SecurityAnalyticsService } from '../../analytics/security-analytics.service';
import type { OrgMembersService } from '../../org/org-members.service';
import { FindingTriageService } from '../finding-triage.service';

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
// Record factories
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeTriageRecord(overrides: Partial<FindingTriageRecord> = {}): FindingTriageRecord {
  const now = new Date();
  return {
    id: overrides.id ?? `triage-${++idCounter}`,
    organizationId: overrides.organizationId ?? 'org-1',
    findingOpensearchId: overrides.findingOpensearchId ?? `finding-${idCounter}`,
    status: overrides.status ?? 'new',
    assigneeUserId: overrides.assigneeUserId ?? null,
    severityOverride: overrides.severityOverride ?? null,
    notes: overrides.notes ?? null,
    slaDeadline: overrides.slaDeadline ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeEventRecord(
  overrides: Partial<FindingTriageEventRecord> = {},
): FindingTriageEventRecord {
  const now = new Date();
  return {
    id: overrides.id ?? `event-${++idCounter}`,
    findingTriageId: overrides.findingTriageId ?? 'triage-1',
    eventType: overrides.eventType ?? 'status_change',
    fieldChanged: overrides.fieldChanged ?? 'status',
    oldValue: overrides.oldValue ?? null,
    newValue: overrides.newValue ?? null,
    userId: overrides.userId ?? 'user-1',
    comment: overrides.comment ?? null,
    createdAt: overrides.createdAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindingTriageService', () => {
  let service: FindingTriageService;
  let repoMock: {
    findByOrgAndFindingId: ReturnType<typeof mock>;
    findByIds: ReturnType<typeof mock>;
    upsert: ReturnType<typeof mock>;
    addEvents: ReturnType<typeof mock>;
    listEvents: ReturnType<typeof mock>;
    findByStatus: ReturnType<typeof mock>;
    getAllTriagedIds: ReturnType<typeof mock>;
  };
  let auditCalls: unknown[][];
  let analyticsQueryMock: ReturnType<typeof mock>;
  let analyticsAvailableMock: ReturnType<typeof mock>;
  let orgMembersListMock: ReturnType<typeof mock>;

  beforeEach(() => {
    idCounter = 0;
    auditCalls = [];

    repoMock = {
      findByOrgAndFindingId: mock(() => Promise.resolve(null)),
      findByIds: mock(() => Promise.resolve([])),
      upsert: mock(() =>
        Promise.resolve(makeTriageRecord({ id: 'triage-upserted', findingOpensearchId: 'f-1' })),
      ),
      addEvents: mock(() => Promise.resolve()),
      listEvents: mock(() => Promise.resolve([])),
      findByStatus: mock(() => Promise.resolve([])),
      getAllTriagedIds: mock(() => Promise.resolve([])),
    };

    analyticsQueryMock = mock(() => Promise.resolve({ total: 1, items: [] }));
    analyticsAvailableMock = mock(() => true);
    orgMembersListMock = mock(() => Promise.resolve([{ userId: 'user-1' }, { userId: 'user-2' }]));

    const auditLogService = {
      record: (...args: unknown[]) => {
        auditCalls.push(args);
      },
    };

    const securityAnalyticsService = {
      isAvailable: analyticsAvailableMock,
      query: analyticsQueryMock,
    };

    const orgMembersService = {
      listMembers: orgMembersListMock,
    };

    service = new FindingTriageService(
      repoMock as unknown as FindingTriageRepository,
      auditLogService as unknown as AuditLogService,
      securityAnalyticsService as unknown as SecurityAnalyticsService,
      orgMembersService as unknown as OrgMembersService,
    );
  });

  // -----------------------------------------------------------------------
  // upsertTriage
  // -----------------------------------------------------------------------

  describe('upsertTriage', () => {
    it('creates a new record for a finding without existing triage', async () => {
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(null));

      const result = await service.upsertTriage(AUTH, 'f-1', { status: 'triaged' });

      expect(repoMock.upsert).toHaveBeenCalledTimes(1);
      expect(result.findingOpensearchId).toBe('f-1');
      expect(result.status).toBeDefined();
    });

    it('updates an existing record without duplicating', async () => {
      const existing = makeTriageRecord({
        id: 'triage-existing',
        findingOpensearchId: 'f-1',
        status: 'new',
      });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(existing));
      repoMock.upsert.mockReturnValue(
        Promise.resolve(makeTriageRecord({ id: 'triage-existing', status: 'triaged' })),
      );

      const result = await service.upsertTriage(AUTH, 'f-1', { status: 'triaged' });

      expect(repoMock.upsert).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('triage-existing');
    });

    it('validates status transition and rejects invalid ones', async () => {
      const existing = makeTriageRecord({
        findingOpensearchId: 'f-1',
        status: 'new',
      });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(existing));

      await expect(service.upsertTriage(AUTH, 'f-1', { status: 'fixed' })).rejects.toThrow(
        UnprocessableEntityException,
      );

      // Verify the record was NOT modified
      expect(repoMock.upsert).not.toHaveBeenCalled();
    });

    it('includes currentStatus and validTransitions in error for invalid transition', async () => {
      const existing = makeTriageRecord({
        findingOpensearchId: 'f-1',
        status: 'new',
      });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(existing));

      try {
        await service.upsertTriage(AUTH, 'f-1', { status: 'verified' });
        expect(true).toBe(false); // Should not reach here
      } catch (err: any) {
        const response = err.getResponse();
        expect(response.currentStatus).toBe('new');
        expect(response.validTransitions).toEqual(['triaged', 'wont_fix', 'accepted_risk']);
      }
    });

    it('creates a status_change event when status changes', async () => {
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(null));
      repoMock.upsert.mockReturnValue(
        Promise.resolve(makeTriageRecord({ id: 'triage-1', status: 'triaged' })),
      );

      await service.upsertTriage(AUTH, 'f-1', { status: 'triaged' });

      expect(repoMock.addEvents).toHaveBeenCalledTimes(1);
      const events = repoMock.addEvents.mock.calls[0]![0] as any[];
      const statusEvent = events.find((e: any) => e.eventType === 'status_change');
      expect(statusEvent).toBeDefined();
      expect(statusEvent.fieldChanged).toBe('status');
      expect(statusEvent.oldValue).toBe('new');
      expect(statusEvent.newValue).toBe('triaged');
      expect(statusEvent.userId).toBe('user-1');
    });

    it('creates an assignment_change event when assignee changes', async () => {
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(null));
      repoMock.upsert.mockReturnValue(
        Promise.resolve(makeTriageRecord({ id: 'triage-1', assigneeUserId: 'user-2' })),
      );

      await service.upsertTriage(AUTH, 'f-1', { assigneeUserId: 'user-2' });

      expect(repoMock.addEvents).toHaveBeenCalledTimes(1);
      const events = repoMock.addEvents.mock.calls[0]![0] as any[];
      const assignEvent = events.find((e: any) => e.eventType === 'assignment_change');
      expect(assignEvent).toBeDefined();
      expect(assignEvent.fieldChanged).toBe('assignee_user_id');
      expect(assignEvent.oldValue).toBeNull();
      expect(assignEvent.newValue).toBe('user-2');
    });

    it('does not create events when no fields actually changed', async () => {
      const existing = makeTriageRecord({
        findingOpensearchId: 'f-1',
        status: 'triaged',
        assigneeUserId: 'user-2',
      });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(existing));
      repoMock.upsert.mockReturnValue(Promise.resolve(existing));

      await service.upsertTriage(AUTH, 'f-1', {
        status: 'triaged',
        assigneeUserId: 'user-2',
      });

      // Same values, so no events should be created
      expect(repoMock.addEvents).not.toHaveBeenCalled();
    });

    it('records audit log for the action', async () => {
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(null));
      repoMock.upsert.mockReturnValue(
        Promise.resolve(makeTriageRecord({ id: 'triage-1', status: 'triaged' })),
      );

      await service.upsertTriage(AUTH, 'f-1', { status: 'triaged' });

      expect(auditCalls.length).toBe(1);
      const [authArg, auditData] = auditCalls[0]!;
      expect(authArg).toBe(AUTH);
      expect((auditData as any).action).toBe('findings.triage');
      expect((auditData as any).resourceType).toBe('finding_triage');
      expect((auditData as any).resourceId).toBe('f-1');
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.upsertTriage(AUTH_NO_ORG, 'f-1', { status: 'triaged' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when finding does not exist in OpenSearch', async () => {
      analyticsQueryMock.mockReturnValue(Promise.resolve({ total: 0, items: [] }));

      await expect(
        service.upsertTriage(AUTH, 'f-nonexistent', { status: 'triaged' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows non-status-only updates (e.g., notes) without transition validation', async () => {
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(null));
      repoMock.upsert.mockReturnValue(
        Promise.resolve(makeTriageRecord({ id: 'triage-1', notes: 'Some note' })),
      );

      const result = await service.upsertTriage(AUTH, 'f-1', { notes: 'Some note' });
      expect(result).toBeDefined();
      expect(repoMock.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // bulkTriage
  // -----------------------------------------------------------------------

  describe('bulkTriage', () => {
    it('processes multiple findings and returns per-finding results', async () => {
      const ids = ['f-1', 'f-2', 'f-3'];
      repoMock.findByIds.mockReturnValue(Promise.resolve([]));
      repoMock.upsert.mockImplementation((_org: string, findingId: string) =>
        Promise.resolve(makeTriageRecord({ findingOpensearchId: findingId, status: 'triaged' })),
      );

      const result = await service.bulkTriage(AUTH, ids, { status: 'triaged' });

      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.success)).toBe(true);
    });

    it('skips findings with invalid transitions and succeeds for valid ones', async () => {
      const existingVerified = makeTriageRecord({
        findingOpensearchId: 'f-2',
        status: 'verified',
      });
      repoMock.findByIds.mockReturnValue(Promise.resolve([existingVerified]));
      repoMock.upsert.mockImplementation((_org: string, findingId: string) =>
        Promise.resolve(makeTriageRecord({ findingOpensearchId: findingId, status: 'triaged' })),
      );

      const result = await service.bulkTriage(AUTH, ['f-1', 'f-2', 'f-3'], {
        status: 'triaged',
      });

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      const failedResult = result.results.find((r) => r.findingId === 'f-2');
      expect(failedResult?.success).toBe(false);
      expect(failedResult?.error).toContain('Invalid transition');
    });

    it('creates events for all successful updates', async () => {
      repoMock.findByIds.mockReturnValue(Promise.resolve([]));
      repoMock.upsert.mockImplementation((_org: string, findingId: string) =>
        Promise.resolve(
          makeTriageRecord({
            id: `triage-${findingId}`,
            findingOpensearchId: findingId,
            status: 'triaged',
          }),
        ),
      );

      await service.bulkTriage(AUTH, ['f-1', 'f-2'], { status: 'triaged' });

      expect(repoMock.addEvents).toHaveBeenCalledTimes(1);
      const events = repoMock.addEvents.mock.calls[0]![0] as any[];
      expect(events).toHaveLength(2); // one status_change event per finding
    });

    it('records audit log with bulk_triage action', async () => {
      repoMock.findByIds.mockReturnValue(Promise.resolve([]));
      repoMock.upsert.mockImplementation((_org: string, findingId: string) =>
        Promise.resolve(makeTriageRecord({ findingOpensearchId: findingId })),
      );

      await service.bulkTriage(AUTH, ['f-1'], { status: 'triaged' });

      expect(auditCalls.length).toBe(1);
      const [, auditData] = auditCalls[0]!;
      expect((auditData as any).action).toBe('findings.bulk_triage');
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.bulkTriage(AUTH_NO_ORG, ['f-1'], { status: 'triaged' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // getHistory
  // -----------------------------------------------------------------------

  describe('getHistory', () => {
    it('returns events in descending chronological order', async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 60_000);
      const triageRecord = makeTriageRecord({ id: 'triage-1' });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(triageRecord));

      const events = [
        makeEventRecord({ id: 'e-2', createdAt: now, newValue: 'in_progress' }),
        makeEventRecord({ id: 'e-1', createdAt: earlier, newValue: 'triaged' }),
      ];
      repoMock.listEvents.mockReturnValue(Promise.resolve(events));

      const result = await service.getHistory(AUTH, 'f-1', 50);

      expect(result.events).toHaveLength(2);
      expect(result.events[0]!.id).toBe('e-2');
      expect(result.events[1]!.id).toBe('e-1');
    });

    it('returns empty events array for finding with no triage record', async () => {
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(null));

      const result = await service.getHistory(AUTH, 'f-nonexistent', 50);

      expect(result.events).toEqual([]);
    });

    it('respects the limit parameter', async () => {
      const triageRecord = makeTriageRecord({ id: 'triage-1' });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(triageRecord));
      repoMock.listEvents.mockReturnValue(Promise.resolve([]));

      await service.getHistory(AUTH, 'f-1', 10);

      expect(repoMock.listEvents).toHaveBeenCalledWith('triage-1', 10);
    });

    it('serializes event createdAt to ISO string', async () => {
      const date = new Date('2026-03-04T12:00:00Z');
      const triageRecord = makeTriageRecord({ id: 'triage-1' });
      repoMock.findByOrgAndFindingId.mockReturnValue(Promise.resolve(triageRecord));
      repoMock.listEvents.mockReturnValue(Promise.resolve([makeEventRecord({ createdAt: date })]));

      const result = await service.getHistory(AUTH, 'f-1', 50);

      expect(result.events[0]!.createdAt).toBe('2026-03-04T12:00:00.000Z');
    });
  });

  // -----------------------------------------------------------------------
  // enrichWithTriageState
  // -----------------------------------------------------------------------

  describe('enrichWithTriageState', () => {
    it('merges triage data into finding items', async () => {
      const triageRecord = makeTriageRecord({
        findingOpensearchId: 'f-1',
        status: 'triaged',
        assigneeUserId: 'user-2',
        severityOverride: 'high',
        notes: 'Test note',
      });
      repoMock.findByIds.mockReturnValue(Promise.resolve([triageRecord]));

      const items = [
        { id: 'f-1', name: 'Finding 1' },
        { id: 'f-2', name: 'Finding 2' },
      ];

      const enriched = await service.enrichWithTriageState('org-1', items);

      expect(enriched).toHaveLength(2);
      expect(enriched[0]!.triage).not.toBeNull();
      expect(enriched[0]!.triage!.status).toBe('triaged');
      expect(enriched[0]!.triage!.assigneeUserId).toBe('user-2');
      expect(enriched[0]!.triage!.severityOverride).toBe('high');
      expect(enriched[0]!.triage!.notes).toBe('Test note');
    });

    it('returns null triage for findings without triage records', async () => {
      repoMock.findByIds.mockReturnValue(Promise.resolve([]));

      const items = [{ id: 'f-1', name: 'Finding 1' }];
      const enriched = await service.enrichWithTriageState('org-1', items);

      expect(enriched[0]!.triage).toBeNull();
    });

    it('returns empty array for empty input', async () => {
      const enriched = await service.enrichWithTriageState('org-1', []);

      expect(enriched).toEqual([]);
      expect(repoMock.findByIds).not.toHaveBeenCalled();
    });

    it('preserves original item properties', async () => {
      repoMock.findByIds.mockReturnValue(Promise.resolve([]));

      const items = [{ id: 'f-1', name: 'Finding 1', severity: 'high' }];
      const enriched = await service.enrichWithTriageState('org-1', items);

      expect(enriched[0]!.name).toBe('Finding 1');
      expect((enriched[0] as any).severity).toBe('high');
      expect(enriched[0]!.id).toBe('f-1');
    });
  });
});
