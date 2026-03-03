import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { WorkflowDefinition } from '../../dsl/types';
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { workflowsTable } from '../../database/schema/workflows';
import { DRIZZLE_TOKEN } from '../../database/database.module';

export type WorkflowRecord = typeof workflowsTable.$inferSelect;

export interface WorkflowSummaryRecord {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  /** Raw SQL may return a string instead of Date for timestamp columns. */
  lastRun: Date | string | null;
  latestRunStatus: string | null;
  runCount: number;
  nodeCount: number;
  /** Raw SQL may return a string instead of Date for timestamp columns. */
  createdAt: Date | string;
  /** Raw SQL may return a string instead of Date for timestamp columns. */
  updatedAt: Date | string;
}

type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export interface WorkflowRepositoryOptions {
  organizationId?: string | null;
}

@Injectable()
export class WorkflowRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(
    input: WorkflowGraph,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .insert(workflowsTable)
      .values({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        compiledDefinition: null,
        organizationId: options.organizationId ?? null,
      })
      .returning();

    return record;
  }

  async update(
    id: string,
    input: WorkflowGraph,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async updateMetadata(
    id: string,
    metadata: { name: string; description?: string | null },
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        name: metadata.name,
        description: metadata.description ?? null,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async saveCompiledDefinition(
    id: string,
    definition: WorkflowDefinition,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        compiledDefinition: definition,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async findById(
    id: string,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowsTable)
      .where(this.buildIdFilter(id, options.organizationId))
      .limit(1);
    return record;
  }

  async findByIds(
    ids: string[],
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord[]> {
    if (ids.length === 0) return [];
    if (ids.length > 500) {
      throw new Error(
        `findByIds: input size ${ids.length} exceeds maximum of 500. Chunk the request or narrow the query.`,
      );
    }
    const filter = options.organizationId
      ? and(
          inArray(workflowsTable.id, ids),
          eq(workflowsTable.organizationId, options.organizationId),
        )
      : inArray(workflowsTable.id, ids);
    return this.db.select().from(workflowsTable).where(filter);
  }

  async delete(id: string, options: WorkflowRepositoryOptions = {}): Promise<void> {
    await this.db.delete(workflowsTable).where(this.buildIdFilter(id, options.organizationId));
  }

  async list(
    options: WorkflowRepositoryOptions & { limit?: number } = {},
  ): Promise<WorkflowRecord[]> {
    const limit = options.limit ?? 100;
    if (options.organizationId) {
      return this.db
        .select()
        .from(workflowsTable)
        .where(eq(workflowsTable.organizationId, options.organizationId))
        .limit(limit);
    }
    return this.db.select().from(workflowsTable).limit(limit);
  }

  async listSummary(
    options: WorkflowRepositoryOptions & { limit?: number } = {},
  ): Promise<WorkflowSummaryRecord[]> {
    const limit = options.limit ?? 100;

    // Use a LATERAL JOIN to fetch latest run status in a single pass,
    // avoiding the N+1 correlated subquery that ran once per workflow row.
    const result = await this.db.execute(sql`
      SELECT
        w.id,
        w.name,
        w.description,
        w.organization_id AS "organizationId",
        w.last_run AS "lastRun",
        lr.status AS "latestRunStatus",
        w.run_count AS "runCount",
        coalesce(jsonb_array_length(w.graph->'nodes'), 0)::int AS "nodeCount",
        w.created_at AS "createdAt",
        w.updated_at AS "updatedAt"
      FROM workflows w
      LEFT JOIN LATERAL (
        SELECT wr.status
        FROM workflow_runs wr
        WHERE wr.workflow_id = w.id
        ORDER BY wr.created_at DESC
        LIMIT 1
      ) lr ON true
      ${options.organizationId ? sql`WHERE w.organization_id = ${options.organizationId}` : sql``}
      ORDER BY w.updated_at DESC
      LIMIT ${limit}
    `);

    return result.rows as unknown as WorkflowSummaryRecord[];
  }

  async incrementRunCount(
    id: string,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        lastRun: new Date(),
        runCount: sql`${workflowsTable.runCount} + 1`,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  private buildIdFilter(id: string, organizationId?: string | null) {
    const idFilter = eq(workflowsTable.id, id);
    if (!organizationId) {
      return idFilter;
    }
    return and(idFilter, eq(workflowsTable.organizationId, organizationId));
  }
}
