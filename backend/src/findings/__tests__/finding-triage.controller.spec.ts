import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { FindingTriageController } from '../finding-triage.controller';
import type { FindingTriageService } from '../finding-triage.service';
import type { TicketingService } from '../../ticketing/ticketing.service';
import type { AuthContext } from '../../auth/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AUTH_NO_ORG: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const FINDING_ID = 'os-doc-001';

const TRIAGE_RESPONSE = {
  id: 'triage-1',
  findingOpensearchId: FINDING_ID,
  status: 'triaged',
  assigneeUserId: null,
  severityOverride: null,
  notes: null,
  slaDeadline: null,
  createdAt: '2026-03-04T00:00:00.000Z',
  updatedAt: '2026-03-04T12:00:00.000Z',
};

const BULK_RESPONSE = {
  results: [
    { findingId: 'f-1', success: true },
    { findingId: 'f-2', success: true },
  ],
  successCount: 2,
  failureCount: 0,
};

const HISTORY_RESPONSE = {
  events: [
    {
      id: 'evt-1',
      eventType: 'status_change',
      fieldChanged: 'status',
      oldValue: 'new',
      newValue: 'triaged',
      userId: 'user-1',
      comment: null,
      createdAt: '2026-03-04T12:00:00.000Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Service mock factory
// ---------------------------------------------------------------------------

function makeTriageService() {
  return {
    upsertTriage: mock(() => Promise.resolve(TRIAGE_RESPONSE)),
    bulkTriage: mock(() => Promise.resolve(BULK_RESPONSE)),
    getHistory: mock(() => Promise.resolve(HISTORY_RESPONSE)),
    enrichWithTriageState: mock(() => Promise.resolve([])),
    getTriageByStatus: mock(() => Promise.resolve([])),
    getAllTriagedIds: mock(() => Promise.resolve([])),
  } as unknown as FindingTriageService;
}

function makeTicketingService(): TicketingService {
  return {
    getTicketLink: mock(() => Promise.resolve(null)),
  } as unknown as TicketingService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindingTriageController', () => {
  let controller: FindingTriageController;
  let service: FindingTriageService;
  let ticketingService: TicketingService;

  beforeEach(() => {
    service = makeTriageService();
    ticketingService = makeTicketingService();
    controller = new FindingTriageController(service, ticketingService);
  });

  // -----------------------------------------------------------------------
  // PATCH /:id/triage
  // -----------------------------------------------------------------------

  describe('PATCH /:id/triage', () => {
    it('returns 200 with valid update and correct response shape', async () => {
      const result = await controller.updateTriage(AUTH, { id: FINDING_ID }, { status: 'triaged' });

      expect(service.upsertTriage).toHaveBeenCalledTimes(1);
      expect(service.upsertTriage).toHaveBeenCalledWith(AUTH, FINDING_ID, { status: 'triaged' });
      expect(result).toEqual(TRIAGE_RESPONSE);
    });

    it('returns 401 without authentication', async () => {
      await expect(
        controller.updateTriage(null, { id: FINDING_ID }, { status: 'triaged' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns 401 for unauthenticated context', async () => {
      const unauthenticated: AuthContext = {
        userId: null,
        organizationId: null,
        roles: [],
        isAuthenticated: false,
        provider: 'test',
      };

      await expect(
        controller.updateTriage(unauthenticated, { id: FINDING_ID }, { status: 'triaged' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns 401 without organization context', async () => {
      await expect(
        controller.updateTriage(AUTH_NO_ORG, { id: FINDING_ID }, { status: 'triaged' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns 422 for invalid status transition', async () => {
      (service.upsertTriage as any).mockReturnValue(
        Promise.reject(
          new BadRequestException({
            message: "Invalid status transition from 'new' to 'fixed'",
            currentStatus: 'new',
            validTransitions: ['triaged', 'wont_fix', 'accepted_risk'],
          }),
        ),
      );

      await expect(
        controller.updateTriage(AUTH, { id: FINDING_ID }, { status: 'fixed' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('error body includes currentStatus and validTransitions for invalid transition', async () => {
      const errorResponse = {
        message: "Invalid status transition from 'new' to 'fixed'",
        currentStatus: 'new',
        validTransitions: ['triaged', 'wont_fix', 'accepted_risk'],
      };
      (service.upsertTriage as any).mockReturnValue(
        Promise.reject(new BadRequestException(errorResponse)),
      );

      try {
        await controller.updateTriage(AUTH, { id: FINDING_ID }, { status: 'fixed' });
        expect(true).toBe(false); // Should not reach here
      } catch (err: any) {
        const response = err.getResponse();
        expect(response.currentStatus).toBe('new');
        expect(response.validTransitions).toEqual(['triaged', 'wont_fix', 'accepted_risk']);
      }
    });

    it('passes auth context to service method', async () => {
      await controller.updateTriage(AUTH, { id: FINDING_ID }, { status: 'triaged' });

      const calledAuth = (service.upsertTriage as any).mock.calls[0][0];
      expect(calledAuth).toBe(AUTH);
    });
  });

  // -----------------------------------------------------------------------
  // POST /bulk-triage
  // -----------------------------------------------------------------------

  describe('POST /bulk-triage', () => {
    it('returns 200 with valid bulk request', async () => {
      const body = {
        findingIds: ['f-1', 'f-2'],
        status: 'triaged' as const,
      };

      const result = await controller.bulkTriage(AUTH, body);

      expect(service.bulkTriage).toHaveBeenCalledTimes(1);
      expect(service.bulkTriage).toHaveBeenCalledWith(AUTH, ['f-1', 'f-2'], {
        status: 'triaged',
        assigneeUserId: undefined,
        comment: undefined,
      });
      expect(result).toEqual(BULK_RESPONSE);
    });

    it('returns 401 without auth', async () => {
      await expect(
        controller.bulkTriage(null, {
          findingIds: ['f-1'],
          status: 'triaged' as const,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns 401 without organization context', async () => {
      await expect(
        controller.bulkTriage(AUTH_NO_ORG, {
          findingIds: ['f-1'],
          status: 'triaged' as const,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('passes assigneeUserId and comment when provided', async () => {
      const body = {
        findingIds: ['f-1'],
        assigneeUserId: 'user-2',
        comment: 'Assigned in bulk',
      };

      await controller.bulkTriage(AUTH, body);

      const [, , input] = (service.bulkTriage as any).mock.calls[0];
      expect(input.assigneeUserId).toBe('user-2');
      expect(input.comment).toBe('Assigned in bulk');
    });
  });

  // -----------------------------------------------------------------------
  // GET /:id/history
  // -----------------------------------------------------------------------

  describe('GET /:id/history', () => {
    it('returns 200 with events array', async () => {
      const result = await controller.getHistory(AUTH, { id: FINDING_ID }, { limit: 50 });

      expect(service.getHistory).toHaveBeenCalledTimes(1);
      expect(service.getHistory).toHaveBeenCalledWith(AUTH, FINDING_ID, 50);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('status_change');
    });

    it('returns empty array for finding with no triage history', async () => {
      (service.getHistory as any).mockReturnValue(Promise.resolve({ events: [] }));

      const result = await controller.getHistory(AUTH, { id: FINDING_ID }, { limit: 50 });

      expect(result.events).toEqual([]);
    });

    it('returns 401 without auth', async () => {
      await expect(controller.getHistory(null, { id: FINDING_ID }, { limit: 50 })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns 401 without organization context', async () => {
      await expect(
        controller.getHistory(AUTH_NO_ORG, { id: FINDING_ID }, { limit: 50 }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('passes limit to service', async () => {
      await controller.getHistory(AUTH, { id: FINDING_ID }, { limit: 10 });

      const calledLimit = (service.getHistory as any).mock.calls[0][2];
      expect(calledLimit).toBe(10);
    });
  });
});
