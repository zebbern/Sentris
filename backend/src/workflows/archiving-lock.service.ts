/**
 * Archiving Lock Service
 *
 * Redis-backed distributed lock preventing concurrent archive operations
 * for the same workflow run across multiple backend instances.
 * Uses SETNX with TTL for atomic lock acquisition.
 *
 * Redis key pattern: sentris:archiving:{runId}
 * TTL: 900s (15 minutes — safety bound; archive operations take seconds)
 *
 * Non-fatal: lock failures fall back to a local Set<string> guard.
 */

import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';

import { ARCHIVING_REDIS } from './workflows.tokens';
import { buildInstanceId } from '../common/redis/instance-id.util';

const ARCHIVING_TTL_SECONDS = 900; // 15 minutes
const KEY_PREFIX = 'sentris:archiving:';

@Injectable()
export class ArchivingLockService implements OnModuleDestroy {
  private readonly logger = new Logger(ArchivingLockService.name);
  private readonly localLocks = new Set<string>();
  private readonly instanceId: string;

  constructor(@Inject(ARCHIVING_REDIS) private readonly redis: Redis | null) {
    this.instanceId = buildInstanceId();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // ignore
    }
  }

  private getKey(runId: string): string {
    return `${KEY_PREFIX}${runId}`;
  }

  /**
   * Attempt to acquire the archiving lock for a run.
   * Returns true if the lock was acquired, false if already held.
   *
   * Uses Redis SET NX EX for atomic lock-with-TTL when available.
   * Falls back to local Set<string> when Redis is unavailable.
   */
  async tryAcquire(runId: string): Promise<boolean> {
    // Always check local lock first — prevents double-archive on the same instance
    if (this.localLocks.has(runId)) {
      return false;
    }

    if (this.redis) {
      try {
        const result = await this.redis.set(
          this.getKey(runId),
          this.instanceId,
          'EX',
          ARCHIVING_TTL_SECONDS,
          'NX',
        );
        if (result !== 'OK') {
          return false; // Lock held by another instance
        }
        // Redis lock acquired — also set local guard
        this.localLocks.add(runId);
        return true;
      } catch (error) {
        this.logger.warn(`Failed to acquire archiving lock for run ${runId}: ${error}`);
        // Redis failed — fall through to local-only guard
      }
    }

    // No Redis or Redis failed — use local Set only
    this.localLocks.add(runId);
    return true;
  }

  /**
   * Release the archiving lock for a run.
   * Only deletes the Redis key if the value matches this instance's ID
   * (compare-and-delete), preventing Instance A from releasing Instance B's lock.
   * Always releases the local lock.
   */
  async release(runId: string): Promise<void> {
    this.localLocks.delete(runId);

    if (!this.redis) return;

    try {
      // Lua script for atomic compare-and-delete
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(script, 1, this.getKey(runId), this.instanceId);
    } catch (error) {
      this.logger.warn(`Failed to release archiving lock for run ${runId}: ${error}`);
    }
  }
}
