import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  type NotificationChannel,
  type NotificationDelivery,
  type RunLifecycleEvent,
  SlackChannelConfigSchema,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationChannelRepository } from './repository/notification-channel.repository';
import { NotificationDeliveryRepository } from './repository/notification-delivery.repository';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { SlackNotificationAdapter } from './adapters/slack.adapter';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../database/schema';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly channelRepository: NotificationChannelRepository,
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly slackAdapter: SlackNotificationAdapter,
    private readonly auditLogService: AuditLogService,
    private readonly dispatcherService: NotificationDispatcherService,
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
      type: 'slack' | 'email' | 'pagerduty';
      config: Record<string, unknown>;
      events: string[];
    },
  ): Promise<NotificationChannel> {
    const organizationId = requireOrganizationId(auth);

    // Validate config shape for the given type
    this.validateConfig(dto.type, dto.config);

    const record = await this.channelRepository.create({
      organizationId,
      name: dto.name,
      type: dto.type,
      config: dto.config,
      events: dto.events,
      status: 'active',
      createdBy: auth?.userId ?? null,
    });

    this.logger.log(`Created notification channel ${record.id} (${dto.type})`);
    this.auditLogService.record(auth, {
      action: 'notification_channel.create',
      resourceType: 'notification_channel',
      resourceId: record.id,
      resourceName: record.name,
      metadata: { type: dto.type, events: dto.events },
    });

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
    );

    if (!updated) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }

    this.logger.log(`Updated notification channel ${id}`);
    this.auditLogService.record(auth, {
      action: 'notification_channel.update',
      resourceType: 'notification_channel',
      resourceId: id,
      resourceName: updated.name,
      metadata: { updatedFields: Object.keys(dto) },
    });

    return this.toChannelResponse(updated, true);
  }

  async delete(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    const existing = await this.channelRepository.findById(id, { organizationId });
    if (!existing) {
      throw new NotFoundException(`Notification channel ${id} not found`);
    }

    await this.channelRepository.delete(id, { organizationId });
    this.logger.log(`Deleted notification channel ${id}`);
    this.auditLogService.record(auth, {
      action: 'notification_channel.delete',
      resourceType: 'notification_channel',
      resourceId: id,
      resourceName: existing.name,
    });
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

    if (channel.type !== 'slack') {
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

    return this.slackAdapter.send(channel, testPayload);
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
    const delivery = await this.deliveryRepository.findById(deliveryId);
    if (!delivery || delivery.channelId !== channelId) {
      throw new NotFoundException(`Delivery ${deliveryId} not found`);
    }

    // Only failed deliveries can be re-sent
    if (delivery.status !== 'failed') {
      throw new BadRequestException('Only failed deliveries can be re-sent');
    }

    // Dispatch using original payload and event type
    const payload = delivery.payload as unknown as RunLifecycleEvent;
    const newDeliveryId = await this.dispatcherService.dispatchToChannel(
      channel,
      payload,
      delivery.eventType,
    );

    // Audit log the resend action
    this.auditLogService.record(auth, {
      action: 'notification_delivery.resend',
      resourceType: 'notification_delivery',
      resourceId: deliveryId,
      metadata: { newDeliveryId, channelId },
    });

    // Return the new delivery record
    const newDelivery = await this.deliveryRepository.findById(newDeliveryId);
    if (!newDelivery) {
      throw new NotFoundException('New delivery record not found after resend');
    }

    return this.toDeliveryResponse(newDelivery);
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
