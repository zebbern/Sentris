import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../../database/schema';
import type { NotificationChannelRepository } from '../repository/notification-channel.repository';
import type { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import type { SlackNotificationAdapter } from '../adapters/slack.adapter';
import type { NotificationDispatcherService } from '../notification-dispatcher.service';
import { NotificationsService } from '../notifications.service';

// ---------------------------------------------------------------------------
// Auth fixtures
// ---------------------------------------------------------------------------

const authContext: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'local',
  isAuthenticated: true,
};

// ---------------------------------------------------------------------------
// Record factories
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
    config: overrides.config ?? { webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxxx1234' },
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
    status: overrides.status ?? 'sent',
    payload: overrides.payload ?? { runId: 'run-1', status: 'FAILED' },
    errorMessage: overrides.errorMessage ?? null,
    durationMs: overrides.durationMs ?? null,
    responseStatus: overrides.responseStatus ?? null,
    responseBody: overrides.responseBody ?? null,
    createdAt: overrides.createdAt ?? now,
    sentAt: overrides.sentAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsService — resendDelivery', () => {
  let service: NotificationsService;
  let channelRepo: { findById: ReturnType<typeof mock> };
  let deliveryRepo: {
    findById: ReturnType<typeof mock>;
    create: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
    listByChannelId: ReturnType<typeof mock>;
  };
  let dispatcherService: { dispatchToChannel: ReturnType<typeof mock> };
  let auditRecordCalls: unknown[][];

  const failedDelivery = makeDeliveryRecord({
    id: 'del-100',
    channelId: 'ch-1',
    status: 'failed',
    eventType: 'run.failed',
    payload: {
      runId: 'run-1',
      workflowId: 'wf-1',
      organizationId: 'org-1',
      status: 'FAILED',
    },
    errorMessage: 'Slack responded with HTTP 500',
  });

  const newDelivery = makeDeliveryRecord({
    id: 'del-200',
    channelId: 'ch-1',
    status: 'sent',
    durationMs: 150,
    responseStatus: 200,
    responseBody: 'ok',
  });

  const channel = makeChannelRecord({ id: 'ch-1', organizationId: 'org-1' });

  beforeEach(() => {
    auditRecordCalls = [];

    channelRepo = {
      findById: mock((_id: string, _opts?: { organizationId?: string }) =>
        Promise.resolve(channel),
      ),
    };

    deliveryRepo = {
      findById: mock((id: string) => {
        if (id === 'del-100') return Promise.resolve(failedDelivery);
        if (id === 'del-200') return Promise.resolve(newDelivery);
        return Promise.resolve(undefined);
      }),
      create: mock(() => Promise.resolve(newDelivery)),
      update: mock(() => Promise.resolve(newDelivery)),
      listByChannelId: mock(() => Promise.resolve([])),
    };

    dispatcherService = {
      dispatchToChannel: mock(() => Promise.resolve('del-200')),
    };

    const auditLogService = {
      record: (...args: unknown[]) => {
        auditRecordCalls.push(args);
      },
    };

    const slackAdapter = { send: mock() } as unknown as SlackNotificationAdapter;

    service = new NotificationsService(
      channelRepo as unknown as NotificationChannelRepository,
      deliveryRepo as unknown as NotificationDeliveryRepository,
      slackAdapter,
      auditLogService as any,
      dispatcherService as unknown as NotificationDispatcherService,
    );
  });

  it('dispatches original payload and returns new delivery record', async () => {
    const result = await service.resendDelivery(authContext, 'ch-1', 'del-100');

    expect(dispatcherService.dispatchToChannel).toHaveBeenCalledTimes(1);
    const [calledChannel, calledPayload, calledEventType] = (
      dispatcherService.dispatchToChannel as any
    ).mock.calls[0] as [any, any, string];
    expect(calledChannel.id).toBe('ch-1');
    expect(calledPayload).toEqual(failedDelivery.payload);
    expect(calledEventType).toBe('run.failed');

    expect(result.id).toBe('del-200');
    expect(result.status).toBe('sent');
  });

  it('throws NotFoundException when channel does not exist', async () => {
    (channelRepo.findById as any).mockReturnValue(Promise.resolve(undefined));

    await expect(service.resendDelivery(authContext, 'ch-missing', 'del-100')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when channel belongs to different org', async () => {
    const _otherOrgChannel = makeChannelRecord({
      id: 'ch-other',
      organizationId: 'org-other',
    });
    // findById with org filter returns undefined for wrong org
    (channelRepo.findById as any).mockReturnValue(Promise.resolve(undefined));

    await expect(service.resendDelivery(authContext, 'ch-other', 'del-100')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when delivery does not exist', async () => {
    (deliveryRepo.findById as any).mockReturnValue(Promise.resolve(undefined));

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when delivery channelId does not match provided channelId', async () => {
    const wrongChannelDelivery = makeDeliveryRecord({
      id: 'del-wrong',
      channelId: 'ch-different',
      status: 'failed',
    });
    (deliveryRepo.findById as any).mockReturnValue(Promise.resolve(wrongChannelDelivery));

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-wrong')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when delivery status is sent', async () => {
    const sentDelivery = makeDeliveryRecord({
      id: 'del-sent',
      channelId: 'ch-1',
      status: 'sent',
    });
    (deliveryRepo.findById as any).mockReturnValue(Promise.resolve(sentDelivery));

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-sent')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when delivery status is pending', async () => {
    const pendingDelivery = makeDeliveryRecord({
      id: 'del-pending',
      channelId: 'ch-1',
      status: 'pending',
    });
    (deliveryRepo.findById as any).mockReturnValue(Promise.resolve(pendingDelivery));

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-pending')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('records audit log with action notification_delivery.resend', async () => {
    await service.resendDelivery(authContext, 'ch-1', 'del-100');

    expect(auditRecordCalls.length).toBe(1);
    const [, auditData] = auditRecordCalls[0]!;
    expect((auditData as any).action).toBe('notification_delivery.resend');
    expect((auditData as any).resourceId).toBe('del-100');
    expect((auditData as any).metadata.newDeliveryId).toBe('del-200');
    expect((auditData as any).metadata.channelId).toBe('ch-1');
  });

  it('passes auth context to audit log', async () => {
    await service.resendDelivery(authContext, 'ch-1', 'del-100');

    const [authArg] = auditRecordCalls[0]!;
    expect(authArg).toBe(authContext);
  });
});
