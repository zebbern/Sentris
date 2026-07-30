import { describe, expect, it, vi } from 'bun:test';

import { AgentStreamRecorder } from '../agent-stream-recorder';

describe('AgentStreamRecorder', () => {
  it('settles queued publications and carries stable tenant-aware event identity', async () => {
    let releasePublish: (() => void) | undefined;
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const publish = vi.fn(async () => publishGate);
    const recorder = new AgentStreamRecorder(
      {
        runId: 'run-1',
        componentRef: 'agent',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        metadata: {},
        agentTracePublisher: { publish },
        emitProgress: vi.fn(),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
      'agent-run-1',
    );

    recorder.emitMessageStart();
    let settled = false;
    const flush = recorder.flush().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    releasePublish?.();
    await flush;
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'agent-run-1:1',
        agentRunId: 'agent-run-1',
        workflowRunId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        sequence: 1,
      }),
    );
  });

  it('reports an exhausted queued publication when flushed', async () => {
    const recorder = new AgentStreamRecorder(
      {
        runId: 'run-1',
        componentRef: 'agent',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        metadata: {},
        agentTracePublisher: {
          publish: vi.fn(async () => {
            throw new Error('Kafka unavailable');
          }),
        },
        emitProgress: vi.fn(),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
      'agent-run-1',
    );

    recorder.emitFinish('stop', 'done');

    await expect(recorder.flush()).rejects.toThrow('Kafka unavailable');
  });
});
