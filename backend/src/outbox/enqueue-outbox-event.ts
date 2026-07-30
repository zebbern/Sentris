import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { outboxEventsTable, type OutboxEventInsert } from '../database/schema';
import * as databaseSchema from '../database/schema';

export interface EnqueueOutboxEventInput {
  eventType: string;
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
}

export type OutboxExecutor = Pick<NodePgDatabase<typeof databaseSchema>, 'insert'>;

/**
 * Enqueues an event using the caller's database or transaction executor.
 * The dedupe key makes repeated callbacks and transaction retries idempotent.
 */
export async function enqueueOutboxEvent(
  executor: OutboxExecutor,
  input: EnqueueOutboxEventInput,
): Promise<void> {
  const values: OutboxEventInsert = {
    eventType: input.eventType,
    organizationId: input.organizationId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    maxAttempts: input.maxAttempts ?? 8,
    availableAt: input.availableAt ?? new Date(),
  };

  await executor
    .insert(outboxEventsTable)
    .values(values)
    .onConflictDoNothing({ target: outboxEventsTable.dedupeKey });
}
