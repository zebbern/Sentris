import { describe, expect, it } from 'bun:test';

import type { WorkflowTraceRecord } from '../../database/schema';
import { TraceService } from '../trace.service';
import type { AuthContext } from '../../auth/types';

class FakeTraceRepository {
  public events: WorkflowTraceRecord[] = [];
  public summaryRequests: {
    runId: string;
    options: { failedLimit: number; recentLimit: number };
    organizationId?: string | null;
  }[] = [];

  async listByRunId(runId: string): Promise<WorkflowTraceRecord[]> {
    return this.events
      .filter((event) => event.runId === runId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async listAfterSequence(runId: string, sequence: number): Promise<WorkflowTraceRecord[]> {
    return this.events
      .filter((event) => event.runId === runId && event.sequence > sequence)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async summarizeRun(
    runId: string,
    options: { failedLimit: number; recentLimit: number },
    organizationId?: string | null,
  ) {
    this.summaryRequests.push({ runId, options, organizationId });
    const events = this.events
      .filter((event) => event.runId === runId)
      .sort((a, b) => a.sequence - b.sequence);
    const failed = events.filter(
      (event) =>
        event.level === 'error' ||
        event.type === 'NODE_FAILED' ||
        event.type === 'HTTP_REQUEST_ERROR',
    );
    return {
      totalEvents: events.length,
      failedEventCount: failed.length,
      failed: failed.slice(-options.failedLimit),
      recent: events.slice(-options.recentLimit),
    };
  }
}

describe('TraceService', () => {
  const repository = new FakeTraceRepository();
  const service = new TraceService(repository as any);
  const runId = 'service-run';
  const authContext: AuthContext = {
    userId: 'test-user',
    organizationId: 'test-org',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };

  it('maps stored records to trace events', async () => {
    repository.events = [
      {
        id: 1,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_STARTED',
        nodeRef: 'node-1',
        timestamp: new Date('2025-01-01T00:00:00.000Z'),
        message: null,
        error: null,
        outputSummary: null,
        level: 'info',
        data: null,
        sequence: 1,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        organizationId: 'test-org',
      },
      {
        id: 2,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_PROGRESS',
        nodeRef: 'node-1',
        timestamp: new Date('2025-01-01T00:00:01.000Z'),
        message: 'Working',
        error: null,
        outputSummary: null,
        level: 'info',
        data: null,
        sequence: 2,
        createdAt: new Date('2025-01-01T00:00:01.000Z'),
        organizationId: 'test-org',
      },
      {
        id: 3,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_COMPLETED',
        nodeRef: 'node-1',
        timestamp: new Date('2025-01-01T00:00:02.000Z'),
        message: null,
        error: null,
        outputSummary: { ok: true },
        level: 'info',
        data: null,
        sequence: 3,
        createdAt: new Date('2025-01-01T00:00:02.000Z'),
        organizationId: 'test-org',
      },
      {
        id: 4,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_FAILED',
        nodeRef: 'node-2',
        timestamp: new Date('2025-01-01T00:00:03.000Z'),
        message: null,
        error: 'Oops',
        outputSummary: null,
        level: 'error',
        data: null,
        sequence: 4,
        createdAt: new Date('2025-01-01T00:00:03.000Z'),
        organizationId: 'test-org',
      },
    ];

    const { events, cursor } = await service.list(runId, authContext);
    expect(events).toEqual([
      {
        id: '1',
        type: 'STARTED',
        level: 'info',
        runId,
        nodeId: 'node-1',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: undefined,
        error: undefined,
        outputSummary: undefined,
        data: undefined,
      },
      {
        id: '2',
        type: 'PROGRESS',
        level: 'info',
        runId,
        nodeId: 'node-1',
        timestamp: '2025-01-01T00:00:01.000Z',
        message: 'Working',
        error: undefined,
        outputSummary: undefined,
        data: undefined,
      },
      {
        id: '3',
        type: 'COMPLETED',
        level: 'info',
        runId,
        nodeId: 'node-1',
        timestamp: '2025-01-01T00:00:02.000Z',
        message: undefined,
        error: undefined,
        outputSummary: { ok: true },
        data: undefined,
      },
      {
        id: '4',
        type: 'FAILED',
        level: 'error',
        runId,
        nodeId: 'node-2',
        timestamp: '2025-01-01T00:00:03.000Z',
        message: undefined,
        error: { message: 'Oops' },
        outputSummary: undefined,
        data: undefined,
      },
    ]);
    expect(cursor).toBe('4');
  });

  it('lists events after a sequence cursor', async () => {
    const { events } = await service.listSince(runId, 2, authContext);
    expect(events.map((event) => event.id)).toEqual(['3', '4']);
  });

  it('maps a tenant-scoped bounded run summary without loading the full trace', async () => {
    const summary = await service.summarizeRun(
      runId,
      { failedLimit: 1, recentLimit: 2 },
      authContext,
    );

    expect(repository.summaryRequests.at(-1)).toEqual({
      runId,
      options: { failedLimit: 1, recentLimit: 2 },
      organizationId: 'test-org',
    });
    expect(summary).toEqual(
      expect.objectContaining({
        totalEvents: 4,
        failedEventCount: 1,
      }),
    );
    expect(summary.failed.map((event) => event.id)).toEqual(['4']);
    expect(summary.recent.map((event) => event.id)).toEqual(['3', '4']);
  });

  it('extracts metadata and payload when stored in packed form', async () => {
    const metaRunId = 'service-run-meta';
    repository.events = [
      {
        id: 10,
        runId: metaRunId,
        workflowId: 'workflow-id',
        type: 'NODE_COMPLETED',
        nodeRef: 'node-meta',
        timestamp: new Date('2025-01-02T00:00:00.000Z'),
        message: null,
        error: null,
        outputSummary: null,
        level: 'info',
        data: {
          _metadata: {
            activityId: 'activity-42',
            attempt: 2,
            correlationId: 'corr',
          },
          _payload: {
            detail: 'value',
          },
        },
        sequence: 10,
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        organizationId: 'test-org',
      },
    ];

    const { events } = await service.list(metaRunId, authContext);
    expect(events).toEqual([
      {
        id: '10',
        type: 'COMPLETED',
        level: 'info',
        runId: metaRunId,
        nodeId: 'node-meta',
        timestamp: '2025-01-02T00:00:00.000Z',
        message: undefined,
        error: undefined,
        outputSummary: undefined,
        data: { detail: 'value' },
        metadata: {
          activityId: 'activity-42',
          attempt: 2,
          correlationId: 'corr',
        },
      },
    ]);
  });
});
