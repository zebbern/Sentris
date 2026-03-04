/**
 * ETag Cache Service
 *
 * Redis-backed L2 cache for GitHub API ETag responses. Shares cached ETags
 * and response bodies across all backend instances so that conditional
 * requests (If-None-Match) work even after instance restarts or when
 * requests land on different instances.
 *
 * Redis key pattern: sentris:etag-cache:{sha256(url)}
 * TTL: 2100s (35 minutes — slightly exceeds the 30-min sync interval)
 *
 * Non-fatal: cache failures are logged but never break sync functionality.
 * The local in-memory Map in GitHubSyncService acts as the L1 cache.
 */

import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';

import { TEMPLATE_CACHE_REDIS } from './templates.tokens';

const ETAG_CACHE_TTL_SECONDS = 2100; // 35 minutes
const KEY_PREFIX = 'sentris:etag-cache:';

interface CachedResponse<T> {
  etag: string;
  data: T;
}

@Injectable()
export class EtagCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(EtagCacheService.name);

  constructor(@Inject(TEMPLATE_CACHE_REDIS) private readonly redis: Redis | null) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // ignore — shutting down
    }
  }

  /**
   * Hash the full URL to a fixed-length key, avoiding special characters
   * and Redis key-length concerns.
   */
  private hashUrl(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  private getKey(url: string): string {
    return `${KEY_PREFIX}${this.hashUrl(url)}`;
  }

  /**
   * Retrieve a cached ETag response from Redis.
   * Returns null if not found, Redis unavailable, or deserialization fails.
   */
  async get(url: string): Promise<CachedResponse<unknown> | null> {
    if (!this.redis) return null;

    try {
      const raw = await this.redis.get(this.getKey(url));
      if (!raw) return null;

      return JSON.parse(raw) as CachedResponse<unknown>;
    } catch (error) {
      this.logger.warn(`Failed to get etag cache for ${this.hashUrl(url)}: ${error}`);
      return null;
    }
  }

  /**
   * Store an ETag response in Redis with TTL.
   * The data field is JSON-safe (GitHubFile[] or string content).
   */
  async set(url: string, etag: string, data: unknown): Promise<void> {
    if (!this.redis) return;

    try {
      const cached: CachedResponse<unknown> = { etag, data };
      await this.redis.set(
        this.getKey(url),
        JSON.stringify(cached),
        'EX',
        ETAG_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Failed to set etag cache for ${this.hashUrl(url)}: ${error}`);
    }
  }

  /**
   * Remove a cached ETag response from Redis.
   */
  async delete(url: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(this.getKey(url));
    } catch (error) {
      this.logger.warn(`Failed to delete etag cache for ${this.hashUrl(url)}: ${error}`);
    }
  }
}
