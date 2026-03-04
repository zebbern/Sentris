/**
 * Session Registry Service
 *
 * Redis-backed registry that tracks active MCP sessions across backend instances.
 * Provides operational visibility into which instance owns which session.
 *
 * Redis key pattern: mcp:sessions:{sessionId}
 * TTL: 2 hours (matching MCP session lifetime)
 *
 * Non-fatal: Registry failures are logged but never break MCP functionality.
 */

import { Injectable, Logger, Inject, OnModuleDestroy, Optional } from '@nestjs/common';
import type Redis from 'ioredis';

import { SESSION_REGISTRY_REDIS } from './mcp.tokens';
import { InstanceHeartbeatService } from '../common/redis/instance-heartbeat.service';
import { buildInstanceId } from '../common/redis/instance-id.util';

const SESSION_TTL_SECONDS = 7200; // 2 hours
const WARN_SESSION_COUNT = 1000;

export type SessionType = 'mcp-gateway' | 'studio-mcp';

export interface SessionRegistryData {
  instanceId: string;
  userId: string | null;
  organizationId: string | null;
  sessionType: SessionType;
  runId?: string;
  createdAt: string;
}

@Injectable()
export class SessionRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionRegistryService.name);
  readonly instanceId: string;

  constructor(
    @Inject(SESSION_REGISTRY_REDIS) private readonly redis: Redis | null,
    @Optional() private readonly heartbeat: InstanceHeartbeatService | null = null,
  ) {
    this.instanceId = buildInstanceId();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // ignore
    }
  }

  private getKey(sessionId: string): string {
    return `mcp:sessions:${sessionId}`;
  }

  /**
   * Register a new MCP session in the registry.
   */
  async register(
    sessionId: string,
    data: Omit<SessionRegistryData, 'instanceId' | 'createdAt'>,
  ): Promise<void> {
    if (!this.redis) return;

    const entry: SessionRegistryData = {
      ...data,
      instanceId: this.instanceId,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.redis.set(
        this.getKey(sessionId),
        JSON.stringify(entry),
        'EX',
        SESSION_TTL_SECONDS,
      );
      this.logger.debug(`Session registered: ${sessionId} (${data.sessionType})`);
    } catch (error) {
      this.logger.warn(`Failed to register session ${sessionId}: ${error}`);
    }
  }

  /**
   * Remove a session from the registry.
   */
  async deregister(sessionId: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(this.getKey(sessionId));
      this.logger.debug(`Session deregistered: ${sessionId}`);
    } catch (error) {
      this.logger.warn(`Failed to deregister session ${sessionId}: ${error}`);
    }
  }

  /**
   * Reset the TTL on an existing session key.
   */
  async refresh(sessionId: string, ttlSeconds: number = SESSION_TTL_SECONDS): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.expire(this.getKey(sessionId), ttlSeconds);
    } catch (error) {
      this.logger.warn(`Failed to refresh session ${sessionId}: ${error}`);
    }
  }

  /**
   * Get session data by ID, or null if expired/missing.
   */
  async getSession(
    sessionId: string,
  ): Promise<(SessionRegistryData & { sessionId: string }) | null> {
    if (!this.redis) return null;

    try {
      const raw = await this.redis.get(this.getKey(sessionId));
      if (!raw) return null;
      return { sessionId, ...(JSON.parse(raw) as SessionRegistryData) };
    } catch (error) {
      this.logger.warn(`Failed to get session ${sessionId}: ${error}`);
      return null;
    }
  }

  /**
   * List all active sessions in the registry.
   *
   * Uses KEYS which is O(N) — acceptable for admin-only usage.
   * For production scale (>1000 sessions), consider SCAN-based pagination.
   */
  async listActiveSessions(): Promise<{
    sessions: (SessionRegistryData & { sessionId: string })[];
    count: number;
  }> {
    if (!this.redis) return { sessions: [], count: 0 };

    try {
      const keys = await this.redis.keys('mcp:sessions:*');

      if (keys.length === 0) {
        return { sessions: [], count: 0 };
      }

      if (keys.length > WARN_SESSION_COUNT) {
        this.logger.warn(
          `High session count: ${keys.length} active sessions. Consider SCAN-based pagination.`,
        );
      }

      const values = await this.redis.mget(...keys);

      const sessions = keys
        .map((key, index) => {
          const raw = values[index];
          if (!raw) return null;
          const sessionId = key.replace('mcp:sessions:', '');
          return { sessionId, ...(JSON.parse(raw) as SessionRegistryData) };
        })
        .filter((s): s is SessionRegistryData & { sessionId: string } => s !== null);

      return { sessions, count: sessions.length };
    } catch (error) {
      this.logger.warn(`Failed to list active sessions: ${error}`);
      return { sessions: [], count: 0 };
    }
  }

  /**
   * Detect sessions owned by instances that are no longer alive.
   * Cross-references session instanceId with heartbeat keys.
   * Admin-only — not called automatically.
   */
  async detectStaleSessions(): Promise<(SessionRegistryData & { sessionId: string })[]> {
    if (!this.heartbeat) return [];

    const { sessions } = await this.listActiveSessions();
    if (sessions.length === 0) return [];

    // Collect unique instanceIds and check liveness in parallel
    const instanceIds = [...new Set(sessions.map((s) => s.instanceId))];
    const livenessMap = new Map<string, boolean>();

    await Promise.all(
      instanceIds.map(async (id) => {
        const alive = await this.heartbeat!.isInstanceAlive(id);
        livenessMap.set(id, alive);
      }),
    );

    return sessions.filter((s) => livenessMap.get(s.instanceId) === false);
  }

  /**
   * Remove stale session registry entries owned by dead instances.
   * The actual transport is already dead; this is registry cleanup only.
   * Admin-only trigger — never called automatically.
   */
  async cleanupStaleSessions(): Promise<{ removedCount: number; sessionIds: string[] }> {
    const staleSessions = await this.detectStaleSessions();
    if (staleSessions.length === 0) return { removedCount: 0, sessionIds: [] };

    const removedIds: string[] = [];

    for (const session of staleSessions) {
      await this.deregister(session.sessionId);
      removedIds.push(session.sessionId);
    }

    if (removedIds.length > 0) {
      this.logger.log(`Cleaned up ${removedIds.length} stale session(s): ${removedIds.join(', ')}`);
    }

    return { removedCount: removedIds.length, sessionIds: removedIds };
  }
}
