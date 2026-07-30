import { describe, expect, it, jest } from 'bun:test';

import type { SecurityAnalyticsService } from '../../analytics/security-analytics.service';
import type { FindingTriageRecord } from '../../database/schema';
import type { FindingProjectionReconciliationLockService } from '../finding-projection-reconciliation-lock.service';
import type { FindingTriageRepository } from '../finding-triage.repository';
import { FindingTriageReconcilerService } from '../finding-triage-reconciler.service';

function record(
  id: string,
  findingOpensearchId: string,
  projectionVersion: number,
): FindingTriageRecord {
  const now = new Date('2026-07-26T12:00:00.000Z');
  return {
    id,
    organizationId: 'org-1',
    findingOpensearchId,
    status: 'fixed',
    assigneeUserId: 'user-1',
    severityOverride: null,
    notes: null,
    slaDeadline: null,
    projectionVersion,
    createdAt: now,
    updatedAt: now,
  };
}

function availableLock(): FindingProjectionReconciliationLockService {
  return {
    withOrganizationLock: jest
      .fn()
      .mockImplementation(async <T>(_organizationId: string, callback: () => Promise<T>) => ({
        acquired: true as const,
        value: await callback(),
      })),
  } as unknown as FindingProjectionReconciliationLockService;
}

describe('FindingTriageReconcilerService', () => {
  it('can pause only automatic scheduling while retaining direct reconciliation calls', async () => {
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue([]),
    } as unknown as FindingTriageRepository;
    const analytics = {
      isAvailable: jest.fn().mockReturnValue(false),
    } as unknown as SecurityAnalyticsService;
    const config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'FINDINGS_RECONCILIATION_SCHEDULE_ENABLED' ? false : undefined,
        ),
    };
    const service = new FindingTriageReconcilerService(
      repository,
      analytics,
      availableLock(),
      config as never,
    );

    service.onApplicationBootstrap();
    await Promise.resolve();
    expect(repository.listProjectionOrganizationsPage).not.toHaveBeenCalled();

    await service.reconcileOnce();
    expect(repository.listProjectionOrganizationsPage).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('detects and repairs only missing or stale projection versions', async () => {
    const rows = [record('0001', 'finding-current', 4), record('0002', 'finding-stale', 7)];
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue(['org-1']),
      getProjectionReconciliationState: jest.fn().mockResolvedValue(null),
      listProjectionPage: jest.fn().mockResolvedValue(rows),
      saveProjectionReconciliationState: jest.fn().mockImplementation((state) => state),
    } as unknown as FindingTriageRepository;
    const analytics = {
      getFindingTriageProjectionVersions: jest.fn().mockResolvedValue(
        new Map([
          ['finding-current', 4],
          ['finding-stale', 6],
        ]),
      ),
      projectFindingTriage: jest.fn().mockResolvedValue(undefined),
      reconcileFindingStorageIdIntegrity: jest.fn().mockResolvedValue({
        checked: 2,
        mismatched: 0,
        completedAt: '2026-07-26T12:01:00.000Z',
      }),
      writeFindingTriageProjectionWatermark: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAnalyticsService;
    const service = new FindingTriageReconcilerService(repository, analytics, availableLock());

    const state = await service.reconcileOnce();

    expect(analytics.projectFindingTriage).toHaveBeenCalledTimes(1);
    expect(analytics.projectFindingTriage).toHaveBeenCalledWith(
      'org-1',
      'finding-stale',
      expect.objectContaining({ version: 7 }),
    );
    expect(state).toEqual(
      expect.objectContaining({ checked: 2, repaired: 1, failed: 0, cursor: null }),
    );
    expect(repository.saveProjectionReconciliationState).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        cursor: null,
        reconciledThrough: expect.any(Date),
      }),
    );
    expect(analytics.writeFindingTriageProjectionWatermark).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ checked: 2, repaired: 1, failed: 0 }),
    );
    expect(analytics.reconcileFindingStorageIdIntegrity).toHaveBeenCalledWith('org-1');
  });

  it('records repair failures visibly and continues the bounded batch', async () => {
    const rows = [record('0001', 'missing', 1), record('0002', 'repairable', 2)];
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue(['org-1']),
      getProjectionReconciliationState: jest.fn().mockResolvedValue(null),
      listProjectionPage: jest.fn().mockResolvedValue(rows),
      saveProjectionReconciliationState: jest.fn().mockImplementation((state) => state),
    } as unknown as FindingTriageRepository;
    const projectFindingTriage = jest
      .fn()
      .mockRejectedValueOnce(new Error('observation absent'))
      .mockResolvedValueOnce(undefined);
    const analytics = {
      getFindingTriageProjectionVersions: jest.fn().mockResolvedValue(new Map()),
      projectFindingTriage,
      reconcileFindingStorageIdIntegrity: jest.fn().mockResolvedValue({
        checked: 2,
        mismatched: 0,
        completedAt: '2026-07-26T12:01:00.000Z',
      }),
      writeFindingTriageProjectionWatermark: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAnalyticsService;
    const service = new FindingTriageReconcilerService(repository, analytics, availableLock());

    const state = await service.reconcileOnce();

    expect(projectFindingTriage).toHaveBeenCalledTimes(2);
    expect(state).toEqual(expect.objectContaining({ checked: 2, repaired: 1, failed: 1 }));
  });

  it('resumes from durable state after restart and completes more than 10,000 records', async () => {
    const rows = Array.from({ length: 10_001 }, (_, index) =>
      record(index.toString().padStart(5, '0'), `finding-${index.toString().padStart(5, '0')}`, 1),
    );
    let durableState: Record<string, unknown> | null = null;
    const listProjectionPage = jest.fn(
      async (
        _organizationId: string,
        afterId: string | undefined,
        _updatedThrough: Date,
        limit: number,
      ) => {
        const start = afterId ? rows.findIndex((candidate) => candidate.id === afterId) + 1 : 0;
        return rows.slice(start, start + limit);
      },
    );
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue(['org-1']),
      getProjectionReconciliationState: jest.fn().mockImplementation(async () => durableState),
      listProjectionPage,
      saveProjectionReconciliationState: jest.fn().mockImplementation(async (state) => {
        durableState = { ...state };
        return state;
      }),
    } as unknown as FindingTriageRepository;
    const analytics = {
      getFindingTriageProjectionVersions: jest
        .fn()
        .mockImplementation(
          async (_organizationId: string, findingIds: string[]) =>
            new Map(findingIds.map((id) => [id, 1])),
        ),
      projectFindingTriage: jest.fn().mockResolvedValue(undefined),
      reconcileFindingStorageIdIntegrity: jest.fn().mockResolvedValue({
        checked: 10_001,
        mismatched: 0,
        completedAt: '2026-07-26T12:01:00.000Z',
      }),
      writeFindingTriageProjectionWatermark: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAnalyticsService;

    const firstProcess = new FindingTriageReconcilerService(repository, analytics, availableLock());
    const firstBatch = await firstProcess.reconcileOrganizationBatch('org-1', 500);
    expect(firstBatch.cycleComplete).toBe(false);
    expect(firstBatch.state.cursor).toBe('00499');
    expect(firstBatch.state.checked).toBe(500);

    const restartedProcess = new FindingTriageReconcilerService(
      repository,
      analytics,
      availableLock(),
    );
    const completed = await restartedProcess.reconcileOnce(500);

    expect(completed).toEqual(
      expect.objectContaining({
        checked: 10_001,
        repaired: 0,
        failed: 0,
        cursor: null,
      }),
    );
    expect(listProjectionPage).toHaveBeenCalledTimes(21);
    expect(analytics.getFindingTriageProjectionVersions).toHaveBeenCalledTimes(21);
    expect(analytics.writeFindingTriageProjectionWatermark).toHaveBeenCalledTimes(1);
    expect(durableState).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        cursor: null,
        cycleStartedAt: null,
        cycleCutoff: null,
        checked: 10_001,
        reconciledThrough: expect.any(Date),
        lastCompletedAt: expect.any(Date),
      }),
    );
  });

  it('keeps organization cursors isolated', async () => {
    const states = new Map<string, Record<string, unknown>>();
    const repository = {
      getProjectionReconciliationState: jest
        .fn()
        .mockImplementation(async (organizationId: string) => states.get(organizationId) ?? null),
      listProjectionPage: jest.fn().mockImplementation(async (organizationId: string) => [
        {
          ...record('0001', `finding-${organizationId}`, 1),
          organizationId,
        },
      ]),
      saveProjectionReconciliationState: jest.fn().mockImplementation(async (state) => {
        states.set(state.organizationId, { ...state });
        return state;
      }),
    } as unknown as FindingTriageRepository;
    const analytics = {
      getFindingTriageProjectionVersions: jest.fn().mockResolvedValue(new Map()),
      projectFindingTriage: jest.fn().mockResolvedValue(undefined),
      reconcileFindingStorageIdIntegrity: jest.fn().mockResolvedValue({
        checked: 1,
        mismatched: 0,
        completedAt: '2026-07-26T12:01:00.000Z',
      }),
      writeFindingTriageProjectionWatermark: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAnalyticsService;
    const service = new FindingTriageReconcilerService(repository, analytics, availableLock());

    await service.reconcileOrganizationBatch('org-a', 10);
    await service.reconcileOrganizationBatch('org-b', 10);

    expect(states.get('org-a')).toEqual(expect.objectContaining({ organizationId: 'org-a' }));
    expect(states.get('org-b')).toEqual(expect.objectContaining({ organizationId: 'org-b' }));
    expect(analytics.projectFindingTriage).toHaveBeenCalledWith(
      'org-a',
      'finding-org-a',
      expect.any(Object),
    );
    expect(analytics.projectFindingTriage).toHaveBeenCalledWith(
      'org-b',
      'finding-org-b',
      expect.any(Object),
    );
  });

  it('skips a tenant batch when another backend process holds its lock', async () => {
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue(['org-1']),
      getProjectionReconciliationState: jest.fn(),
      listProjectionPage: jest.fn(),
      saveProjectionReconciliationState: jest.fn(),
    } as unknown as FindingTriageRepository;
    const analytics = {
      getFindingTriageProjectionVersions: jest.fn(),
      projectFindingTriage: jest.fn(),
      reconcileFindingStorageIdIntegrity: jest.fn(),
      writeFindingTriageProjectionWatermark: jest.fn(),
    } as unknown as SecurityAnalyticsService;
    const lockService = {
      withOrganizationLock: jest.fn().mockResolvedValue({ acquired: false }),
    } as unknown as FindingProjectionReconciliationLockService;
    const service = new FindingTriageReconcilerService(repository, analytics, lockService);

    const state = await service.reconcileOnce();

    expect(lockService.withOrganizationLock).toHaveBeenCalledTimes(1);
    expect(lockService.withOrganizationLock).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(repository.getProjectionReconciliationState).not.toHaveBeenCalled();
    expect(repository.listProjectionPage).not.toHaveBeenCalled();
    expect(repository.saveProjectionReconciliationState).not.toHaveBeenCalled();
    expect(analytics.writeFindingTriageProjectionWatermark).not.toHaveBeenCalled();
    expect(state).toEqual(expect.objectContaining({ checked: 0, repaired: 0, failed: 0 }));
  });

  it('stops scheduling repository and projection work when recovery aborts during a callback step', async () => {
    const controller = new AbortController();
    const repository = {
      getProjectionReconciliationState: jest.fn().mockImplementation(async () => {
        controller.abort(new Error('recovery expired during state read'));
        return null;
      }),
      listProjectionPage: jest.fn(),
      saveProjectionReconciliationState: jest.fn(),
    } as unknown as FindingTriageRepository;
    const analytics = {
      getFindingTriageProjectionVersions: jest.fn(),
      projectFindingTriage: jest.fn(),
      reconcileFindingStorageIdIntegrity: jest.fn(),
      writeFindingTriageProjectionWatermark: jest.fn(),
    } as unknown as SecurityAnalyticsService;
    const lockService = availableLock();
    const service = new FindingTriageReconcilerService(repository, analytics, lockService);

    await expect(
      service.reconcileOrganizationBatch('org-1', 10, controller.signal),
    ).rejects.toThrow('recovery expired during state read');
    expect(repository.listProjectionPage).not.toHaveBeenCalled();
    expect(repository.saveProjectionReconciliationState).not.toHaveBeenCalled();
    expect(analytics.reconcileFindingStorageIdIntegrity).not.toHaveBeenCalled();
    expect(lockService.withOrganizationLock).toHaveBeenCalledWith(
      'org-1',
      expect.any(Function),
      controller.signal,
    );
  });

  it('discovers and reconciles case-distinct observation tenants with no triage rows', async () => {
    let discoveryCursor: { indexName: string; organizationId: string } | null = null;
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue([]),
      listExistingProjectionOrganizations: jest.fn().mockResolvedValue([]),
      getFindingObservationDiscoveryCursor: jest
        .fn()
        .mockImplementation(() => Promise.resolve(discoveryCursor)),
      saveFindingObservationDiscoveryCursor: jest.fn().mockImplementation((cursor) => {
        discoveryCursor = cursor;
        return Promise.resolve();
      }),
      getProjectionReconciliationState: jest.fn().mockResolvedValue(null),
      listProjectionPage: jest.fn().mockResolvedValue([]),
      saveProjectionReconciliationState: jest.fn().mockImplementation((state) => state),
    } as unknown as FindingTriageRepository;
    const listFindingObservationOrganizationsPage = jest
      .fn()
      .mockResolvedValueOnce({
        organizationIds: ['Org-A', 'org-a'],
        afterKey: {
          indexName:
            'security-findings-o527a4c0a7e943ca74bcc0baba99d55920cdb041997056e55c6f33a42d86910d5-observations-v1',
          organizationId: 'org-a',
        },
      })
      .mockResolvedValueOnce({ organizationIds: [], afterKey: null });
    const analytics = {
      isAvailable: jest.fn().mockReturnValue(true),
      listFindingObservationOrganizationsPage,
      getFindingTriageProjectionVersions: jest.fn().mockResolvedValue(new Map()),
      projectFindingTriage: jest.fn(),
      reconcileFindingStorageIdIntegrity: jest.fn().mockResolvedValue({
        checked: 1,
        mismatched: 0,
        completedAt: '2026-07-29T12:00:00.000Z',
      }),
      writeFindingTriageProjectionWatermark: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAnalyticsService;
    const lock = availableLock();
    const service = new FindingTriageReconcilerService(repository, analytics, lock);

    await service.reconcileOnce();

    expect(listFindingObservationOrganizationsPage).toHaveBeenNthCalledWith(1, undefined, 100);
    expect(listFindingObservationOrganizationsPage).toHaveBeenCalledTimes(1);
    await service.reconcileOnce();
    expect(listFindingObservationOrganizationsPage).toHaveBeenNthCalledWith(
      2,
      {
        indexName:
          'security-findings-o527a4c0a7e943ca74bcc0baba99d55920cdb041997056e55c6f33a42d86910d5-observations-v1',
        organizationId: 'org-a',
      },
      100,
    );
    expect(lock.withOrganizationLock).toHaveBeenCalledWith('Org-A', expect.any(Function));
    expect(lock.withOrganizationLock).toHaveBeenCalledWith('org-a', expect.any(Function));
    expect(analytics.reconcileFindingStorageIdIntegrity).toHaveBeenCalledWith('Org-A');
    expect(analytics.reconcileFindingStorageIdIntegrity).toHaveBeenCalledWith('org-a');
  });

  it('bounds discovery to one 100-tenant page per cycle and wraps so new earlier tenants are not omitted', async () => {
    const firstPageOrganizations = Array.from(
      { length: 100 },
      (_, index) => `org-${String(index).padStart(5, '0')}`,
    );
    const firstAfterKey = {
      indexName:
        'security-findings-od9da9671826184a5ec3d46afda148c1c75fdd2b4aa778e05f9b72e2d4ca67ab0-observations-v1',
      organizationId: firstPageOrganizations.at(-1)!,
    };
    let durableDiscoveryCursor: {
      indexName: string;
      organizationId: string;
    } | null = null;
    const repository = {
      listProjectionOrganizationsPage: jest.fn().mockResolvedValue([]),
      listExistingProjectionOrganizations: jest
        .fn()
        .mockImplementation((ids: string[]) =>
          Promise.resolve(ids.filter((id) => id !== 'org-new-before-cursor')),
        ),
      getFindingObservationDiscoveryCursor: jest
        .fn()
        .mockImplementation(() => Promise.resolve(durableDiscoveryCursor)),
      saveFindingObservationDiscoveryCursor: jest.fn().mockImplementation((cursor) => {
        durableDiscoveryCursor = cursor;
        return Promise.resolve();
      }),
      getProjectionReconciliationState: jest.fn().mockResolvedValue(null),
      listProjectionPage: jest.fn().mockResolvedValue([]),
      saveProjectionReconciliationState: jest.fn().mockImplementation((state) => state),
    } as unknown as FindingTriageRepository;
    const listFindingObservationOrganizationsPage = jest
      .fn()
      .mockResolvedValueOnce({
        organizationIds: firstPageOrganizations,
        afterKey: firstAfterKey,
      })
      .mockResolvedValueOnce({
        organizationIds: ['org-after-10000'],
        afterKey: null,
      })
      .mockResolvedValueOnce({
        organizationIds: ['org-new-before-cursor'],
        afterKey: null,
      });
    const analytics = {
      isAvailable: jest.fn().mockReturnValue(true),
      listFindingObservationOrganizationsPage,
      getFindingTriageProjectionVersions: jest.fn().mockResolvedValue(new Map()),
      projectFindingTriage: jest.fn(),
      reconcileFindingStorageIdIntegrity: jest.fn().mockResolvedValue({
        checked: 0,
        mismatched: 0,
        completedAt: '2026-07-29T12:00:00.000Z',
      }),
      writeFindingTriageProjectionWatermark: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAnalyticsService;
    const lock = availableLock();
    const firstProcess = new FindingTriageReconcilerService(repository, analytics, lock);

    await firstProcess.reconcileOnce();
    expect(listFindingObservationOrganizationsPage).toHaveBeenCalledTimes(1);
    expect(listFindingObservationOrganizationsPage).toHaveBeenLastCalledWith(undefined, 100);
    expect(repository.saveFindingObservationDiscoveryCursor).toHaveBeenLastCalledWith(
      firstAfterKey,
    );

    const restartedProcess = new FindingTriageReconcilerService(repository, analytics, lock);
    await restartedProcess.reconcileOnce();
    expect(listFindingObservationOrganizationsPage).toHaveBeenCalledTimes(2);
    expect(listFindingObservationOrganizationsPage).toHaveBeenLastCalledWith(firstAfterKey, 100);
    expect(repository.saveFindingObservationDiscoveryCursor).toHaveBeenLastCalledWith(null);

    const processAfterWrap = new FindingTriageReconcilerService(repository, analytics, lock);
    await processAfterWrap.reconcileOnce();
    expect(listFindingObservationOrganizationsPage).toHaveBeenCalledTimes(3);
    expect(listFindingObservationOrganizationsPage).toHaveBeenLastCalledWith(undefined, 100);
    expect(lock.withOrganizationLock).toHaveBeenCalledWith(
      'org-new-before-cursor',
      expect.any(Function),
    );
  });
});
