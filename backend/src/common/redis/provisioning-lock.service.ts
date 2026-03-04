/**
 * Provisioning Lock Service
 *
 * Redis-backed distributed lock preventing concurrent OpenSearch tenant
 * provisioning for the same org across multiple backend instances.
 *
 * Two-layer design:
 * - Lock key (`sentris:provisioning:lock:{orgId}`) — short-lived SETNX with
 *   compare-and-delete. Prevents concurrent provisioning across instances.
 * - Done key (`sentris:provisioning:done:{orgId}`) — long-lived completion
 *   marker so instances skip provisioning entirely once it has succeeded.
 *
 * Non-fatal: Redis failures fall back to local-only behavior.
 */

import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

import { PROVISIONING_REDIS } from './redis.tokens';

const LOCK_TTL_SECONDS = 300; // 5 minutes — provisioning completes in <10s
const DONE_TTL_SECONDS = 86_400; // 24 hours

const LOCK_KEY_PREFIX = 'sentris:provisioning:lock:';
const DONE_KEY_PREFIX = 'sentris:provisioning:done:';

@Injectable()
export class ProvisioningLockService implements OnModuleDestroy {
  private readonly logger = new Logger(ProvisioningLockService.name);
  private readonly instanceId: string;

  constructor(@Inject(PROVISIONING_REDIS) private readonly redis: Redis | null) {
    // Unique per process — survives within a single OS process lifetime
    this.instanceId = `${process.env.HOSTNAME || hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // ignore
    }
  }

  /**
   * Attempt to acquire a provisioning lock for an org.
   * Returns true if this instance should proceed with provisioning.
   *
   * Uses SET NX EX with the instanceId as value for compare-and-delete.
   * When Redis is unavailable, returns true so local provisioning works.
   */
  async tryAcquire(orgId: string): Promise<boolean> {
    if (!this.redis) return true;

    try {
      const result = await this.redis.set(
        this.lockKey(orgId),
        this.instanceId,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Failed to acquire provisioning lock for ${orgId}: ${error}`);
      return true; // Redis down — allow local provisioning
    }
  }

  /**
   * Release the provisioning lock for an org.
   * Only deletes the lock if the value matches this instance's ID
   * (compare-and-delete), preventing Instance A from releasing Instance B's lock.
   */
  async release(orgId: string): Promise<void> {
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
      await this.redis.eval(script, 1, this.lockKey(orgId), this.instanceId);
    } catch (error) {
      this.logger.warn(`Failed to release provisioning lock for ${orgId}: ${error}`);
    }
  }

  /**
   * Check if an org has already been successfully provisioned.
   * Returns true if the completion marker exists in Redis.
   * When Redis is unavailable, returns false (caller should check local cache).
   */
  async isProvisioned(orgId: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const exists = await this.redis.exists(this.doneKey(orgId));
      return exists === 1;
    } catch (error) {
      this.logger.warn(`Failed to check provisioning status for ${orgId}: ${error}`);
      return false;
    }
  }

  /**
   * Mark an org as successfully provisioned.
   * Sets a completion marker with a long TTL so other instances skip provisioning.
   */
  async markProvisioned(orgId: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.set(this.doneKey(orgId), '1', 'EX', DONE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Failed to mark org ${orgId} as provisioned: ${error}`);
    }
  }

  private lockKey(orgId: string): string {
    return `${LOCK_KEY_PREFIX}${orgId}`;
  }

  private doneKey(orgId: string): string {
    return `${DONE_KEY_PREFIX}${orgId}`;
  }
}
