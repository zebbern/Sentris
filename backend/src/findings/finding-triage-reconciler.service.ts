import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  FindingProjectionReconciliationRecord,
  FindingTriageRecord,
} from '../database/schema';
import { SecurityAnalyticsService } from '../analytics/security-analytics.service';
import {
  FindingTriageRepository,
  type SaveFindingProjectionReconciliationState,
} from './finding-triage.repository';
import { FindingProjectionReconciliationLockService } from './finding-projection-reconciliation-lock.service';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 500;
const ORGANIZATION_PAGE_SIZE = 100;
const PROJECTION_WRITE_CONCURRENCY = 20;
const OBSERVATION_DISCOVERY_LOCK_ID = '\u001esentris:finding-observation-discovery:v1';

export interface FindingTriageReconciliationState {
  checked: number;
  repaired: number;
  failed: number;
  cursor: string | null;
  cycleStartedAt: string | null;
  reconciledThrough: string | null;
  completedAt: string | null;
}

export interface FindingTriageReconciliationBatch {
  state: FindingTriageReconciliationState;
  cycleComplete: boolean;
  skipped: boolean;
}

@Injectable()
export class FindingTriageReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FindingTriageReconcilerService.name);
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private state: FindingTriageReconciliationState | null = null;

  constructor(
    private readonly repository: FindingTriageRepository,
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly lockService: FindingProjectionReconciliationLockService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.configService?.get<boolean>('FINDINGS_RECONCILIATION_SCHEDULE_ENABLED') === false) {
      this.logger.log('Automatic finding reconciliation is paused by configuration');
      return;
    }
    this.runScheduled();
    this.timer = setInterval(() => this.runScheduled(), RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getState(): FindingTriageReconciliationState | null {
    return this.state;
  }

  /**
   * Reconcile authoritative PostgreSQL tenant state without a total-row cap.
   * Observation-only tenant discovery advances one bounded OpenSearch page per
   * invocation and persists its composite cursor before the next cycle.
   */
  async reconcileOnce(batchSize = DEFAULT_BATCH_SIZE): Promise<FindingTriageReconciliationState> {
    const limit = this.boundedBatchSize(batchSize);
    let afterOrganizationId: string | undefined;
    let checked = 0;
    let repaired = 0;
    let failed = 0;

    while (true) {
      const organizationIds = await this.repository.listProjectionOrganizationsPage(
        afterOrganizationId,
        ORGANIZATION_PAGE_SIZE,
      );
      if (organizationIds.length === 0) break;

      for (const organizationId of organizationIds) {
        let batch: FindingTriageReconciliationBatch;
        do {
          batch = await this.reconcileOrganizationBatch(organizationId, limit);
        } while (!batch.skipped && !batch.cycleComplete);
        if (batch.skipped) continue;
        checked += batch.state.checked;
        repaired += batch.state.repaired;
        failed += batch.state.failed;
      }

      if (organizationIds.length < ORGANIZATION_PAGE_SIZE) break;
      afterOrganizationId = organizationIds.at(-1);
    }

    if (this.securityAnalyticsService.isAvailable?.()) {
      const discovered = await this.reconcileObservationOnlyOrganizations(limit);
      checked += discovered.checked;
      repaired += discovered.repaired;
      failed += discovered.failed;
    }

    this.state = {
      checked,
      repaired,
      failed,
      cursor: null,
      cycleStartedAt: null,
      reconciledThrough: null,
      completedAt: new Date().toISOString(),
    };
    if (failed > 0) {
      this.logger.warn(
        `Finding triage reconciliation completed with ${failed} failure(s); checked=${checked} repaired=${repaired}`,
      );
    }
    return this.state;
  }

  private async reconcileObservationOnlyOrganizations(
    limit: number,
  ): Promise<{ checked: number; repaired: number; failed: number }> {
    const locked = await this.lockService.withOrganizationLock(OBSERVATION_DISCOVERY_LOCK_ID, () =>
      this.reconcileObservationOnlyOrganizationsUnderLock(limit),
    );
    return locked.acquired ? locked.value : { checked: 0, repaired: 0, failed: 0 };
  }

  private async reconcileObservationOnlyOrganizationsUnderLock(
    limit: number,
  ): Promise<{ checked: number; repaired: number; failed: number }> {
    let checked = 0;
    let repaired = 0;
    let failed = 0;

    const previousAfterKey =
      (await this.repository.getFindingObservationDiscoveryCursor()) ?? undefined;
    const page = await this.securityAnalyticsService.listFindingObservationOrganizationsPage(
      previousAfterKey,
      ORGANIZATION_PAGE_SIZE,
    );
    if (
      page.afterKey &&
      page.afterKey.indexName === previousAfterKey?.indexName &&
      page.afterKey.organizationId === previousAfterKey.organizationId
    ) {
      throw new Error('Finding organization discovery cursor did not advance');
    }

    const organizationIds = [...new Set(page.organizationIds)];
    const existing = new Set(
      await this.repository.listExistingProjectionOrganizations(organizationIds),
    );
    for (const organizationId of organizationIds) {
      if (existing.has(organizationId)) continue;
      let batch: FindingTriageReconciliationBatch;
      do {
        batch = await this.reconcileOrganizationBatch(organizationId, limit);
      } while (!batch.skipped && !batch.cycleComplete);
      if (batch.skipped) continue;
      checked += batch.state.checked;
      repaired += batch.state.repaired;
      failed += batch.state.failed;
    }

    await this.repository.saveFindingObservationDiscoveryCursor(page.afterKey);
    return { checked, repaired, failed };
  }

  async reconcileOrganizationBatch(
    organizationId: string,
    batchSize = DEFAULT_BATCH_SIZE,
    signal?: AbortSignal,
  ): Promise<FindingTriageReconciliationBatch> {
    signal?.throwIfAborted();
    const limit = this.boundedBatchSize(batchSize);
    const reconcileUnderLock = () =>
      this.reconcileOrganizationBatchUnderLock(organizationId, limit, signal);
    const result = signal
      ? await this.lockService.withOrganizationLock(organizationId, reconcileUnderLock, signal)
      : await this.lockService.withOrganizationLock(organizationId, reconcileUnderLock);
    signal?.throwIfAborted();
    if (!result.acquired) {
      return {
        cycleComplete: false,
        skipped: true,
        state: {
          checked: 0,
          repaired: 0,
          failed: 0,
          cursor: null,
          cycleStartedAt: null,
          reconciledThrough: null,
          completedAt: null,
        },
      };
    }
    return { ...result.value, skipped: false };
  }

  private async reconcileOrganizationBatchUnderLock(
    organizationId: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Omit<FindingTriageReconciliationBatch, 'skipped'>> {
    signal?.throwIfAborted();
    const persisted = await this.repository.getProjectionReconciliationState(organizationId);
    signal?.throwIfAborted();
    const cycle = this.resolveCycle(persisted);
    const records = await this.repository.listProjectionPage(
      organizationId,
      cycle.cursor ?? undefined,
      cycle.cycleCutoff,
      limit,
    );
    signal?.throwIfAborted();
    const outcome = await this.reconcileRecords(organizationId, records, signal);
    signal?.throwIfAborted();
    const checked = cycle.checked + records.length;
    const repaired = cycle.repaired + outcome.repaired;
    const failed = cycle.failed + outcome.failed;

    if (records.length === limit) {
      const cursor = records.at(-1)!.id;
      await this.repository.saveProjectionReconciliationState({
        organizationId,
        cursor,
        cycleStartedAt: cycle.cycleStartedAt,
        cycleCutoff: cycle.cycleCutoff,
        checked,
        repaired,
        failed,
        lastCompletedAt: persisted?.lastCompletedAt ?? null,
        reconciledThrough: persisted?.reconciledThrough ?? null,
      });
      signal?.throwIfAborted();
      return {
        cycleComplete: false,
        state: {
          checked,
          repaired,
          failed,
          cursor,
          cycleStartedAt: cycle.cycleStartedAt.toISOString(),
          reconciledThrough: persisted?.reconciledThrough?.toISOString() ?? null,
          completedAt: persisted?.lastCompletedAt?.toISOString() ?? null,
        },
      };
    }

    const completedAt = new Date();
    await this.securityAnalyticsService.reconcileFindingStorageIdIntegrity(organizationId);
    signal?.throwIfAborted();
    await this.securityAnalyticsService.writeFindingTriageProjectionWatermark(organizationId, {
      reconciledThrough: cycle.cycleCutoff.toISOString(),
      completedAt: completedAt.toISOString(),
      checked,
      repaired,
      failed,
    });
    signal?.throwIfAborted();
    const completedState: SaveFindingProjectionReconciliationState = {
      organizationId,
      cursor: null,
      cycleStartedAt: null,
      cycleCutoff: null,
      checked,
      repaired,
      failed,
      lastCompletedAt: completedAt,
      reconciledThrough: cycle.cycleCutoff,
    };
    await this.repository.saveProjectionReconciliationState(completedState);
    signal?.throwIfAborted();
    return {
      cycleComplete: true,
      state: {
        checked,
        repaired,
        failed,
        cursor: null,
        cycleStartedAt: null,
        reconciledThrough: cycle.cycleCutoff.toISOString(),
        completedAt: completedAt.toISOString(),
      },
    };
  }

  private runScheduled(): void {
    if (this.running) return;
    this.running = true;
    void this.reconcileOnce()
      .catch((error) => {
        this.logger.warn(`Finding triage reconciliation failed: ${error}`);
      })
      .finally(() => {
        this.running = false;
      });
  }

  private resolveCycle(persisted: FindingProjectionReconciliationRecord | null): {
    cursor: string | null;
    cycleStartedAt: Date;
    cycleCutoff: Date;
    checked: number;
    repaired: number;
    failed: number;
  } {
    if (persisted?.cursor && persisted.cycleStartedAt && persisted.cycleCutoff) {
      return {
        cursor: persisted.cursor,
        cycleStartedAt: persisted.cycleStartedAt,
        cycleCutoff: persisted.cycleCutoff,
        checked: persisted.checked,
        repaired: persisted.repaired,
        failed: persisted.failed,
      };
    }
    const now = new Date();
    return {
      cursor: null,
      cycleStartedAt: now,
      cycleCutoff: now,
      checked: 0,
      repaired: 0,
      failed: 0,
    };
  }

  private async reconcileRecords(
    organizationId: string,
    records: FindingTriageRecord[],
    signal?: AbortSignal,
  ): Promise<{ repaired: number; failed: number }> {
    signal?.throwIfAborted();
    if (records.length === 0) return { repaired: 0, failed: 0 };

    try {
      const versions = await this.securityAnalyticsService.getFindingTriageProjectionVersions(
        organizationId,
        records.map((record) => record.findingOpensearchId),
      );
      signal?.throwIfAborted();
      const stale = records.filter(
        (record) => (versions.get(record.findingOpensearchId) ?? 0) < record.projectionVersion,
      );
      let repaired = 0;
      let failed = 0;
      for (let start = 0; start < stale.length; start += PROJECTION_WRITE_CONCURRENCY) {
        signal?.throwIfAborted();
        const results = await Promise.allSettled(
          stale
            .slice(start, start + PROJECTION_WRITE_CONCURRENCY)
            .map((record) =>
              this.securityAnalyticsService.projectFindingTriage(
                organizationId,
                record.findingOpensearchId,
                this.toProjection(record),
              ),
            ),
        );
        signal?.throwIfAborted();
        repaired += results.filter((result) => result.status === 'fulfilled').length;
        failed += results.filter((result) => result.status === 'rejected').length;
      }
      return { repaired, failed };
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn(
        `Unable to inspect triage projections for organization ${organizationId}: ${error}`,
      );
      return { repaired: 0, failed: records.length };
    }
  }

  private boundedBatchSize(batchSize: number): number {
    return Math.max(1, Math.min(Math.trunc(batchSize), 500));
  }

  private toProjection(record: FindingTriageRecord) {
    return {
      status: record.status,
      assigneeUserId: record.assigneeUserId,
      severityOverride: record.severityOverride,
      notes: record.notes,
      updatedAt: record.updatedAt.toISOString(),
      version: record.projectionVersion,
    };
  }
}
