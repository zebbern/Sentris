import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RunLifecycleEvent } from '@sentris/shared';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../../database/schema';
import type { NotificationChannelRepository } from '../repository/notification-channel.repository';
import type { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import type { SlackNotificationAdapter } from '../adapters/slack.adapter';
import { NotificationDispatcherService } from '../notification-dispatcher.service';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeChannelRecord(
  overrides: Partial<NotificationChannelRecord> = {},
): NotificationChannelRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'ch-1',
    organizationId: overrides.organizationId ?? 'org-1',
    name: overrides.name ?? 'Slack Alerts',
    type: overrides.type ?? 'slack',
    config: overrides.config ?? { webhookUrl: 'https://hooks.slack.com/services/T/B/x' },
    status: overrides.status ?? 'active',
    events: overrides.events ?? ['run.failed'],
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeDeliveryRecord(
  overrides: Partial<NotificationDeliveryRecord> = {},
): NotificationDeliveryRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'del-1',
    channelId: overrides.channelId ?? 'ch-1',
    runId: overrides.runId ?? 'run-1',
    eventType: overrides.eventType ?? 'run.failed',
    status: overrides.status ?? 'pending',
    payload: overrides.payload ?? {},
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? now,
    sentAt: overrides.sentAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  let deliverySeq = 0;
  const deliveryUpdates: { id: string; values: Partial<NotificationDeliveryRecord> }[] = [];

  const channelRepo = {
    findActiveByEventType: mock((_orgId: string, _eventType: string) =>
      Promise.resolve([] as NotificationChannelRecord[]),
    ),
  } as unknown as NotificationChannelRepository;

  const deliveryRepo = {
    create: mock((values: Partial<NotificationDeliveryRecord>) => {
      deliverySeq += 1;
      return Promise.resolve(makeDeliveryRecord({ ...values, id: `del-${deliverySeq}` }));
    }),
    update: mock((id: string, values: Partial<NotificationDeliveryRecord>) => {
      deliveryUpdates.push({ id, values });
      return Promise.resolve(makeDeliveryRecord({ id, ...values }));
    }),
  } as unknown as NotificationDeliveryRepository;

  const slackAdapter = {
    send: mock(() => Promise.resolve({ success: true } as { success: boolean; error?: string })),
  } as unknown as SlackNotificationAdapter;

  return { channelRepo, deliveryRepo, slackAdapter, deliveryUpdates };
}

// ---------------------------------------------------------------------------
// Test payload
// ---------------------------------------------------------------------------

const failedRunEvent: RunLifecycleEvent = {
  runId: 'run-100',
  workflowId: 'wf-1',
  organizationId: 'org-1',
  status: 'FAILED',
  completedAt: new Date().toISOString(),
};

const completedRunEvent: RunLifecycleEvent = {
  runId: 'run-200',
  workflowId: 'wf-2',
  organizationId: 'org-1',
  status: 'COMPLETED',
  completedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationDispatcherService', () => {
  let dispatcher: NotificationDispatcherService;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    dispatcher = new NotificationDispatcherService(
      mocks.channelRepo,
      mocks.deliveryRepo,
      mocks.slackAdapter,
    );
  });

  it('does nothing when no channels match the event', async () => {
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([]));

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.channelRepo.findActiveByEventType).toHaveBeenCalledTimes(1);
    expect(mocks.deliveryRepo.create).not.toHaveBeenCalled();
    expect(mocks.slackAdapter.send).not.toHaveBeenCalled();
  });

  it('maps FAILED status to run.failed event type', async () => {
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([]));

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.channelRepo.findActiveByEventType).toHaveBeenCalledWith('org-1', 'run.failed');
  });

  it('maps COMPLETED status to run.completed event type', async () => {
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([]));

    await dispatcher.handleRunTerminal(completedRunEvent);

    expect(mocks.channelRepo.findActiveByEventType).toHaveBeenCalledWith('org-1', 'run.completed');
  });

  it('creates a pending delivery and calls Slack adapter for matching channel', async () => {
    const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([channel]));

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.deliveryRepo.create).toHaveBeenCalledTimes(1);
    const createCall = (mocks.deliveryRepo.create as any).mock.calls[0][0];
    expect(createCall.channelId).toBe('ch-10');
    expect(createCall.status).toBe('pending');
    expect(createCall.eventType).toBe('run.failed');

    expect(mocks.slackAdapter.send).toHaveBeenCalledTimes(1);
  });

  it('updates delivery to sent on adapter success', async () => {
    const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([channel]));
    (mocks.slackAdapter.send as any).mockReturnValue(Promise.resolve({ success: true }));

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(1);
    const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
    expect(updateCall[1].status).toBe('sent');
    expect(updateCall[1].sentAt).toBeInstanceOf(Date);
  });

  it('updates delivery to failed on adapter failure', async () => {
    const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([channel]));
    (mocks.slackAdapter.send as any).mockReturnValue(
      Promise.resolve({ success: false, error: 'Slack error' }),
    );

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(1);
    const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
    expect(updateCall[1].status).toBe('failed');
    expect(updateCall[1].errorMessage).toBe('Slack error');
  });

  it('updates delivery to failed when adapter throws', async () => {
    const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([channel]));
    (mocks.slackAdapter.send as any).mockReturnValue(Promise.reject(new Error('Network timeout')));

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(1);
    const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
    expect(updateCall[1].status).toBe('failed');
    expect(updateCall[1].errorMessage).toBe('Network timeout');
  });

  it('dispatches to multiple channels in parallel via Promise.allSettled', async () => {
    const ch1 = makeChannelRecord({ id: 'ch-1', type: 'slack', name: 'Channel 1' });
    const ch2 = makeChannelRecord({ id: 'ch-2', type: 'slack', name: 'Channel 2' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([ch1, ch2]));

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.deliveryRepo.create).toHaveBeenCalledTimes(2);
    expect(mocks.slackAdapter.send).toHaveBeenCalledTimes(2);
    expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(2);
  });

  it('individual channel failure does not affect others', async () => {
    const ch1 = makeChannelRecord({ id: 'ch-1', type: 'slack', name: 'Fail' });
    const ch2 = makeChannelRecord({ id: 'ch-2', type: 'slack', name: 'OK' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(Promise.resolve([ch1, ch2]));

    let callCount = 0;
    (mocks.slackAdapter.send as any).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({ success: false, error: 'fail' });
      }
      return Promise.resolve({ success: true });
    });

    await dispatcher.handleRunTerminal(failedRunEvent);

    // Both channels should have been attempted
    expect(mocks.slackAdapter.send).toHaveBeenCalledTimes(2);
    expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(2);
  });

  it('skips unknown status values gracefully', async () => {
    const event: RunLifecycleEvent = {
      runId: 'run-x',
      workflowId: 'wf-x',
      organizationId: 'org-1',
      status: 'UNKNOWN_STATUS',
    };

    await dispatcher.handleRunTerminal(event);

    expect(mocks.channelRepo.findActiveByEventType).not.toHaveBeenCalled();
  });

  it('handles non-slack channel type with failure result', async () => {
    const emailChannel = makeChannelRecord({ id: 'ch-email', type: 'email' });
    (mocks.channelRepo.findActiveByEventType as any).mockReturnValue(
      Promise.resolve([emailChannel]),
    );

    await dispatcher.handleRunTerminal(failedRunEvent);

    expect(mocks.slackAdapter.send).not.toHaveBeenCalled();
    const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
    expect(updateCall[1].status).toBe('failed');
    expect(updateCall[1].errorMessage).toContain('not implemented');
  });
});
