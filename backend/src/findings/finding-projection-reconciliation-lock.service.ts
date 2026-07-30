import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

export type FindingProjectionReconciliationLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

const LOCK_NAMESPACE = 'sentris:finding-projection-reconciliation';
export const FINDING_RECONCILIATION_UNLOCK_TIMEOUT_MS = 5_000;

function organizationLockKey(organizationId: string): string {
  return createHash('sha256')
    .update(`${LOCK_NAMESPACE}:${organizationId}`)
    .digest()
    .readBigInt64BE(0)
    .toString();
}

@Injectable()
export class FindingProjectionReconciliationLockService {
  private readonly logger = new Logger(FindingProjectionReconciliationLockService.name);

  constructor(@Inject(Pool) private readonly pool: Pool) {}

  /**
   * Advisory locks are session-scoped, so the callback must stay on a
   * dedicated Pool client. The lock is non-blocking: another backend can keep
   * repairing this tenant while this process moves on to other tenants.
   */
  async withOrganizationLock<T>(
    organizationId: string,
    callback: () => Promise<T>,
    signal?: AbortSignal,
    unlockTimeoutMs = FINDING_RECONCILIATION_UNLOCK_TIMEOUT_MS,
  ): Promise<FindingProjectionReconciliationLockResult<T>> {
    signal?.throwIfAborted();
    const client = await this.pool.connect();
    const lockKey = organizationLockKey(organizationId);
    let acquired = false;
    let destroyClient = false;
    let clientReleased = false;

    try {
      signal?.throwIfAborted();
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [lockKey],
      );
      acquired = result.rows[0]?.acquired === true;
      signal?.throwIfAborted();
      if (!acquired) {
        return { acquired: false };
      }

      const value = await callback();
      signal?.throwIfAborted();
      return { acquired: true, value };
    } finally {
      if (acquired) {
        let unlockTimer: ReturnType<typeof setTimeout> | undefined;
        let unlockTimedOut = false;
        try {
          const unlockPromise = client.query({
            text: 'SELECT pg_advisory_unlock($1::bigint) AS released',
            values: [lockKey],
            query_timeout: unlockTimeoutMs,
          } as never);
          unlockTimer = setTimeout(() => {
            unlockTimedOut = true;
            destroyClient = true;
            clientReleased = true;
            client.release(true);
          }, unlockTimeoutMs);
          await unlockPromise;
          if (unlockTimedOut) {
            this.logger.warn(
              `Reconciliation advisory unlock for organization ${organizationId} exceeded ${unlockTimeoutMs}ms and settled after connection destruction`,
            );
          }
        } catch (error) {
          destroyClient = true;
          this.logger.warn(
            `Unable to explicitly release reconciliation lock for organization ${organizationId}; closing the PostgreSQL session: ${error}`,
          );
        } finally {
          if (unlockTimer) clearTimeout(unlockTimer);
        }
      }
      if (!clientReleased) client.release(destroyClient);
    }
  }
}
