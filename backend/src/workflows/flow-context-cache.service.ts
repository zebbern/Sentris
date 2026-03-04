/**
 * Flow Context Cache Service
 *
 * Redis-backed cache for FlowContext objects used during data-flow packet
 * resolution. Stores the compiled targetsBySource index so any instance
 * can resolve packets without re-compiling the workflow graph.
 *
 * Redis key pattern: sentris:flow-context:{runId}
 * TTL: 600s (10 minutes, matching FLOW_CONTEXT_TTL_MS)
 *
 * Non-fatal: cache failures are logged but never break workflow functionality.
 * Falls back to in-memory Map in WorkflowsService.
 */

import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';

import { FLOW_CONTEXT_REDIS } from './workflows.tokens';

const FLOW_CONTEXT_TTL_SECONDS = 600; // 10 minutes
const KEY_PREFIX = 'sentris:flow-context:';

interface SerializedFlowContext {
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  targetsBySource: Record<string, { targetRef: string; sourceHandle: string; inputKey: string }[]>;
}

export interface CachedFlowContext {
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  targetsBySource: Map<string, { targetRef: string; sourceHandle: string; inputKey: string }[]>;
}

@Injectable()
export class FlowContextCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(FlowContextCacheService.name);

  constructor(@Inject(FLOW_CONTEXT_REDIS) private readonly redis: Redis | null) {}

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
   * Retrieve a cached FlowContext from Redis.
   * Returns null if not found, Redis unavailable, or deserialization fails.
   */
  async get(runId: string): Promise<CachedFlowContext | null> {
    if (!this.redis) return null;

    try {
      const raw = await this.redis.get(this.getKey(runId));
      if (!raw) return null;

      const parsed = JSON.parse(raw) as SerializedFlowContext;
      return {
        workflowId: parsed.workflowId,
        workflowVersionId: parsed.workflowVersionId,
        workflowVersion: parsed.workflowVersion,
        targetsBySource: new Map(Object.entries(parsed.targetsBySource)),
      };
    } catch (error) {
      this.logger.warn(`Failed to get flow context for run ${runId}: ${error}`);
      return null;
    }
  }

  /**
   * Store a FlowContext in Redis with TTL.
   * Converts targetsBySource Map to a plain object for JSON serialization.
   * The definition field is intentionally omitted — it is large and only
   * targetsBySource is needed for data-flow packet resolution.
   */
  async set(runId: string, context: CachedFlowContext): Promise<void> {
    if (!this.redis) return;

    try {
      const serialized: SerializedFlowContext = {
        workflowId: context.workflowId,
        workflowVersionId: context.workflowVersionId,
        workflowVersion: context.workflowVersion,
        targetsBySource: Object.fromEntries(context.targetsBySource),
      };

      await this.redis.set(
        this.getKey(runId),
        JSON.stringify(serialized),
        'EX',
        FLOW_CONTEXT_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Failed to cache flow context for run ${runId}: ${error}`);
    }
  }

  /**
   * Remove a cached FlowContext from Redis.
   */
  async delete(runId: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(this.getKey(runId));
    } catch (error) {
      this.logger.warn(`Failed to delete flow context for run ${runId}: ${error}`);
    }
  }
}
