import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type NotificationChannel,
  type NotificationDelivery,
  type RunLifecycleEvent,
  SlackChannelConfigSchema,
  DiscordChannelConfigSchema,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { NotificationChannelRepository } from './repository/notification-channel.repository';
import { NotificationDeliveryRepository } from './repository/notification-delivery.repository';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { SlackNotificationAdapter } from './adapters/slack.adapter';
import { DiscordNotificationAdapter } from './adapters/discord.adapter';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../database/schema';
import {
  MANUAL_RESEND_RESERVATION_PREFIX,
  type ManualResendReservation,
  parseManualResendReservation,
} from './manual-resend-reservation';

const AMBIGUOUS_DELIVERY_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly channelRepository: NotificationChannelRepository,
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly _slackAdapter: SlackNotificationAdapter,
    private readonly _discordAdapter: DiscordNotificationAdapter,
    private readonly auditLogService: AuditLogService,
    private readonly dispatcherService: NotificationDispatcherService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async list(auth: AuthContext | null): Promise<NotificationChannel[]> {
    const organizationId = requireOrganizationId(auth);
    const records = await this.channelRepository.list({ organizationId });
    return records.map((r) => this.toChannelResponse(r, true));
  }

  async get(auth: AuthContext | null, id: string): Promise<NotificationChannel> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.channelRepository.findById(id, { organizationId });
    if (!record) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }
    return this.toChannelResponse(record, true);
  }

  async create(
    auth: AuthContext | null,
    dto: {
      name: string;
      type: 'slack' | 'discord' | 'email' | 'pagerduty';
      config: Record<string, unknown>;
      events: string[];
    },
  ): Promise<NotificationChannel> {
    const organizationId = requireOrganizationId(auth);

    // Validate config shape for the given type
    this.validateConfig(dto.type, dto.config);

    const record = await this.channelRepository.create(
      {
        organizationId,
        name: dto.name,
        type: dto.type,
        config: dto.config,
        events: dto.events,
        status: 'active',
        createdBy: auth?.userId ?? null,
      },
      (executor, created) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'notification_channel.create',
          resourceType: 'notification_channel',
          resourceId: created.id,
          resourceName: created.name,
          metadata: { type: dto.type, events: dto.events },
        }),
    );

    this.logger.log(`Created notification channel ${record.id} (${dto.type})`);

    // Show full config only on create
    return this.toChannelResponse(record, false);
  }

  async update(
    auth: AuthContext | null,
    id: string,
    dto: {
      name?: string;
      config?: Record<string, unknown>;
      status?: 'active' | 'inactive';
      events?: string[];
    },
  ): Promise<NotificationChannel> {
    const organizationId = requireOrganizationId(auth);
    const existing = await this.channelRepository.findById(id, { organizationId });
    if (!existing) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }

    if (dto.config) {
      this.validateConfig(existing.type, dto.config);
    }

    const updated = await this.channelRepository.update(
      id,
      {
        name: dto.name,
        config: dto.config,
        status: dto.status,
        events: dto.events,
      },
      { organizationId },
      (executor, record) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'notification_channel.update',
          resourceType: 'notification_channel',
          resourceId: id,
          resourceName: record.name,
          metadata: { updatedFields: Object.keys(dto) },
        }),
    );

    if (!updated) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }

    this.logger.log(`Updated notification channel ${id}`);

    return this.toChannelResponse(updated, true);
  }

  async delete(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    const existing = await this.channelRepository.findById(id, { organizationId });
    if (!existing) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }

    const deleted = await this.channelRepository.delete(id, { organizationId }, (executor) =>
      this.auditLogService.recordDurableWithExecutor(executor, auth, {
        action: 'notification_channel.delete',
        resourceType: 'notification_channel',
        resourceId: id,
        resourceName: existing.name,
      }),
    );
    if (!deleted) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }
    this.logger.log(`Deleted notification channel ${id}`);
  }

  async testChannel(
    auth: AuthContext | null,
    id: string,
  ): Promise<{ success: boolean; error?: string }> {
    const organizationId = requireOrganizationId(auth);
    const channel = await this.channelRepository.findById(id, { organizationId });
    if (!channel) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }

    if (channel.type !== 'slack' && channel.type !== 'discord') {
      throw new NotImplementedException(
        `Testing for channel type '${channel.type}' is not implemented`,
      );
    }

    const testPayload: RunLifecycleEvent = {
      runId: 'test-run-00000000',
      workflowId: 'test-workflow-00000000',
      organizationId,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    };

    const deliveryId = randomUUID();
    await this.deliveryRepository.createWithHook(
      {
        id: deliveryId,
        channelId: channel.id,
        runId: testPayload.runId,
        eventType: 'notification.test',
        status: 'pending',
        payload: testPayload as unknown as Record<string, unknown>,
      },
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'notification_channel.test',
          resourceType: 'notification_channel',
          resourceId: channel.id,
          resourceName: channel.name,
          metadata: { deliveryId, phase: 'requested' },
        }),
    );
    await this.dispatcherService.dispatchPendingDelivery(channel, deliveryId, testPayload);
    const delivery = await this.deliveryRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundException('Test delivery history was not found after dispatch');
    }
    return delivery.status === 'sent'
      ? { success: true }
      : { success: false, error: delivery.errorMessage ?? 'Notification test failed' };
  }

  async listDeliveries(
    auth: AuthContext | null,
    channelId: string,
    limit = 20,
    offset = 0,
  ): Promise<NotificationDelivery[]> {
    const organizationId = requireOrganizationId(auth);

    // Verify channel exists and belongs to the organization
    const channel = await this.channelRepository.findById(channelId, { organizationId });
    if (!channel) {
      throw new NotFoundException(`Notification channel ${channelId} not found`);
    }

    const clampedLimit = Math.max(1, Math.min(limit, 100));
    const clampedOffset = Math.max(0, offset);

    const records = await this.deliveryRepository.listByChannelId(
      channelId,
      clampedLimit,
      clampedOffset,
    );
    return records.map((r) => this.toDeliveryResponse(r));
  }

  async resendDelivery(
    auth: AuthContext | null,
    channelId: string,
    deliveryId: string,
  ): Promise<NotificationDelivery> {
    const organizationId = requireOrganizationId(auth);

    // Verify channel exists and belongs to the organization
    const channel = await this.channelRepository.findById(channelId, { organizationId });
    if (!channel) {
      throw new NotFoundException(`Notification channel ${channelId} not found`);
    }

    // Load original delivery and verify it belongs to the channel
    let delivery = await this.deliveryRepository.findById(deliveryId);
    if (!delivery || delivery.channelId !== channelId) {
      throw new NotFoundException(`Delivery ${deliveryId} not found`);
    }

    if (delivery.status === 'sending') {
      const activeReservation = parseManualResendReservation(delivery.errorMessage);
      if (!activeReservation || !delivery.errorMessage) {
        const transitioned = await this.deliveryRepository.markStaleSendingUnknown(
          delivery.id,
          channelId,
          new Date(Date.now() - AMBIGUOUS_DELIVERY_TTL_MS),
          'A previous delivery attempt did not record a definitive outcome',
        );
        if (!transitioned) {
          throw new ConflictException('A resend for this delivery is already in progress');
        }
        delivery = transitioned;
      } else {
        return this.reconcileManualResend(
          auth,
          organizationId,
          channel,
          delivery,
          delivery.errorMessage,
          activeReservation,
        );
      }
    }

    // Ambiguous outcomes require an explicit operator action. A fresh delivery
    // is used so the original row can act as the concurrency reservation.
    if (delivery.status !== 'failed' && delivery.status !== 'unknown') {
      throw new BadRequestException('Only failed or unknown deliveries can be re-sent');
    }

    const originalStatus = delivery.status;
    const childDeliveryId = randomUUID();
    const reservation = this.createManualResendReservation(childDeliveryId, originalStatus);
    const storedPayload = delivery.payload as unknown as RunLifecycleEvent & {
      outbox?: unknown;
    };
    const payload = (({ outbox: _outbox, ...manualPayload }) => manualPayload)(storedPayload);
    const reserved = await this.deliveryRepository.reserveManualResend(
      delivery.id,
      channelId,
      originalStatus,
      reservation,
      {
        id: childDeliveryId,
        channelId,
        runId: delivery.runId,
        eventType: delivery.eventType,
        status: 'pending',
        payload: payload as unknown as Record<string, unknown>,
      },
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'notification_delivery.resend',
          resourceType: 'notification_delivery',
          resourceId: deliveryId,
          metadata: {
            channelId,
            originalStatus,
            childDeliveryId,
            phase: 'requested',
          },
        }),
    );
    if (!reserved) {
      throw new ConflictException('A resend for this delivery is already in progress');
    }

    const activeReservation = parseManualResendReservation(reservation);
    if (!activeReservation) {
      throw new Error('Generated manual resend reservation is invalid');
    }
    return this.reconcileManualResend(
      auth,
      organizationId,
      channel,
      {
        ...delivery,
        status: 'sending',
        errorMessage: reservation,
      },
      reservation,
      activeReservation,
    );
  }

  private async reconcileManualResend(
    auth: AuthContext | null,
    organizationId: string,
    channel: NotificationChannelRecord,
    parent: NotificationDeliveryRecord,
    reservation: string,
    activeReservation: ManualResendReservation,
  ): Promise<NotificationDelivery> {
    let child = await this.deliveryRepository.findById(activeReservation.childDeliveryId);
    if (!child || child.channelId !== channel.id) {
      await this.finalizeManualResend(auth, parent, reservation, activeReservation, {
        status: 'unknown',
        errorMessage: `Manual delivery ${activeReservation.childDeliveryId} is missing`,
      });
      throw new ConflictException(
        'Manual resend history is incomplete; outcome is unknown and requires explicit review',
      );
    }

    if (child.status === 'pending') {
      const payload = child.payload as unknown as RunLifecycleEvent;
      await this.dispatcherService.dispatchPendingDelivery(channel, child.id, payload);
      child = (await this.deliveryRepository.findById(child.id)) ?? child;
    }

    if (child.status === 'sending') {
      child =
        (await this.deliveryRepository.markStaleSendingUnknown(
          child.id,
          channel.id,
          new Date(Date.now() - AMBIGUOUS_DELIVERY_TTL_MS),
          'A previous manual delivery attempt did not record a definitive outcome',
        )) ?? child;
    }

    if (child.status === 'pending' || child.status === 'sending') {
      throw new ConflictException('Manual resend has not reached a terminal outcome');
    }

    const completion =
      child.status === 'sent'
        ? {
            status: 'sent' as const,
            sentAt: child.sentAt ?? new Date(),
            errorMessage: `Resolved by manual delivery ${child.id}`,
          }
        : child.status === 'failed'
          ? {
              status: 'failed' as const,
              errorMessage: `Manual delivery ${child.id} failed: ${
                child.errorMessage ?? 'unknown error'
              }`,
            }
          : {
              status: 'unknown' as const,
              errorMessage: `Manual delivery ${child.id} has an unknown outcome`,
            };

    let finalized = false;
    if (child.status === 'sent' && parent.outboxEventId) {
      const requeued = await this.outboxRepository.requeueDeadLetter(
        parent.outboxEventId,
        organizationId,
        async (executor) => {
          const completed = await this.deliveryRepository.completeManualResend(
            parent.id,
            channel.id,
            reservation,
            completion,
            executor,
          );
          if (!completed) {
            throw new ConflictException(
              'Manual resend reservation changed before outbox recovery completed',
            );
          }
          await this.auditLogService.recordDurableWithExecutor(executor, auth, {
            action: 'notification_delivery.resend',
            resourceType: 'notification_delivery',
            resourceId: parent.id,
            metadata: {
              channelId: channel.id,
              originalStatus: activeReservation.originalStatus,
              manualDeliveryId: child.id,
              outboxEventId: parent.outboxEventId,
              phase: 'reconciled',
            },
          });
        },
      );
      finalized = Boolean(requeued);
    }

    if (!finalized) {
      finalized = await this.finalizeManualResend(
        auth,
        parent,
        reservation,
        activeReservation,
        completion,
      );
    }
    if (!finalized) {
      this.logger.warn(
        `Manual resend reservation for delivery ${parent.id} changed before finalization`,
      );
    }
    return this.toDeliveryResponse(child);
  }

  private finalizeManualResend(
    auth: AuthContext | null,
    parent: NotificationDeliveryRecord,
    reservation: string,
    activeReservation: ManualResendReservation,
    completion: Partial<NotificationDeliveryRecord>,
  ): Promise<boolean> {
    return this.deliveryRepository.finalizeManualResend(
      parent.id,
      parent.channelId,
      reservation,
      completion,
      (executor) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'notification_delivery.resend',
          resourceType: 'notification_delivery',
          resourceId: parent.id,
          metadata: {
            channelId: parent.channelId,
            originalStatus: activeReservation.originalStatus,
            manualDeliveryId: activeReservation.childDeliveryId,
            phase: 'reconciled',
          },
        }),
    );
  }

  private createManualResendReservation(
    childDeliveryId: string,
    originalStatus: 'failed' | 'unknown',
  ): string {
    return [
      MANUAL_RESEND_RESERVATION_PREFIX,
      childDeliveryId,
      Date.now().toString(),
      originalStatus,
    ].join('|');
  }

  private validateConfig(type: string, config: Record<string, unknown>): void {
    if (type === 'slack') {
      const result = SlackChannelConfigSchema.safeParse(config);
      if (!result.success) {
        throw new BadRequestException(
          `Invalid Slack config: ${result.error.issues.map((i: { message: string }) => i.message).join(', ')}`,
        );
      }
    }
    if (type === 'discord') {
      const result = DiscordChannelConfigSchema.safeParse(config);
      if (!result.success) {
        throw new BadRequestException(
          `Invalid Discord config: ${result.error.issues.map((i: { message: string }) => i.message).join(', ')}`,
        );
      }
    }
    // email and pagerduty validation can be added when those adapters are implemented
  }

  /** Mask webhook URLs in config for GET responses. */
  private maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    const masked = { ...config };
    if (typeof masked.webhookUrl === 'string') {
      const url = masked.webhookUrl;
      masked.webhookUrl = `****${url.slice(-8)}`;
    }
    return masked;
  }

  private toChannelResponse(
    record: NotificationChannelRecord,
    maskSensitive: boolean,
  ): NotificationChannel {
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      type: record.type,
      config: maskSensitive ? this.maskConfig(record.config) : record.config,
      status: record.status,
      events: record.events as NotificationChannel['events'],
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toDeliveryResponse(record: NotificationDeliveryRecord): NotificationDelivery {
    return {
      id: record.id,
      channelId: record.channelId,
      runId: record.runId,
      eventType: record.eventType,
      status: record.status,
      payload: record.payload,
      errorMessage: record.errorMessage,
      durationMs: record.durationMs ?? null,
      responseStatus: record.responseStatus ?? null,
      responseBody: record.responseBody ?? null,
      createdAt: record.createdAt.toISOString(),
      sentAt: record.sentAt?.toISOString() ?? null,
    };
  }
}
