import { describe, expect, it, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { FindingTriageRecord } from '../../database/schema';
import { FindingTriageService } from '../finding-triage.service';

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'test',
  isAuthenticated: true,
};

function recordFor(findingId: string): FindingTriageRecord {
  const now = new Date('2026-07-26T00:00:00.000Z');
  return {
    id: `triage-${findingId}`,
    organizationId: 'org-1',
    findingOpensearchId: findingId,
    status: 'triaged',
    assigneeUserId: null,
    severityOverride: null,
    notes: null,
    slaDeadline: null,
    projectionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeHarness(failingAuditFindingId?: string) {
  const committed: string[] = [];
  const rolledBack: string[] = [];
  const executors: unknown[] = [];
  let currentFindingId = '';

  const repository = {
    findByOrgAndFindingId: vi.fn(async () => null),
    findByIds: vi.fn(async () => []),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const executor = { id: `triage-tx-${executors.length + 1}` };
      executors.push(executor);
      try {
        const result = await callback(executor);
        committed.push(currentFindingId);
        return result;
      } catch (error) {
        rolledBack.push(currentFindingId);
        throw error;
      }
    }),
    commitChange: vi.fn(async (input: { findingOpensearchId: string }, _executor: unknown) => {
      currentFindingId = input.findingOpensearchId;
      return recordFor(input.findingOpensearchId);
    }),
  };
  const auditLogService = {
    recordDurableWithExecutor: vi.fn(
      async (_executor: unknown, _auth: AuthContext, event: { resourceId?: string | null }) => {
        if (event.resourceId === failingAuditFindingId) {
          throw new Error(`audit enqueue unavailable for ${failingAuditFindingId}`);
        }
      },
    ),
  };
  const service = new FindingTriageService(
    repository as never,
    auditLogService as never,
    {
      isAvailable: vi.fn(() => true),
      query: vi.fn(async () => ({ total: 1, items: [] })),
      queryFindings: vi.fn(async () => ({ total: 1, items: [] })),
    } as never,
    { listMembers: vi.fn(async () => [{ userId: 'user-1' }]) } as never,
  );

  return {
    service,
    repository,
    auditLogService,
    committed,
    rolledBack,
    executors,
  };
}

describe('finding triage durable audit transactions', () => {
  it('uses the same transaction for a single triage change and its audit', async () => {
    const harness = makeHarness();

    await harness.service.upsertTriage(AUTH, 'finding-1', { status: 'triaged' });

    expect(harness.repository.commitChange.mock.calls[0]?.[1]).toBe(harness.executors[0]);
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.executors[0],
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'findings.triage',
      resourceId: 'finding-1',
    });
    expect(harness.committed).toEqual(['finding-1']);
  });

  it('rolls back a single triage change when durable audit enqueue rejects', async () => {
    const harness = makeHarness('finding-1');

    await expect(
      harness.service.upsertTriage(AUTH, 'finding-1', { status: 'triaged' }),
    ).rejects.toThrow('audit enqueue unavailable for finding-1');

    expect(harness.committed).toEqual([]);
    expect(harness.rolledBack).toEqual(['finding-1']);
  });

  it('commits bulk triage independently per item with a truthful per-item audit', async () => {
    const harness = makeHarness();

    const result = await harness.service.bulkTriage(AUTH, ['finding-1', 'finding-2'], {
      status: 'triaged',
    });

    expect(result).toMatchObject({ successCount: 2, failureCount: 0 });
    expect(harness.executors).toHaveLength(2);
    expect(harness.repository.commitChange.mock.calls[0]?.[1]).toBe(harness.executors[0]);
    expect(harness.repository.commitChange.mock.calls[1]?.[1]).toBe(harness.executors[1]);
    expect(harness.auditLogService.recordDurableWithExecutor).toHaveBeenCalledTimes(2);
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.executors[0],
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[1]?.[0]).toBe(
      harness.executors[1],
    );
    expect(
      harness.auditLogService.recordDurableWithExecutor.mock.calls.map(
        (call) => (call[2] as { action: string; resourceId: string | null }).action,
      ),
    ).toEqual(['findings.bulk_triage', 'findings.bulk_triage']);
    expect(
      harness.auditLogService.recordDurableWithExecutor.mock.calls.map(
        (call) => (call[2] as { resourceId: string | null }).resourceId,
      ),
    ).toEqual(['finding-1', 'finding-2']);
    expect(harness.committed).toEqual(['finding-1', 'finding-2']);
  });

  it('does not roll back earlier bulk successes when a later item audit enqueue rejects', async () => {
    const harness = makeHarness('finding-2');

    await expect(
      harness.service.bulkTriage(AUTH, ['finding-1', 'finding-2'], { status: 'triaged' }),
    ).rejects.toThrow('audit enqueue unavailable for finding-2');

    expect(harness.committed).toEqual(['finding-1']);
    expect(harness.rolledBack).toEqual(['finding-2']);
  });
});
