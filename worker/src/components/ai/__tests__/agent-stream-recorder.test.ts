import { describe, expect, it, vi } from 'bun:test';

import type { AgentTraceEvent } from '@sentris/component-sdk';

import { AgentStreamRecorder } from '../agent-stream-recorder';

function contextWithPublisher(published: AgentTraceEvent[]) {
  return {
    runId: 'run-1',
    componentRef: 'agent',
    workflowId: 'wf-1',
    organizationId: 'org-1',
    metadata: {},
    agentTracePublisher: {
      publish: (event: AgentTraceEvent) => {
        published.push(event);
      },
    },
    emitProgress: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never;
}

describe('AgentStreamRecorder', () => {
  it('preserves whitespace and flushes coalesced text before a tool event', async () => {
    const published: AgentTraceEvent[] = [];
    const recorder = new AgentStreamRecorder(contextWithPublisher(published), 'agent-run-1', {
      textFlushIntervalMs: 5,
      textFlushMaxChars: 1024,
    });

    recorder.emitTextDelta('Hello');
    recorder.emitTextDelta(' world\n');
    recorder.emitToolInput('call-1', 'lookup', { package: 'lodash' });
    await recorder.flush();

    expect(published.map((event) => event.part)).toEqual([
      { type: 'data-text-start', data: { id: 'agent-run-1:text' } },
      { type: 'text-delta', id: 'agent-run-1:text', textDelta: 'Hello world\n' },
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'lookup',
        input: { package: 'lodash' },
      },
    ]);
  });

  it('publishes a small text buffer on the live flush interval', async () => {
    const published: AgentTraceEvent[] = [];
    const recorder = new AgentStreamRecorder(contextWithPublisher(published), 'agent-run-1', {
      textFlushIntervalMs: 5,
      textFlushMaxChars: 1024,
    });

    recorder.emitTextDelta('early');
    await Promise.resolve();
    await Promise.resolve();

    expect(published.map((event) => event.part)).toEqual([
      { type: 'data-text-start', data: { id: 'agent-run-1:text' } },
    ]);

    await Bun.sleep(15);
    await recorder.flush();

    expect(published.map((event) => event.part)).toEqual([
      { type: 'data-text-start', data: { id: 'agent-run-1:text' } },
      { type: 'text-delta', id: 'agent-run-1:text', textDelta: 'early' },
    ]);
  });

  it('emits only one terminal part and closes the active text id', async () => {
    const published: AgentTraceEvent[] = [];
    const recorder = new AgentStreamRecorder(contextWithPublisher(published), 'agent-run-1');
    recorder.emitTextDelta('done');
    recorder.emitFinish('stop', 'done');
    recorder.emitFinish('stop', 'duplicate');
    await recorder.flush();

    expect(published.filter((event) => event.part.type === 'finish')).toHaveLength(1);
    expect(published.find((event) => event.part.type === 'data-text-end')?.part).toEqual({
      type: 'data-text-end',
      data: { id: 'agent-run-1:text' },
    });
  });

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
