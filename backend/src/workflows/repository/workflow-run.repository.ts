import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  workflowRunsTable,
  humanInputRequests as humanInputRequestsTable,
  scopes as scopesTable,
  type WorkflowRunInsert,
  type WorkflowRunRecord,
} from '../../database/schema';
import type { ExecutionInputPreview, ExecutionTriggerType } from '@sentris/shared';
import { TERMINAL_STATUSES } from '@sentris/shared';
import { enqueueOutboxEvent, type OutboxExecutor } from '../../outbox/enqueue-outbox-event';
import type { ReportableTerminalStatus } from '../dto/run-finalization.dto';
import type { WorkflowTransactionExecutor } from './workflow-transaction-executor';

interface CreateWorkflowRunInput {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  temporalRunId?: string | null;
  parentRunId?: string | null;
  parentNodeRef?: string | null;
  scopeId?: string | null;
  totalActions: number;
  inputs: Record<string, unknown>;
  organizationId?: string | null;
  triggerType: ExecutionTriggerType;
  triggerSource?: string | null;
  triggerLabel?: string | null;
  inputPreview?: ExecutionInputPreview;
}

export interface UnfinalizedRunCursor {
  createdAt: Date;
  runId: string;
}

type PreparedRunHook = (executor: OutboxExecutor, record: WorkflowRunRecord) => Promise<void>;
type StartedRunHook = (
  executor: WorkflowTransactionExecutor,
  record: WorkflowRunRecord,
) => Promise<void>;

@Injectable()
export class WorkflowRunRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async prepare(
    input: CreateWorkflowRunInput,
    onPrepared?: PreparedRunHook,
  ): Promise<{ record: WorkflowRunRecord; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const values = this.buildInsertValues(input);
      const [inserted] = await tx
        .insert(workflowRunsTable)
        .values(values)
        .onConflictDoNothing({ target: workflowRunsTable.runId })
        .returning();

      if (inserted) {
        await onPrepared?.(tx, inserted);
        return { record: inserted, created: true };
      }

      const [existing] = await tx
        .select()
        .from(workflowRunsTable)
        .where(eq(workflowRunsTable.runId, input.runId))
        .limit(1);
      if (!existing || !this.matchesPreparedExecution(existing, input)) {
        throw new ConflictException(
          'Idempotency key was already used for a different workflow run request',
        );
      }

      return { record: existing, created: false };
    });
  }

  async markStarted(
    input: {
      runId: string;
      workflowId: string;
      organizationId: string | null;
      temporalRunId: string;
    },
    onTransition?: StartedRunHook,
  ): Promise<{ record: WorkflowRunRecord; transitioned: boolean }> {
    return this.db.transaction(async (tx) => {
      const organizationMatches =
        input.organizationId == null
          ? isNull(workflowRunsTable.organizationId)
          : eq(workflowRunsTable.organizationId, input.organizationId);
      const [started] = await tx
        .update(workflowRunsTable)
        .set({
          temporalRunId: input.temporalRunId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRunsTable.runId, input.runId),
            eq(workflowRunsTable.workflowId, input.workflowId),
            organizationMatches,
            isNull(workflowRunsTable.temporalRunId),
          ),
        )
        .returning();

      if (started) {
        await onTransition?.(tx, started);
        return { record: started, transitioned: true };
      }

      const [existing] = await tx
        .select()
        .from(workflowRunsTable)
        .where(eq(workflowRunsTable.runId, input.runId))
        .limit(1);
      if (
        !existing ||
        existing.workflowId !== input.workflowId ||
        existing.organizationId !== input.organizationId ||
        existing.temporalRunId !== input.temporalRunId
      ) {
        throw new ConflictException('Workflow run points at a different Temporal execution');
      }

      return { record: existing, transitioned: false };
    });
  }

  private buildInsertValues(input: CreateWorkflowRunInput): WorkflowRunInsert {
    const values: WorkflowRunInsert = {
      runId: input.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      workflowVersion: input.workflowVersion,
      totalActions: input.totalActions,
      inputs: input.inputs ?? {},
      triggerType: input.triggerType,
      triggerSource: input.triggerSource ?? null,
      triggerLabel: input.triggerLabel ?? 'Manual run',
      inputPreview: input.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
      updatedAt: new Date(),
      organizationId: input.organizationId ?? null,
    };
    if (input.parentRunId !== undefined) {
      values.parentRunId = input.parentRunId ?? null;
    }
    if (input.parentNodeRef !== undefined) {
      values.parentNodeRef = input.parentNodeRef ?? null;
    }
    if (input.scopeId !== undefined) {
      values.scopeId = input.scopeId ?? null;
    }
    if (input.temporalRunId !== undefined) {
      values.temporalRunId = input.temporalRunId;
    }
    return values;
  }

  private matchesPreparedExecution(
    existing: WorkflowRunRecord,
    input: CreateWorkflowRunInput,
  ): boolean {
    return (
      existing.workflowId === input.workflowId &&
      existing.organizationId === (input.organizationId ?? null) &&
      existing.workflowVersionId === input.workflowVersionId &&
      existing.workflowVersion === input.workflowVersion &&
      existing.totalActions === input.totalActions &&
      isDeepStrictEqual(existing.inputs, input.inputs ?? {}) &&
      existing.triggerType === input.triggerType &&
      existing.triggerSource === (input.triggerSource ?? null) &&
      existing.triggerLabel === (input.triggerLabel ?? 'Manual run') &&
      isDeepStrictEqual(
        existing.inputPreview,
        input.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
      ) &&
      existing.parentRunId === (input.parentRunId ?? null) &&
      existing.parentNodeRef === (input.parentNodeRef ?? null) &&
      existing.scopeId === (input.scopeId ?? null)
    );
  }

  async scopeBelongsToOrganization(scopeId: string, organizationId: string): Promise<boolean> {
    const [scope] = await this.db
      .select({ id: scopesTable.id })
      .from(scopesTable)
      .where(and(eq(scopesTable.id, scopeId), eq(scopesTable.organizationId, organizationId)))
      .limit(1);
    return Boolean(scope);
  }

  async findByRunId(
    runId: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowRunRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowRunsTable)
      .where(this.buildRunFilter(runId, options.organizationId))
      .limit(1);
    return record;
  }

  async list(
    options: {
      workflowId?: string;
      status?: string;
      limit?: number;
      offset?: number;
      organizationId?: string | null;
      parentRunId?: string;
      onlyRoots?: boolean;
      scopeId?: string;
    } = {},
  ): Promise<WorkflowRunRecord[]> {
    const conditions: SQL[] = [];

    if (options.workflowId) {
      conditions.push(eq(workflowRunsTable.workflowId, options.workflowId));
    }

    if (options.organizationId) {
      conditions.push(eq(workflowRunsTable.organizationId, options.organizationId));
    }

    if (options.parentRunId) {
      conditions.push(eq(workflowRunsTable.parentRunId, options.parentRunId));
    }

    if (options.scopeId) {
      conditions.push(eq(workflowRunsTable.scopeId, options.scopeId));
    }

    if (options.onlyRoots) {
      conditions.push(sql`${workflowRunsTable.parentRunId} IS NULL`);
    }

    const baseQuery = this.db.select().from(workflowRunsTable);
    const filteredQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

    return await filteredQuery
      .orderBy(desc(workflowRunsTable.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
  }

  async listChildren(
    parentRunId: string,
    options: { organizationId?: string | null; limit?: number } = {},
  ): Promise<WorkflowRunRecord[]> {
    const conditions: SQL[] = [eq(workflowRunsTable.parentRunId, parentRunId)];
    if (options.organizationId) {
      conditions.push(eq(workflowRunsTable.organizationId, options.organizationId));
    }

    return this.db
      .select()
      .from(workflowRunsTable)
      .where(and(...conditions))
      .orderBy(desc(workflowRunsTable.createdAt))
      .limit(options.limit ?? 200);
  }

  async hasPendingInputs(runId: string): Promise<boolean> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(humanInputRequestsTable)
      .where(
        and(
          eq(humanInputRequestsTable.runId, runId),
          eq(humanInputRequestsTable.status, 'pending'),
        ),
      );
    return Number(result.count) > 0;
  }

  async finalizeTerminalRun(input: {
    runId: string;
    organizationId: string;
    status: ReportableTerminalStatus;
    completedAt: Date;
  }): Promise<{ record: WorkflowRunRecord; duplicate: boolean } | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(workflowRunsTable)
        .where(
          and(
            eq(workflowRunsTable.runId, input.runId),
            eq(workflowRunsTable.organizationId, input.organizationId),
          ),
        )
        .for('update')
        .limit(1);

      if (!existing) return undefined;

      const alreadyTerminal = (TERMINAL_STATUSES as readonly string[]).includes(
        existing.status ?? '',
      );
      let record = existing;
      if (!alreadyTerminal) {
        const [updated] = await tx
          .update(workflowRunsTable)
          .set({
            status: input.status,
            closeTime: input.completedAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workflowRunsTable.runId, input.runId),
              eq(workflowRunsTable.organizationId, input.organizationId),
            ),
          )
          .returning();
        if (!updated) return undefined;
        record = updated;
      }

      const status = record.status as ReportableTerminalStatus;
      const completedAt = record.closeTime ?? input.completedAt;
      await enqueueOutboxEvent(tx, {
        eventType: 'run.status.terminal',
        organizationId: input.organizationId,
        aggregateType: 'workflow_run',
        aggregateId: input.runId,
        dedupeKey: `run.status.terminal:${input.runId}`,
        payload: {
          runId: record.runId,
          workflowId: record.workflowId,
          organizationId: input.organizationId,
          status,
          completedAt: completedAt.toISOString(),
        },
      });

      return { record, duplicate: alreadyTerminal };
    });
  }

  async listUnfinalized(
    options: { limit?: number; after?: UnfinalizedRunCursor } = {},
  ): Promise<WorkflowRunRecord[]> {
    const conditions: SQL[] = [
      isNotNull(workflowRunsTable.organizationId),
      or(
        isNull(workflowRunsTable.status),
        notInArray(workflowRunsTable.status, [...TERMINAL_STATUSES]),
      )!,
    ];
    if (options.after) {
      conditions.push(
        or(
          gt(workflowRunsTable.createdAt, options.after.createdAt),
          and(
            eq(workflowRunsTable.createdAt, options.after.createdAt),
            gt(workflowRunsTable.runId, options.after.runId),
          ),
        )!,
      );
    }

    return this.db
      .select()
      .from(workflowRunsTable)
      .where(and(...conditions))
      .orderBy(asc(workflowRunsTable.createdAt), asc(workflowRunsTable.runId))
      .limit(Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 200)));
  }

  async listRunIdsByScope(
    scopeId: string,
    organizationId: string,
    limit = 5000,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ runId: workflowRunsTable.runId })
      .from(workflowRunsTable)
      .where(
        and(
          eq(workflowRunsTable.scopeId, scopeId),
          eq(workflowRunsTable.organizationId, organizationId),
        ),
      )
      .limit(limit);
    return rows.map((r) => r.runId);
  }

  private buildRunFilter(runId: string, organizationId?: string | null) {
    const base = eq(workflowRunsTable.runId, runId);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(workflowRunsTable.organizationId, organizationId));
  }
}
