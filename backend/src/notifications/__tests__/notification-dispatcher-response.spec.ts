import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RunLifecycleEvent } from '@sentris/shared';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../../database/schema';
import type { NotificationChannelRepository } from '../repository/notification-channel.repository';
import type { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import type { SlackNotificationAdapter } from '../adapters/slack.adapter';
import type { DiscordNotificationAdapter } from '../adapters/discord.adapter';
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
    durationMs: overrides.durationMs ?? null,
    responseStatus: overrides.responseStatus ?? null,
    responseBody: overrides.responseBody ?? null,
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
    send: mock(() =>
      Promise.resolve({
        success: true,
        responseStatus: 200,
        responseBody: 'ok',
      }),
    ),
  } as unknown as SlackNotificationAdapter;

  const discordAdapter = {
    send: mock(() =>
      Promise.resolve({
        success: true,
        responseStatus: 204,
        responseBody: '',
      }),
    ),
  } as unknown as DiscordNotificationAdapter;

  return { channelRepo, deliveryRepo, slackAdapter, discordAdapter, deliveryUpdates };
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

// ---------------------------------------------------------------------------
// Tests — Response capture & durationMs
// ---------------------------------------------------------------------------

describe('NotificationDispatcherService — response capture', () => {
  let dispatcher: NotificationDispatcherService;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    dispatcher = new NotificationDispatcherService(
      mocks.channelRepo,
      mocks.deliveryRepo,
      mocks.slackAdapter,
      mocks.discordAdapter,
    );
  });

  describe('on successful adapter result', () => {
    it('stores status sent, durationMs, responseStatus, and responseBody', async () => {
      const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });

      (mocks.slackAdapter.send as any).mockReturnValue(
        Promise.resolve({
          success: true,
          responseStatus: 200,
          responseBody: 'ok',
        }),
      );

      await dispatcher.dispatchToChannel(channel, failedRunEvent, 'run.failed');

      expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(1);
      const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
      const updateValues = updateCall[1];

      expect(updateValues.status).toBe('sent');
      expect(updateValues.responseStatus).toBe(200);
      expect(updateValues.responseBody).toBe('ok');
      expect(typeof updateValues.durationMs).toBe('number');
      expect(updateValues.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('on failed adapter result (success: false)', () => {
    it('stores status failed, durationMs, responseStatus, responseBody, and errorMessage', async () => {
      const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });

      (mocks.slackAdapter.send as any).mockReturnValue(
        Promise.resolve({
          success: false,
          error: 'Slack responded with HTTP 500: Internal server error',
          responseStatus: 500,
          responseBody: 'Internal server error',
        }),
      );

      await dispatcher.dispatchToChannel(channel, failedRunEvent, 'run.failed');

      expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(1);
      const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
      const updateValues = updateCall[1];

      expect(updateValues.status).toBe('failed');
      expect(updateValues.errorMessage).toContain('HTTP 500');
      expect(updateValues.responseStatus).toBe(500);
      expect(updateValues.responseBody).toBe('Internal server error');
      expect(typeof updateValues.durationMs).toBe('number');
      expect(updateValues.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('on adapter exception (throw)', () => {
    it('stores status failed, durationMs, but responseStatus and responseBody are undefined', async () => {
      const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });

      (mocks.slackAdapter.send as any).mockReturnValue(
        Promise.reject(new Error('Network timeout')),
      );

      await dispatcher.dispatchToChannel(channel, failedRunEvent, 'run.failed');

      expect(mocks.deliveryRepo.update).toHaveBeenCalledTimes(1);
      const updateCall = (mocks.deliveryRepo.update as any).mock.calls[0];
      const updateValues = updateCall[1];

      expect(updateValues.status).toBe('failed');
      expect(updateValues.errorMessage).toBe('Network timeout');
      expect(typeof updateValues.durationMs).toBe('number');
      expect(updateValues.durationMs).toBeGreaterThanOrEqual(0);
      // On exception path, responseStatus and responseBody are not set
      expect(updateValues.responseStatus).toBeUndefined();
      expect(updateValues.responseBody).toBeUndefined();
    });
  });

  describe('durationMs', () => {
    it('is a non-negative integer on success path', async () => {
      const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
      (mocks.slackAdapter.send as any).mockReturnValue(
        Promise.resolve({ success: true, responseStatus: 200, responseBody: 'ok' }),
      );

      await dispatcher.dispatchToChannel(channel, failedRunEvent, 'run.failed');

      const updateValues = (mocks.deliveryRepo.update as any).mock.calls[0][1];
      expect(updateValues.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(updateValues.durationMs)).toBe(true);
    });

    it('is a non-negative integer on failure path', async () => {
      const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
      (mocks.slackAdapter.send as any).mockReturnValue(
        Promise.resolve({ success: false, error: 'fail' }),
      );

      await dispatcher.dispatchToChannel(channel, failedRunEvent, 'run.failed');

      const updateValues = (mocks.deliveryRepo.update as any).mock.calls[0][1];
      expect(updateValues.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(updateValues.durationMs)).toBe(true);
    });

    it('is a non-negative integer on exception path', async () => {
      const channel = makeChannelRecord({ id: 'ch-10', type: 'slack' });
      (mocks.slackAdapter.send as any).mockReturnValue(Promise.reject(new Error('boom')));

      await dispatcher.dispatchToChannel(channel, failedRunEvent, 'run.failed');

      const updateValues = (mocks.deliveryRepo.update as any).mock.calls[0][1];
      expect(updateValues.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(updateValues.durationMs)).toBe(true);
    });
  });
});
