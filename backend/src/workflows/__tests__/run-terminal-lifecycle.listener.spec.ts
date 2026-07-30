import { describe, expect, it, mock } from 'bun:test';

import type { TerminalArchiveService } from '../terminal-archive.service';
import { RunTerminalLifecycleListener } from '../run-terminal-lifecycle.listener';

describe('RunTerminalLifecycleListener', () => {
  it('archives terminal output from the durable outbox event without client polling', async () => {
    const archiveRun = mock(async () => []);
    const listener = new RunTerminalLifecycleListener({
      archiveRun,
    } as unknown as TerminalArchiveService);

    await listener.handleRunTerminal({
      runId: 'run-1',
      workflowId: 'wf-1',
      organizationId: 'org-1',
      status: 'COMPLETED',
      completedAt: '2026-07-26T12:00:00.000Z',
    });

    expect(archiveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        provider: 'system',
      }),
      'run-1',
    );
  });

  it('propagates archive infrastructure failures so the outbox can retry', async () => {
    const listener = new RunTerminalLifecycleListener({
      archiveRun: mock(async () => {
        throw new Error('Redis unavailable');
      }),
    } as unknown as TerminalArchiveService);

    await expect(
      listener.handleRunTerminal({
        runId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        status: 'FAILED',
      }),
    ).rejects.toThrow('Redis unavailable');
  });
});
