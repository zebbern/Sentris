import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type {
  NotificationChannelRecord,
  NotificationDeliveryRecord,
  OutboxEventRecord,
} from '../../database/schema';
import type { OutboxRepository } from '../../outbox/outbox.repository';
import type { NotificationChannelRepository } from '../repository/notification-channel.repository';
import type { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import type { SlackNotificationAdapter } from '../adapters/slack.adapter';
import type { DiscordNotificationAdapter } from '../adapters/discord.adapter';
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
    outboxEventId: overrides.outboxEventId ?? null,
    createdAt: overrides.createdAt ?? now,
    sendingStartedAt: overrides.sendingStartedAt ?? null,
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
    reserveManualResend: ReturnType<typeof mock>;
    completeManualResend: ReturnType<typeof mock>;
    finalizeManualResend: ReturnType<typeof mock>;
    markStaleSendingUnknown: ReturnType<typeof mock>;
  };
  let dispatcherService: { dispatchPendingDelivery: ReturnType<typeof mock> };
  let outboxRepo: {
    requeueDeadLetter: ReturnType<typeof mock>;
  };
  let auditRecordCalls: unknown[][];
  let durableAuditError: Error | undefined;
  let reservationExecutor: { insert: ReturnType<typeof mock> };
  let recoveryExecutor: {
    insert: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
  let finalizationExecutor: {
    insert: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
  let outboxStatus: OutboxEventRecord['status'];
  let deliveryRecords: Map<string, NotificationDeliveryRecord>;
  let manualChildId: string | undefined;

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
  const outboxEvent: OutboxEventRecord = {
    id: '5b5879f4-6798-4027-92e6-56a863460098',
    eventType: 'run.status.terminal',
    organizationId: 'org-1',
    aggregateType: 'workflow_run',
    aggregateId: 'run-1',
    dedupeKey: 'run.status.terminal:run-1',
    payload: {
      runId: 'run-1',
      workflowId: 'wf-1',
      organizationId: 'org-1',
      status: 'FAILED',
    },
    status: 'dead',
    attempts: 8,
    maxAttempts: 8,
    availableAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: 'Slack responded with HTTP 500',
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    auditRecordCalls = [];
    durableAuditError = undefined;
    reservationExecutor = { insert: mock(() => undefined) };
    recoveryExecutor = {
      insert: mock(() => undefined),
      update: mock(() => undefined),
    };
    finalizationExecutor = {
      insert: mock(() => undefined),
      update: mock(() => undefined),
    };
    outboxStatus = 'dead';
    manualChildId = undefined;
    deliveryRecords = new Map([[failedDelivery.id, { ...failedDelivery }]]);

    channelRepo = {
      findById: mock((_id: string, _opts?: { organizationId?: string }) =>
        Promise.resolve(channel),
      ),
    };

    deliveryRepo = {
      findById: mock((id: string) => Promise.resolve(deliveryRecords.get(id))),
      create: mock(() => Promise.resolve(newDelivery)),
      update: mock(() => Promise.resolve(newDelivery)),
      listByChannelId: mock(() => Promise.resolve([])),
      reserveManualResend: mock(
        async (
          _id: string,
          _channelId: string,
          _expectedStatus: string,
          reservation: string,
          child: NotificationDeliveryRecord,
          onReserved: (executor: unknown, record: NotificationDeliveryRecord) => Promise<void>,
        ) => {
          const parent = deliveryRecords.get(_id);
          if (!parent || parent.status !== _expectedStatus || parent.channelId !== _channelId) {
            return false;
          }
          const reservedParent = {
            ...parent,
            status: 'sending',
            errorMessage: reservation,
          } as NotificationDeliveryRecord;
          manualChildId = child.id;
          deliveryRecords.set(parent.id, reservedParent);
          deliveryRecords.set(child.id, makeDeliveryRecord({ ...child, sentAt: null }));
          try {
            await onReserved(reservationExecutor, reservedParent);
          } catch (error) {
            deliveryRecords.set(parent.id, parent);
            deliveryRecords.delete(child.id);
            throw error;
          }
          return true;
        },
      ),
      completeManualResend: mock(
        async (
          id: string,
          channelId: string,
          reservation: string,
          completion: Partial<NotificationDeliveryRecord>,
        ) => {
          const parent = deliveryRecords.get(id);
          if (
            !parent ||
            parent.channelId !== channelId ||
            parent.status !== 'sending' ||
            parent.errorMessage !== reservation
          ) {
            return false;
          }
          deliveryRecords.set(id, { ...parent, ...completion });
          return true;
        },
      ),
      finalizeManualResend: mock(
        async (
          id: string,
          channelId: string,
          reservation: string,
          completion: Partial<NotificationDeliveryRecord>,
          onFinalized: (executor: unknown, record: NotificationDeliveryRecord) => Promise<void>,
        ) => {
          const parent = deliveryRecords.get(id);
          if (
            !parent ||
            parent.channelId !== channelId ||
            parent.status !== 'sending' ||
            parent.errorMessage !== reservation
          ) {
            return false;
          }
          const completed = { ...parent, ...completion };
          await onFinalized(finalizationExecutor, completed);
          deliveryRecords.set(id, completed);
          return true;
        },
      ),
      markStaleSendingUnknown: mock(
        async (id: string, channelId: string, startedBefore: Date, errorMessage: string) => {
          const record = deliveryRecords.get(id);
          if (!record || record.channelId !== channelId || record.status !== 'sending') {
            return undefined;
          }
          const startedAt = record.sendingStartedAt ?? record.createdAt;
          if (startedAt > startedBefore) {
            return undefined;
          }
          const unknown = { ...record, status: 'unknown' as const, errorMessage };
          deliveryRecords.set(id, unknown);
          return unknown;
        },
      ),
    };

    dispatcherService = {
      dispatchPendingDelivery: mock(
        async (
          _channel: NotificationChannelRecord,
          deliveryId: string,
          payload: Record<string, unknown>,
        ) => {
          const pending = deliveryRecords.get(deliveryId);
          if (!pending) throw new Error('missing manual delivery');
          deliveryRecords.set(deliveryId, {
            ...pending,
            payload,
            status: 'sent',
            sentAt: new Date(),
            durationMs: 150,
            responseStatus: 200,
            responseBody: 'ok',
          });
          return deliveryId;
        },
      ),
    };
    outboxRepo = {
      requeueDeadLetter: mock(
        async (
          _eventId: string,
          _organizationId: string,
          onRequeued?: (executor: unknown, event: OutboxEventRecord) => Promise<void>,
        ) => {
          outboxStatus = 'pending';
          const requeued = {
            ...outboxEvent,
            status: 'pending' as const,
            attempts: 0,
            lastError: null,
          };
          await onRequeued?.(recoveryExecutor, requeued);
          return requeued;
        },
      ),
    };

    const auditLogService = {
      record: (...args: unknown[]) => {
        auditRecordCalls.push(args);
      },
      recordDurable: async (...args: unknown[]) => {
        auditRecordCalls.push(args);
        if (durableAuditError) throw durableAuditError;
      },
      recordDurableWithExecutor: async (...args: unknown[]) => {
        auditRecordCalls.push(args);
        if (durableAuditError) throw durableAuditError;
      },
    };

    const slackAdapter = { send: mock() } as unknown as SlackNotificationAdapter;
    const discordAdapter = { send: mock() } as unknown as DiscordNotificationAdapter;

    service = new NotificationsService(
      channelRepo as unknown as NotificationChannelRepository,
      deliveryRepo as unknown as NotificationDeliveryRepository,
      slackAdapter,
      discordAdapter,
      auditLogService as any,
      dispatcherService as unknown as NotificationDispatcherService,
      outboxRepo as unknown as OutboxRepository,
    );
  });

  it('dispatches original payload and returns new delivery record', async () => {
    const result = await service.resendDelivery(authContext, 'ch-1', 'del-100');

    expect(dispatcherService.dispatchPendingDelivery).toHaveBeenCalledTimes(1);
    const [calledChannel, calledDeliveryId, calledPayload] = (
      dispatcherService.dispatchPendingDelivery as any
    ).mock.calls[0] as [any, string, any];
    expect(calledChannel.id).toBe('ch-1');
    expect(manualChildId).toBeDefined();
    expect(calledDeliveryId).toBe(manualChildId!);
    expect(calledPayload).toEqual(failedDelivery.payload);

    expect(result.id).toBe(manualChildId!);
    expect(result.status).toBe('sent');
    expect(deliveryRepo.reserveManualResend).toHaveBeenCalledTimes(1);
    expect(deliveryRepo.finalizeManualResend).toHaveBeenCalledWith(
      failedDelivery.id,
      failedDelivery.channelId,
      expect.stringContaining('sentris-manual-resend|'),
      expect.objectContaining({
        status: 'sent',
        errorMessage: expect.stringContaining(manualChildId!),
      }),
      expect.any(Function),
    );
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

  it('allows an explicit resend for an unknown outcome and resolves its outbox anchor', async () => {
    const unknownDelivery = makeDeliveryRecord({
      id: 'del-unknown',
      channelId: 'ch-1',
      status: 'unknown',
      payload: {
        runId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        status: 'FAILED',
        outbox: { eventId: 'outbox-1' },
      },
    });
    (deliveryRepo.findById as any).mockImplementation((id: string) => {
      if (id === 'del-unknown') return Promise.resolve(unknownDelivery);
      return Promise.resolve(deliveryRecords.get(id));
    });
    deliveryRecords.set(unknownDelivery.id, unknownDelivery);

    const result = await service.resendDelivery(authContext, 'ch-1', 'del-unknown');

    expect(manualChildId).toBeDefined();
    expect(result.id).toBe(manualChildId!);
    const [, , resentPayload] = (dispatcherService.dispatchPendingDelivery as any).mock.calls[0];
    expect(resentPayload.outbox).toBeUndefined();
    expect(deliveryRepo.finalizeManualResend).toHaveBeenCalledWith(
      'del-unknown',
      'ch-1',
      expect.stringContaining('sentris-manual-resend|'),
      expect.objectContaining({
        status: 'sent',
        errorMessage: expect.stringContaining(manualChildId!),
      }),
      expect.any(Function),
    );
  });

  it('removes the durable outbox identity from an explicit resend of a failed delivery', async () => {
    const durableFailedDelivery = makeDeliveryRecord({
      id: 'del-durable-failed',
      channelId: 'ch-1',
      status: 'failed',
      payload: {
        runId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        status: 'FAILED',
        outbox: {
          eventId: '5b5879f4-6798-4027-92e6-56a863460098',
          dedupeKey: 'run.status.terminal:run-1',
          attempt: 8,
        },
      },
    });
    (deliveryRepo.findById as any).mockImplementation((id: string) => {
      if (id === durableFailedDelivery.id) return Promise.resolve(durableFailedDelivery);
      return Promise.resolve(deliveryRecords.get(id));
    });
    deliveryRecords.set(durableFailedDelivery.id, durableFailedDelivery);

    await service.resendDelivery(authContext, 'ch-1', durableFailedDelivery.id);

    const [, , resentPayload] = (dispatcherService.dispatchPendingDelivery as any).mock.calls[0];
    expect(resentPayload.outbox).toBeUndefined();
  });

  it('atomically requeues a tenant-owned dead outbox anchor after a successful explicit resend', async () => {
    const durableFailedDelivery = makeDeliveryRecord({
      id: 'del-durable-failed',
      channelId: 'ch-1',
      status: 'failed',
      outboxEventId: outboxEvent.id,
      payload: {
        runId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        status: 'FAILED',
        outbox: {
          eventId: outboxEvent.id,
          dedupeKey: outboxEvent.dedupeKey,
          attempt: 8,
        },
      },
    });
    (deliveryRepo.findById as any).mockImplementation((id: string) => {
      if (id === durableFailedDelivery.id) return Promise.resolve(durableFailedDelivery);
      return Promise.resolve(deliveryRecords.get(id));
    });
    deliveryRecords.set(durableFailedDelivery.id, durableFailedDelivery);

    const result = await service.resendDelivery(
      authContext,
      durableFailedDelivery.channelId,
      durableFailedDelivery.id,
    );

    expect(manualChildId).toBeDefined();
    expect(result.id).toBe(manualChildId!);
    expect(outboxStatus).toBe('pending');
    expect(outboxRepo.requeueDeadLetter).toHaveBeenCalledWith(
      outboxEvent.id,
      authContext.organizationId,
      expect.any(Function),
    );
    expect(deliveryRepo.completeManualResend).toHaveBeenCalledWith(
      durableFailedDelivery.id,
      durableFailedDelivery.channelId,
      expect.stringContaining('sentris-manual-resend|'),
      expect.objectContaining({
        status: 'sent',
        errorMessage: expect.stringContaining(manualChildId!),
      }),
      recoveryExecutor,
    );
    expect(
      auditRecordCalls.some(
        ([executor, , event]) =>
          executor === recoveryExecutor &&
          (event as { metadata?: { phase?: string } }).metadata?.phase === 'reconciled',
      ),
    ).toBe(true);
    expect(dispatcherService.dispatchPendingDelivery).toHaveBeenCalledTimes(1);
  });

  it('does not allow manually resending an in-flight delivery', async () => {
    const inFlight = makeDeliveryRecord({
      id: 'del-sending',
      channelId: 'ch-1',
      status: 'sending',
      sendingStartedAt: new Date(),
    });
    deliveryRecords.set(inFlight.id, inFlight);

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-sending')).rejects.toThrow(
      ConflictException,
    );
    expect(dispatcherService.dispatchPendingDelivery).not.toHaveBeenCalled();
  });

  it('allows an explicit operator resend after a non-outbox test delivery is stale', async () => {
    const staleTestDelivery = makeDeliveryRecord({
      id: 'del-stale-test',
      channelId: 'ch-1',
      eventType: 'notification.test',
      status: 'sending',
      sendingStartedAt: new Date(Date.now() - 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      sentAt: null,
      outboxEventId: null,
    });
    deliveryRecords.set(staleTestDelivery.id, staleTestDelivery);

    const result = await service.resendDelivery(
      authContext,
      staleTestDelivery.channelId,
      staleTestDelivery.id,
    );

    expect(deliveryRepo.markStaleSendingUnknown).toHaveBeenCalledWith(
      staleTestDelivery.id,
      staleTestDelivery.channelId,
      expect.any(Date),
      expect.stringContaining('did not record a definitive outcome'),
    );
    expect(result.status).toBe('sent');
    expect(dispatcherService.dispatchPendingDelivery).toHaveBeenCalledTimes(1);
  });

  it('records audit log with action notification_delivery.resend', async () => {
    await service.resendDelivery(authContext, 'ch-1', 'del-100');

    expect(auditRecordCalls.length).toBe(2);
    const requestedCall = auditRecordCalls.find(
      ([, , event]) => (event as { metadata?: { phase?: string } }).metadata?.phase === 'requested',
    );
    expect(requestedCall).toBeDefined();
    const [, , auditData] = requestedCall!;
    expect((auditData as any).action).toBe('notification_delivery.resend');
    expect((auditData as any).resourceId).toBe('del-100');
    expect((auditData as any).metadata.channelId).toBe('ch-1');
    expect((auditData as any).metadata.phase).toBe('requested');
    expect((auditData as any).metadata.originalStatus).toBe('failed');
    expect(requestedCall?.[0]).toBe(reservationExecutor);
    expect(requestedCall?.[1]).toBe(authContext);
  });

  it('does not dispatch when the durable resend-request audit cannot be accepted', async () => {
    durableAuditError = new Error('audit outbox unavailable');

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-100')).rejects.toThrow(
      'audit outbox unavailable',
    );

    expect(dispatcherService.dispatchPendingDelivery).not.toHaveBeenCalled();
  });

  it('passes auth context to audit log', async () => {
    await service.resendDelivery(authContext, 'ch-1', 'del-100');

    const requestedCall = auditRecordCalls.find(
      ([, , event]) => (event as { metadata?: { phase?: string } }).metadata?.phase === 'requested',
    );
    const [, authArg] = requestedCall!;
    expect(authArg).toBe(authContext);
  });

  it('allows only one concurrent caller to reserve and dispatch the manual resend', async () => {
    (deliveryRepo.reserveManualResend as any).mockReturnValue(Promise.resolve(false));

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-100')).rejects.toThrow(
      ConflictException,
    );

    expect(dispatcherService.dispatchPendingDelivery).not.toHaveBeenCalled();
    expect(auditRecordCalls).toHaveLength(0);
  });

  it('keeps a post-side-effect failure reserved so an immediate retry cannot duplicate the send', async () => {
    (dispatcherService.dispatchPendingDelivery as any).mockImplementationOnce(
      async (_channel: NotificationChannelRecord, deliveryId: string) => {
        const child = deliveryRecords.get(deliveryId)!;
        deliveryRecords.set(deliveryId, { ...child, status: 'sending' });
        throw new Error('database failed after webhook response');
      },
    );

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-100')).rejects.toThrow(
      'database failed after webhook response',
    );

    await expect(service.resendDelivery(authContext, 'ch-1', 'del-100')).rejects.toThrow(
      ConflictException,
    );
    expect(dispatcherService.dispatchPendingDelivery).toHaveBeenCalledTimes(1);
  });

  it('resumes a reserved pending child without creating another manual attempt', async () => {
    const reservation = `sentris-manual-resend|child-pending|${Date.now()}|failed`;
    deliveryRecords.set(
      failedDelivery.id,
      makeDeliveryRecord({
        ...failedDelivery,
        status: 'sending',
        errorMessage: reservation,
      }),
    );
    deliveryRecords.set(
      'child-pending',
      makeDeliveryRecord({
        id: 'child-pending',
        channelId: failedDelivery.channelId,
        status: 'pending',
        sentAt: null,
      }),
    );

    const result = await service.resendDelivery(authContext, 'ch-1', failedDelivery.id);

    expect(result.id).toBe('child-pending');
    expect(result.status).toBe('sent');
    expect(deliveryRepo.reserveManualResend).not.toHaveBeenCalled();
    expect(dispatcherService.dispatchPendingDelivery).toHaveBeenCalledTimes(1);
  });

  it('does not mark a newly claimed delayed child stale when a second caller arrives', async () => {
    const reservation = `sentris-manual-resend|child-delayed|${Date.now() - 60 * 60 * 1000}|failed`;
    deliveryRecords.set(
      failedDelivery.id,
      makeDeliveryRecord({
        ...failedDelivery,
        status: 'sending',
        errorMessage: reservation,
      }),
    );
    deliveryRecords.set(
      'child-delayed',
      makeDeliveryRecord({
        id: 'child-delayed',
        channelId: failedDelivery.channelId,
        status: 'pending',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        sentAt: null,
      }),
    );
    let releaseSend!: () => void;
    const sendCanFinish = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let claimed!: () => void;
    const childClaimed = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    (dispatcherService.dispatchPendingDelivery as any).mockImplementationOnce(
      async (_channel: NotificationChannelRecord, deliveryId: string) => {
        const child = deliveryRecords.get(deliveryId)!;
        deliveryRecords.set(deliveryId, {
          ...child,
          status: 'sending',
          sendingStartedAt: new Date(),
        });
        claimed();
        await sendCanFinish;
        deliveryRecords.set(deliveryId, {
          ...deliveryRecords.get(deliveryId)!,
          status: 'sent',
          sendingStartedAt: null,
          sentAt: new Date(),
        });
        return deliveryId;
      },
    );

    const firstCaller = service.resendDelivery(authContext, 'ch-1', failedDelivery.id);
    await childClaimed;
    await expect(service.resendDelivery(authContext, 'ch-1', failedDelivery.id)).rejects.toThrow(
      ConflictException,
    );
    expect(dispatcherService.dispatchPendingDelivery).toHaveBeenCalledTimes(1);

    releaseSend();
    await expect(firstCaller).resolves.toEqual(
      expect.objectContaining({ id: 'child-delayed', status: 'sent' }),
    );
  });

  it('reconciles a reserved child already marked sent without duplicating the webhook', async () => {
    const reservation = `sentris-manual-resend|child-sent|${Date.now()}|failed`;
    deliveryRecords.set(
      failedDelivery.id,
      makeDeliveryRecord({
        ...failedDelivery,
        status: 'sending',
        errorMessage: reservation,
      }),
    );
    deliveryRecords.set(
      'child-sent',
      makeDeliveryRecord({
        id: 'child-sent',
        channelId: failedDelivery.channelId,
        status: 'sent',
      }),
    );

    const result = await service.resendDelivery(authContext, 'ch-1', failedDelivery.id);

    expect(result.id).toBe('child-sent');
    expect(dispatcherService.dispatchPendingDelivery).not.toHaveBeenCalled();
    expect(deliveryRepo.finalizeManualResend).toHaveBeenCalledWith(
      failedDelivery.id,
      failedDelivery.channelId,
      reservation,
      expect.objectContaining({ status: 'sent' }),
      expect.any(Function),
    );
  });

  it('marks the parent unknown when its reserved child history is missing', async () => {
    const reservation = `sentris-manual-resend|child-missing|${Date.now()}|failed`;
    deliveryRecords.set(
      failedDelivery.id,
      makeDeliveryRecord({
        ...failedDelivery,
        status: 'sending',
        errorMessage: reservation,
      }),
    );

    await expect(service.resendDelivery(authContext, 'ch-1', failedDelivery.id)).rejects.toThrow(
      ConflictException,
    );

    expect(dispatcherService.dispatchPendingDelivery).not.toHaveBeenCalled();
    expect(deliveryRepo.finalizeManualResend).toHaveBeenCalledWith(
      failedDelivery.id,
      failedDelivery.channelId,
      reservation,
      expect.objectContaining({
        status: 'unknown',
        errorMessage: expect.stringContaining('child-missing'),
      }),
      expect.any(Function),
    );
  });

  it('converts a stale reservation to unknown and requires a separate explicit retry', async () => {
    const staleReservation = `sentris-manual-resend|reservation-1|${Date.now() - 60 * 60 * 1000}|failed`;
    const staleDelivery = makeDeliveryRecord({
      ...failedDelivery,
      status: 'sending',
      errorMessage: staleReservation,
    });
    const staleChild = makeDeliveryRecord({
      id: 'reservation-1',
      channelId: 'ch-1',
      status: 'sending',
      sendingStartedAt: new Date(Date.now() - 60 * 60 * 1000),
      sentAt: null,
    });
    deliveryRecords.set(staleDelivery.id, staleDelivery);
    deliveryRecords.set(staleChild.id, staleChild);

    const result = await service.resendDelivery(authContext, 'ch-1', 'del-100');
    expect(result.status).toBe('unknown');

    expect(deliveryRepo.markStaleSendingUnknown).toHaveBeenCalledWith(
      staleChild.id,
      staleChild.channelId,
      expect.any(Date),
      expect.stringContaining('did not record a definitive outcome'),
    );
    expect(deliveryRepo.finalizeManualResend).toHaveBeenCalledWith(
      staleDelivery.id,
      staleDelivery.channelId,
      staleReservation,
      expect.objectContaining({
        status: 'unknown',
        errorMessage: expect.stringContaining(staleChild.id),
      }),
      expect.any(Function),
    );
    expect(dispatcherService.dispatchPendingDelivery).not.toHaveBeenCalled();
  });
});
