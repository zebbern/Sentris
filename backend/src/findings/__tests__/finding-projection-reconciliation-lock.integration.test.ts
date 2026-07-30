import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { formatDatabaseTarget, getScriptDatabaseTarget } from '@sentris/local-runtime';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { FindingProjectionReconciliationLockService } from '../finding-projection-reconciliation-lock.service';

const runIntegration = process.env.RUN_FINDING_RECONCILIATION_LOCK_INTEGRATION === 'true';

(runIntegration ? describe : describe.skip)(
  'FindingProjectionReconciliationLockService PostgreSQL integration',
  () => {
    let firstPool: Pool;
    let secondPool: Pool;
    let firstService: FindingProjectionReconciliationLockService;
    let secondService: FindingProjectionReconciliationLockService;

    beforeAll(() => {
      const target = getScriptDatabaseTarget({
        overrideEnvVar: 'FINDING_RECONCILIATION_LOCK_TEST_DATABASE_URL',
      });
      // eslint-disable-next-line no-console -- integration target must be visible before use
      console.log(formatDatabaseTarget(target));
      firstPool = new Pool({ connectionString: target.connectionString, max: 1 });
      secondPool = new Pool({ connectionString: target.connectionString, max: 1 });
      firstService = new FindingProjectionReconciliationLockService(firstPool);
      secondService = new FindingProjectionReconciliationLockService(secondPool);
    });

    afterAll(async () => {
      await Promise.all([firstPool.end(), secondPool.end()]);
    });

    it('excludes the same tenant while allowing another tenant and later reacquisition', async () => {
      const lockedOrganizationId = `lock-test-${randomUUID()}`;
      const otherOrganizationId = `lock-test-${randomUUID()}`;
      let releaseFirst!: () => void;
      let markEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = firstService.withOrganizationLock(lockedOrganizationId, async () => {
        markEntered();
        await hold;
        return 'first';
      });

      await entered;
      try {
        const competing = await secondService.withOrganizationLock(
          lockedOrganizationId,
          async () => 'competing',
        );
        const otherTenant = await secondService.withOrganizationLock(
          otherOrganizationId,
          async () => 'other',
        );
        expect(competing).toEqual({ acquired: false });
        expect(otherTenant).toEqual({ acquired: true, value: 'other' });
      } finally {
        releaseFirst();
      }

      expect(await first).toEqual({ acquired: true, value: 'first' });
      expect(
        await secondService.withOrganizationLock(lockedOrganizationId, async () => 'resumed'),
      ).toEqual({ acquired: true, value: 'resumed' });
    });
  },
);
