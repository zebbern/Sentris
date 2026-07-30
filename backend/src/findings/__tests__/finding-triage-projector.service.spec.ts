import { describe, expect, it, jest } from 'bun:test';

import type { SecurityAnalyticsService } from '../../analytics/security-analytics.service';
import { FindingTriageProjectorService } from '../finding-triage-projector.service';

describe('FindingTriageProjectorService', () => {
  it('validates and projects the full authoritative state from the durable event', async () => {
    const projectFindingTriage = jest.fn().mockResolvedValue(undefined);
    const service = new FindingTriageProjectorService({
      projectFindingTriage,
    } as unknown as SecurityAnalyticsService);

    await service.handleProjection({
      organizationId: 'org-1',
      findingOpensearchId: 'finding-1',
      status: 'fixed',
      assigneeUserId: 'user-1',
      severityOverride: 'critical',
      notes: 'verified',
      updatedAt: '2026-07-26T12:00:00.000Z',
      projectionVersion: 7,
      outbox: {
        eventId: 'event-1',
        dedupeKey: 'finding-triage-project:org-1:finding-1:v7',
        attempt: 1,
      },
    });

    expect(projectFindingTriage).toHaveBeenCalledWith('org-1', 'finding-1', {
      status: 'fixed',
      assigneeUserId: 'user-1',
      severityOverride: 'critical',
      notes: 'verified',
      updatedAt: '2026-07-26T12:00:00.000Z',
      version: 7,
    });
  });

  it('throws for malformed payloads so the outbox records a visible failure', async () => {
    const projectFindingTriage = jest.fn().mockResolvedValue(undefined);
    const service = new FindingTriageProjectorService({
      projectFindingTriage,
    } as unknown as SecurityAnalyticsService);

    await expect(
      service.handleProjection({
        organizationId: '',
        findingOpensearchId: 'finding-1',
        status: 'not-a-status',
        projectionVersion: 0,
      }),
    ).rejects.toThrow();
    expect(projectFindingTriage).not.toHaveBeenCalled();
  });

  it('projects the canonical none severity override without coercing it to info', async () => {
    const projectFindingTriage = jest.fn().mockResolvedValue(undefined);
    const service = new FindingTriageProjectorService({
      projectFindingTriage,
    } as unknown as SecurityAnalyticsService);

    await service.handleProjection({
      organizationId: 'org-1',
      findingOpensearchId: 'finding-1',
      status: 'triaged',
      assigneeUserId: null,
      severityOverride: 'none',
      notes: null,
      updatedAt: '2026-07-26T12:00:00.000Z',
      projectionVersion: 2,
    });

    expect(projectFindingTriage).toHaveBeenCalledWith(
      'org-1',
      'finding-1',
      expect.objectContaining({ severityOverride: 'none' }),
    );
  });
});
