import { describe, expect, it, mock } from 'bun:test';

import { HumanInputSignalListener } from '../human-input-signal.listener';

const validEvent = {
  requestId: 'f0fb87be-d5fb-4399-bff6-a402befa96e3',
  workflowId: 'sentris-workflow-run-1',
  nodeRef: 'approval-node',
  approved: true,
  respondedBy: 'user-1',
  responseNote: 'approved',
  respondedAt: '2026-07-26T15:30:00.000Z',
  responseData: { status: 'approved', comment: 'approved' },
  outbox: {
    eventId: '7eaad15a-fe9d-4ce7-8f25-c5d415fa0cf7',
    dedupeKey: 'human-input-resolution-signal:f0fb87be-d5fb-4399-bff6-a402befa96e3',
    attempt: 1,
  },
};

describe('HumanInputSignalListener', () => {
  it('delivers the durable resolution event to the Temporal workflow', async () => {
    const signalWorkflow = mock(async () => undefined);
    const listener = new HumanInputSignalListener({ signalWorkflow } as never);

    await listener.handle(validEvent);

    expect(signalWorkflow).toHaveBeenCalledWith({
      workflowId: validEvent.workflowId,
      signalName: 'resolveHumanInput',
      args: {
        requestId: validEvent.requestId,
        nodeRef: validEvent.nodeRef,
        approved: true,
        respondedBy: 'user-1',
        responseNote: 'approved',
        respondedAt: validEvent.respondedAt,
        responseData: validEvent.responseData,
      },
    });
  });

  it('propagates Temporal failures so the outbox reschedules the event', async () => {
    const signalWorkflow = mock(async () => {
      throw new Error('Temporal unavailable');
    });
    const listener = new HumanInputSignalListener({ signalWorkflow } as never);

    await expect(listener.handle(validEvent)).rejects.toThrow('Temporal unavailable');
  });

  it('rejects malformed outbox payloads without touching Temporal', async () => {
    const signalWorkflow = mock(async () => undefined);
    const listener = new HumanInputSignalListener({ signalWorkflow } as never);

    await expect(listener.handle({ ...validEvent, workflowId: '' })).rejects.toThrow();
    expect(signalWorkflow).toHaveBeenCalledTimes(0);
  });
});
