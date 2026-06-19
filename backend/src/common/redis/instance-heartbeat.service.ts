/**
 * Instance Heartbeat Service
 *
 * Redis-backed heartbeat that registers backend instance liveness.
 * Each instance publishes a heartbeat key every 10s with a 30s TTL.
 * A missing key means the instance has been down for >30s.
 *
 * Key pattern: sentris:instances:{instanceId}
 * TTL: 30s (refreshed every 10s — 3× safety margin)
 *
 * Non-fatal: Redis failures are logged but never thrown.
 */

import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';

import { INSTANCE_HEARTBEAT_REDIS } from './redis.tokens';
import { buildInstanceId } from './instance-id.util';

const HEARTBEAT_TTL_SECONDS = 30;
const HEARTBEAT_INTERVAL_MS = 10_000;
const KEY_PREFIX = 'sentris:instances:';

export interface InstanceInfo {
  instanceId: string;
  hostname: string;
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
}

@Injectable()
export class InstanceHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceHeartbeatService.name);
  readonly instanceId: string;
  private readonly startedAt: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(INSTANCE_HEARTBEAT_REDIS) private readonly redis: Redis | null) {
    this.instanceId = buildInstanceId();
    this.startedAt = new Date().toISOString();
  }

  async onModuleInit(): Promise<void> {
    await this.register();
    this.heartbeatInterval = setInterval(() => this.register(), HEARTBEAT_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Graceful shutdown: remove our key so peers see us gone immediately
    if (this.redis) {
      try {
        await this.redis.del(this.getKey(this.instanceId));
      } catch {
        // ignore — shutting down
      }
      try {
        await this.redis.quit();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Publish (or refresh) this instance's heartbeat in Redis.
   */
  async register(): Promise<void> {
    if (!this.redis) return;

    const payload: InstanceInfo = {
      instanceId: this.instanceId,
      hostname: this.instanceId,
      pid: process.pid,
      startedAt: this.startedAt,
      lastHeartbeat: new Date().toISOString(),
    };

    try {
      await this.redis.set(
        this.getKey(this.instanceId),
        JSON.stringify(payload),
        'EX',
        HEARTBEAT_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Failed to publish heartbeat: ${error}`);
    }
  }

  /**
   * List all alive instances by scanning heartbeat keys.
   * Uses SCAN (not KEYS) for production safety.
   */
  async listAliveInstances(): Promise<InstanceInfo[]> {
    if (!this.redis) return [];

    try {
      const keys = await this.scanKeys(`${KEY_PREFIX}*`);
      if (keys.length === 0) return [];

      const values = await this.redis.mget(...keys);

      return values
        .map((raw) => {
          if (!raw) return null;
          try {
            return JSON.parse(raw) as InstanceInfo;
          } catch {
            return null;
          }
        })
        .filter((info): info is InstanceInfo => info !== null);
    } catch (error) {
      this.logger.warn(`Failed to list alive instances: ${error}`);
      return [];
    }
  }

  /**
   * Check if a specific instance is alive (its heartbeat key exists).
   * Returns true when Redis is unavailable (graceful degradation).
   */
  async isInstanceAlive(instanceId: string): Promise<boolean> {
    if (!this.redis) return true;

    try {
      const exists = await this.redis.exists(this.getKey(instanceId));
      return exists === 1;
    } catch (error) {
      this.logger.warn(`Failed to check instance liveness for ${instanceId}: ${error}`);
      return true; // Assume alive when Redis is down
    }
  }

  private getKey(instanceId: string): string {
    return `${KEY_PREFIX}${instanceId}`;
  }

  /**
   * SCAN-based key enumeration. Avoids blocking Redis with KEYS on large datasets.
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    if (!this.redis) return [];

    const allKeys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      allKeys.push(...keys);
    } while (cursor !== '0');

    return allKeys;
  }
}
