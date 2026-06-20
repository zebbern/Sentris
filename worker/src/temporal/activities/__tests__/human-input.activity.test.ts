import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import type { ITraceService } from '@sentris/component-sdk';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../adapters/schema';
import {
  cancelHumanInputRequestActivity,
  createHumanInputRequestActivity,
  expireHumanInputRequestActivity,
  initializeHumanInputActivity,
} from '../human-input.activity';

const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

function createMockDatabase() {
  const values = vi.fn(async () => {});
  const where = vi.fn(async () => {});
  const set = vi.fn(() => ({ where }));

  return {
    values,
    where,
    set,
    db: {
      insert: vi.fn(() => ({ values })),
      update: vi.fn(() => ({ set })),
    },
  };
}

describe('human input activity diagnostics', () => {
  beforeEach(() => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDebugWorkflow === undefined) {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;
    } else {
      process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
    }
  });

  test('createHumanInputRequestActivity does not mirror successful creation diagnostics to console.log by default', async () => {
    const database = createMockDatabase();
    const trace = { record: vi.fn() };
    initializeHumanInputActivity({
      database: database.db as unknown as NodePgDatabase<typeof schema>,
      trace: trace as unknown as ITraceService,
      baseUrl: 'https://sentris.test',
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const result = await createHumanInputRequestActivity({
        runId: 'run-1',
        workflowId: 'workflow-1',
        nodeRef: 'approval-node',
        inputType: 'approval',
        title: 'Approve deployment',
        description: 'Check the deployment',
        organizationId: 'org-1',
      });

      expect(result.resolveUrl).toStartWith('https://sentris.test/api/v1/human-inputs/resolve/');
      expect(database.db.insert).toHaveBeenCalledWith(schema.humanInputRequestsTable);
      expect(database.values).toHaveBeenCalledTimes(1);
      expect(trace.record).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test('cancelHumanInputRequestActivity does not mirror successful cancellation diagnostics to console.log by default', async () => {
    const database = createMockDatabase();
    initializeHumanInputActivity({
      database: database.db as unknown as NodePgDatabase<typeof schema>,
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await cancelHumanInputRequestActivity('request-1');

      expect(database.db.update).toHaveBeenCalledWith(schema.humanInputRequestsTable);
      expect(database.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
      expect(database.where).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test('expireHumanInputRequestActivity does not mirror successful expiration diagnostics to console.log by default', async () => {
    const database = createMockDatabase();
    initializeHumanInputActivity({
      database: database.db as unknown as NodePgDatabase<typeof schema>,
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expireHumanInputRequestActivity('request-1');

      expect(database.db.update).toHaveBeenCalledWith(schema.humanInputRequestsTable);
      expect(database.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
      expect(database.where).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
