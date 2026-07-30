import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { RunLifecycleEvent } from '@sentris/shared';
import { NotificationChannelRepository } from './repository/notification-channel.repository';
import { NotificationDeliveryRepository } from './repository/notification-delivery.repository';
import { SlackNotificationAdapter } from './adapters/slack.adapter';
import { DiscordNotificationAdapter } from './adapters/discord.adapter';
import type { NotificationAdapterResult } from './adapters/notification.adapter';
import type { NotificationChannelRecord } from '../database/schema';
import { parseManualResendReservation } from './manual-resend-reservation';

interface DurableRunLifecycleEvent extends RunLifecycleEvent {
  outbox?: {
    eventId: string;
    dedupeKey: string;
    attempt: number;
  };
}

/** Maps terminal execution statuses to notification event types. */
const STATUS_TO_EVENT_TYPE: Record<string, string> = {
  COMPLETED: 'run.completed',
  FAILED: 'run.failed',
  CANCELLED: 'run.cancelled',
  TERMINATED: 'run.cancelled', // TERMINATED maps to the cancelled event
  TIMED_OUT: 'run.timed_out',
};

export class NotificationDeliveryAmbiguousError extends Error {
  constructor(detail?: string) {
    super(
      `Notification delivery outcome is unknown; manual resend is required${
        detail ? `: ${detail}` : ''
      }`,
    );
    this.name = 'NotificationDeliveryAmbiguousError';
  }
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly channelRepository: NotificationChannelRepository,
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly slackAdapter: SlackNotificationAdapter,
    private readonly discordAdapter: DiscordNotificationAdapter,
  ) {}

  @OnEvent('run.status.terminal', { async: true })
  async handleRunTerminal(payload: DurableRunLifecycleEvent): Promise<void> {
    const eventType = STATUS_TO_EVENT_TYPE[payload.status];
    if (!eventType) {
      this.logger.debug(`No event type mapping for status ${payload.status}`);
      return;
    }

    const channels = await this.channelRepository.findActiveByEventType(
      payload.organizationId,
      eventType,
    );

    if (channels.length === 0) {
      return;
    }

    this.logger.log(
      `Dispatching ${eventType} for run ${payload.runId} to ${channels.length} channel(s)`,
    );

    const results = await Promise.allSettled(
      channels.map((channel) => this.dispatchToChannel(channel, payload, eventType)),
    );

    for (const [index, result] of results.entries()) {
      const channel = channels[index];
      if (result.status === 'rejected') {
        this.logger.error(
          `Unexpected error dispatching to channel ${channel?.id}: ${result.reason}`,
        );
      }
    }

    if (payload.outbox) {
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failures.length > 0) {
        throw new Error(
          failures
            .map((failure) =>
              failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
            )
            .join('; '),
        );
      }
    }
  }

  async dispatchToChannel(
    channel: NotificationChannelRecord,
    payload: DurableRunLifecycleEvent,
    eventType: string,
  ): Promise<string> {
    const deliveryInput = {
      channelId: channel.id,
      runId: payload.runId,
      eventType,
      status: 'pending',
      payload: payload as unknown as Record<string, unknown>,
    } as const;
    const delivery = payload.outbox
      ? await this.deliveryRepository.findOrCreateForOutbox({
          ...deliveryInput,
          outboxEventId: payload.outbox.eventId,
        })
      : await this.deliveryRepository.create(deliveryInput);

    if (delivery.status === 'sent') {
      return delivery.id;
    }
    if (delivery.status === 'sending') {
      if (parseManualResendReservation(delivery.errorMessage)) {
        throw new NotificationDeliveryAmbiguousError('manual resend is already in progress');
      }
      await this.deliveryRepository.update(delivery.id, {
        status: 'unknown',
        sendingStartedAt: null,
        errorMessage: 'A previous delivery attempt did not record a definitive outcome',
      });
      throw new NotificationDeliveryAmbiguousError();
    }
    if (delivery.status === 'unknown') {
      throw new NotificationDeliveryAmbiguousError();
    }
    if (!(await this.deliveryRepository.claimForSend(delivery.id))) {
      throw new NotificationDeliveryAmbiguousError();
    }

    return this.sendClaimedDelivery(channel, delivery.id, payload);
  }

  /**
   * Send a delivery row that another transaction created as pending. This is
   * used by manual/test operations so their requested audit and history row
   * commit before the external webhook call.
   */
  async dispatchPendingDelivery(
    channel: NotificationChannelRecord,
    deliveryId: string,
    payload: DurableRunLifecycleEvent,
  ): Promise<string> {
    const delivery = await this.deliveryRepository.findById(deliveryId);
    if (!delivery || delivery.channelId !== channel.id) {
      throw new Error(`Notification delivery ${deliveryId} is not owned by channel ${channel.id}`);
    }
    if (
      delivery.status === 'sent' ||
      delivery.status === 'failed' ||
      delivery.status === 'unknown'
    ) {
      return delivery.id;
    }
    if (delivery.status !== 'pending') {
      throw new NotificationDeliveryAmbiguousError('delivery attempt is already in progress');
    }
    if (!(await this.deliveryRepository.claimForSend(delivery.id))) {
      throw new NotificationDeliveryAmbiguousError('delivery attempt is already in progress');
    }
    return this.sendClaimedDelivery(channel, delivery.id, payload);
  }

  private async sendClaimedDelivery(
    channel: NotificationChannelRecord,
    deliveryId: string,
    payload: DurableRunLifecycleEvent,
  ): Promise<string> {
    const startTime = Date.now();

    let result: NotificationAdapterResult;
    try {
      if (channel.type === 'slack') {
        result = await this.slackAdapter.send(channel, payload);
      } else if (channel.type === 'discord') {
        result = await this.discordAdapter.send(channel, payload);
      } else {
        result = {
          success: false,
          error: `Channel type '${channel.type}' is not implemented`,
        };
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.deliveryRepository.update(deliveryId, {
        status: 'unknown',
        sendingStartedAt: null,
        errorMessage: message,
        durationMs,
      });
      this.logger.error(`Delivery ${deliveryId} to channel ${channel.id} threw: ${message}`);
      if (payload.outbox) {
        throw new NotificationDeliveryAmbiguousError(message);
      }
      return deliveryId;
    }

    const durationMs = Date.now() - startTime;
    if (!result.success) {
      const unknown = result.outcome === 'unknown';
      await this.deliveryRepository.update(deliveryId, {
        status: unknown ? 'unknown' : 'failed',
        sendingStartedAt: null,
        errorMessage: result.error ?? 'Unknown error',
        durationMs,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
      });
      this.logger.warn(`Delivery ${deliveryId} to channel ${channel.id} failed: ${result.error}`);
      if (payload.outbox) {
        if (unknown) {
          throw new NotificationDeliveryAmbiguousError(result.error);
        }
        throw new Error(result.error ?? 'Notification delivery failed');
      }
      return deliveryId;
    }

    await this.deliveryRepository.update(deliveryId, {
      status: 'sent',
      sendingStartedAt: null,
      sentAt: new Date(),
      durationMs,
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
    });
    this.logger.log(`Delivery ${deliveryId} to channel ${channel.id} succeeded`);
    return deliveryId;
  }
}
