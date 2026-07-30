import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq, gt } from 'drizzle-orm';

import { getPostgresErrorCode, PG_ERROR } from '../common/postgres-error';
import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  scopes,
  workflowRunsTable,
  type ScopeRecord,
  type NewScopeRecord,
} from '../database/schema';

export interface ScopeUpdateData {
  name?: string;
  description?: string | null;
  domains?: string[];
  repos?: string[];
  ipRanges?: string[];
  runtimeValues?: Record<string, unknown>;
}

@Injectable()
export class ScopesRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listByOrganization(organizationId: string): Promise<ScopeRecord[]> {
    return this.db
      .select()
      .from(scopes)
      .where(eq(scopes.organizationId, organizationId))
      .orderBy(scopes.name);
  }

  async findById(id: string, organizationId: string): Promise<ScopeRecord | null> {
    const rows = await this.db
      .select()
      .from(scopes)
      .where(and(eq(scopes.id, id), eq(scopes.organizationId, organizationId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listRunIdsPage(
    scopeId: string,
    organizationId: string,
    afterRunId: string | undefined,
    limit: number,
  ): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 2_000));
    const rows = await this.db
      .select({ runId: workflowRunsTable.runId })
      .from(workflowRunsTable)
      .where(
        and(
          eq(workflowRunsTable.organizationId, organizationId),
          eq(workflowRunsTable.scopeId, scopeId),
          afterRunId ? gt(workflowRunsTable.runId, afterRunId) : undefined,
        ),
      )
      .orderBy(asc(workflowRunsTable.runId))
      .limit(boundedLimit);
    return rows.map((row) => row.runId);
  }

  async create(data: NewScopeRecord): Promise<ScopeRecord> {
    try {
      const rows = await this.db.insert(scopes).values(data).returning();
      return rows[0]!;
    } catch (error) {
      if (getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION) {
        throw new ConflictException('A scope with this name already exists');
      }
      throw error;
    }
  }

  async update(id: string, organizationId: string, data: ScopeUpdateData): Promise<ScopeRecord> {
    try {
      const rows = await this.db
        .update(scopes)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(scopes.id, id), eq(scopes.organizationId, organizationId)))
        .returning();
      if (!rows[0]) {
        throw new NotFoundException(`Scope ${id} not found`);
      }
      return rows[0];
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION) {
        throw new ConflictException('A scope with this name already exists');
      }
      throw error;
    }
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const rows = await this.db
      .delete(scopes)
      .where(and(eq(scopes.id, id), eq(scopes.organizationId, organizationId)))
      .returning({ id: scopes.id });
    if (!rows[0]) {
      throw new NotFoundException(`Scope ${id} not found`);
    }
  }
}
