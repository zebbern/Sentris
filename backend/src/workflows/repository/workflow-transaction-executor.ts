import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { OutboxExecutor } from '../../outbox/enqueue-outbox-event';

export type WorkflowTransactionExecutor = OutboxExecutor &
  Pick<NodePgDatabase, 'select' | 'update' | 'delete'>;

export interface WorkflowTransactionOptions {
  executor?: WorkflowTransactionExecutor;
}
