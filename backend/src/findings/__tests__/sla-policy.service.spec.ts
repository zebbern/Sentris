import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { SlaPolicyRepository } from '../sla-policy.repository';
import type { SlaPolicyRecord } from '../../database/schema';
import { SlaPolicyService } from '../sla-policy.service';

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
// Record factory
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeSlaPolicyRecord(overrides: Partial<SlaPolicyRecord> = {}): SlaPolicyRecord {
  const now = new Date();
  return {
    id: overrides.id ?? `sla-${++idCounter}`,
    organizationId: overrides.organizationId ?? 'org-1',
    severity: overrides.severity ?? 'critical',
    deadlineHours: overrides.deadlineHours ?? 24,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlaPolicyService', () => {
  let service: SlaPolicyService;
  let repoMock: {
    findByOrganization: ReturnType<typeof mock>;
    upsertPolicies: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    idCounter = 0;

    repoMock = {
      findByOrganization: mock(() => Promise.resolve([])),
      upsertPolicies: mock(() => Promise.resolve([])),
    };

    service = new SlaPolicyService(repoMock as unknown as SlaPolicyRepository);
  });

  // -----------------------------------------------------------------------
  // getPolicies
  // -----------------------------------------------------------------------

  describe('getPolicies', () => {
    it('returns all policies for the organization', async () => {
      const records = [
        makeSlaPolicyRecord({ severity: 'critical', deadlineHours: 24 }),
        makeSlaPolicyRecord({ severity: 'high', deadlineHours: 72 }),
        makeSlaPolicyRecord({ severity: 'medium', deadlineHours: 168 }),
      ];
      repoMock.findByOrganization.mockReturnValue(Promise.resolve(records));

      const result = await service.getPolicies(AUTH);

      expect(result.policies).toHaveLength(3);
      expect(result.policies[0]!.severity).toBe('critical');
      expect(result.policies[0]!.deadlineHours).toBe(24);
      expect(result.policies[1]!.severity).toBe('high');
      expect(result.policies[1]!.deadlineHours).toBe(72);
    });

    it('returns empty policies array when none exist', async () => {
      repoMock.findByOrganization.mockReturnValue(Promise.resolve([]));

      const result = await service.getPolicies(AUTH);

      expect(result.policies).toEqual([]);
    });

    it('serializes dates to ISO strings', async () => {
      const date = new Date('2026-03-04T12:00:00.000Z');
      repoMock.findByOrganization.mockReturnValue(
        Promise.resolve([makeSlaPolicyRecord({ createdAt: date, updatedAt: date })]),
      );

      const result = await service.getPolicies(AUTH);

      expect(result.policies[0]!.createdAt).toBe('2026-03-04T12:00:00.000Z');
      expect(result.policies[0]!.updatedAt).toBe('2026-03-04T12:00:00.000Z');
    });

    it('includes id in response', async () => {
      repoMock.findByOrganization.mockReturnValue(
        Promise.resolve([makeSlaPolicyRecord({ id: 'sla-uuid-123' })]),
      );

      const result = await service.getPolicies(AUTH);
      expect(result.policies[0]!.id).toBe('sla-uuid-123');
    });

    it('passes correct organizationId to repository', async () => {
      await service.getPolicies(AUTH);

      expect(repoMock.findByOrganization).toHaveBeenCalledTimes(1);
      expect(repoMock.findByOrganization.mock.calls[0]![0]).toBe('org-1');
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.getPolicies(AUTH_NO_ORG)).rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // upsertPolicies
  // -----------------------------------------------------------------------

  describe('upsertPolicies', () => {
    it('replaces existing policies atomically', async () => {
      const newRecords = [
        makeSlaPolicyRecord({ severity: 'critical', deadlineHours: 12 }),
        makeSlaPolicyRecord({ severity: 'high', deadlineHours: 48 }),
      ];
      repoMock.upsertPolicies.mockReturnValue(Promise.resolve(newRecords));

      const input = {
        policies: [
          { severity: 'critical' as const, deadlineHours: 12 },
          { severity: 'high' as const, deadlineHours: 48 },
        ],
      };

      const result = await service.upsertPolicies(AUTH, input);

      expect(result.policies).toHaveLength(2);
      expect(result.policies[0]!.severity).toBe('critical');
      expect(result.policies[0]!.deadlineHours).toBe(12);
      expect(result.policies[1]!.severity).toBe('high');
      expect(result.policies[1]!.deadlineHours).toBe(48);
    });

    it('passes organizationId and policies to repository', async () => {
      repoMock.upsertPolicies.mockReturnValue(Promise.resolve([]));

      const input = {
        policies: [{ severity: 'low' as const, deadlineHours: 720 }],
      };

      await service.upsertPolicies(AUTH, input);

      expect(repoMock.upsertPolicies).toHaveBeenCalledTimes(1);
      const [orgId, policies] = repoMock.upsertPolicies.mock.calls[0]!;
      expect(orgId).toBe('org-1');
      expect(policies).toEqual([{ severity: 'low', deadlineHours: 720 }]);
    });

    it('handles empty policies array (clears all)', async () => {
      repoMock.upsertPolicies.mockReturnValue(Promise.resolve([]));

      const result = await service.upsertPolicies(AUTH, { policies: [] });

      expect(result.policies).toEqual([]);
      expect(repoMock.upsertPolicies).toHaveBeenCalledTimes(1);
    });

    it('returns policies with serialized dates', async () => {
      const date = new Date('2026-01-15T10:30:00.000Z');
      repoMock.upsertPolicies.mockReturnValue(
        Promise.resolve([makeSlaPolicyRecord({ createdAt: date, updatedAt: date })]),
      );

      const input = {
        policies: [{ severity: 'critical' as const, deadlineHours: 24 }],
      };

      const result = await service.upsertPolicies(AUTH, input);

      expect(result.policies[0]!.createdAt).toBe('2026-01-15T10:30:00.000Z');
      expect(result.policies[0]!.updatedAt).toBe('2026-01-15T10:30:00.000Z');
    });

    it('throws ForbiddenException without organization context', async () => {
      await expect(service.upsertPolicies(AUTH_NO_ORG, { policies: [] })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
