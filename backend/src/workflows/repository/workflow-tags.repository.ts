import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, inArray, count } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { workflowTagsTable } from '../../database/schema/workflow-tags';
import { workflowsTable } from '../../database/schema/workflows';
import { DRIZZLE_TOKEN } from '../../database/database.module';

export interface TagWithCount {
  name: string;
  count: number;
}

@Injectable()
export class WorkflowTagsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Replace all tags for a workflow within a transaction.
   * Deletes existing tags and inserts new ones atomically.
   */
  async setTags(workflowId: string, tags: string[]): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(workflowTagsTable).where(eq(workflowTagsTable.workflowId, workflowId));

      if (tags.length === 0) {
        return [];
      }

      const rows = tags.map((name) => ({ workflowId, name }));
      await tx.insert(workflowTagsTable).values(rows);

      return tags;
    });
  }

  /**
   * Get all tag names for a specific workflow.
   */
  async getTagsByWorkflowId(workflowId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: workflowTagsTable.name })
      .from(workflowTagsTable)
      .where(eq(workflowTagsTable.workflowId, workflowId))
      .orderBy(workflowTagsTable.name);

    return rows.map((r) => r.name);
  }

  /**
   * List all unique tags with usage counts, scoped to an organization.
   * Results are sorted alphabetically by tag name.
   */
  async listAllTags(organizationId: string): Promise<TagWithCount[]> {
    const rows = await this.db
      .select({
        name: workflowTagsTable.name,
        count: count(workflowTagsTable.id),
      })
      .from(workflowTagsTable)
      .innerJoin(workflowsTable, eq(workflowTagsTable.workflowId, workflowsTable.id))
      .where(eq(workflowsTable.organizationId, organizationId))
      .groupBy(workflowTagsTable.name)
      .orderBy(workflowTagsTable.name);

    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  /**
   * Find workflow IDs that have ALL of the specified tags (intersection query).
   * Only returns workflows belonging to the given organization.
   */
  async findWorkflowIdsByTags(tags: string[], organizationId: string): Promise<string[]> {
    if (tags.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({ workflowId: workflowTagsTable.workflowId })
      .from(workflowTagsTable)
      .innerJoin(workflowsTable, eq(workflowTagsTable.workflowId, workflowsTable.id))
      .where(
        and(
          eq(workflowsTable.organizationId, organizationId),
          inArray(workflowTagsTable.name, tags),
        ),
      )
      .groupBy(workflowTagsTable.workflowId)
      .having(sql`count(distinct ${workflowTagsTable.name}) = ${tags.length}`);

    return rows.map((r) => r.workflowId);
  }

  /**
   * Get tags for multiple workflows at once (batch loading to avoid N+1).
   */
  async getTagsByWorkflowIds(workflowIds: string[]): Promise<Map<string, string[]>> {
    if (workflowIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select({
        workflowId: workflowTagsTable.workflowId,
        name: workflowTagsTable.name,
      })
      .from(workflowTagsTable)
      .where(inArray(workflowTagsTable.workflowId, workflowIds))
      .orderBy(workflowTagsTable.workflowId, workflowTagsTable.name);

    const result = new Map<string, string[]>();
    for (const row of rows) {
      const existing = result.get(row.workflowId) ?? [];
      existing.push(row.name);
      result.set(row.workflowId, existing);
    }

    return result;
  }
}
