import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { RunLifecycleEvent } from '@sentris/shared';
import { NotificationChannelRepository } from './repository/notification-channel.repository';
import { NotificationDeliveryRepository } from './repository/notification-delivery.repository';
import { SlackNotificationAdapter } from './adapters/slack.adapter';
import type { NotificationChannelRecord } from '../database/schema';

/** Maps terminal execution statuses to notification event types. */
const STATUS_TO_EVENT_TYPE: Record<string, string> = {
  COMPLETED: 'run.completed',
  FAILED: 'run.failed',
  CANCELLED: 'run.cancelled',
  TERMINATED: 'run.cancelled', // TERMINATED maps to the cancelled event
  TIMED_OUT: 'run.timed_out',
};

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly channelRepository: NotificationChannelRepository,
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly slackAdapter: SlackNotificationAdapter,
  ) {}

  @OnEvent('run.status.terminal', { async: true })
  async handleRunTerminal(payload: RunLifecycleEvent): Promise<void> {
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
  }

  async dispatchToChannel(
    channel: NotificationChannelRecord,
    payload: RunLifecycleEvent,
    eventType: string,
  ): Promise<string> {
    // Create a pending delivery record
    const delivery = await this.deliveryRepository.create({
      channelId: channel.id,
      runId: payload.runId,
      eventType,
      status: 'pending',
      payload: payload as unknown as Record<string, unknown>,
    });

    const startTime = Date.now();

    try {
      let result: {
        success: boolean;
        error?: string;
        responseStatus?: number;
        responseBody?: string;
      };

      if (channel.type === 'slack') {
        result = await this.slackAdapter.send(channel, payload);
      } else {
        result = {
          success: false,
          error: `Channel type '${channel.type}' is not implemented`,
        };
      }

      const durationMs = Date.now() - startTime;

      if (result.success) {
        await this.deliveryRepository.update(delivery.id, {
          status: 'sent',
          sentAt: new Date(),
          durationMs,
          responseStatus: result.responseStatus,
          responseBody: result.responseBody,
        });
        this.logger.log(`Delivery ${delivery.id} to channel ${channel.id} succeeded`);
      } else {
        await this.deliveryRepository.update(delivery.id, {
          status: 'failed',
          errorMessage: result.error ?? 'Unknown error',
          durationMs,
          responseStatus: result.responseStatus,
          responseBody: result.responseBody,
        });
        this.logger.warn(
          `Delivery ${delivery.id} to channel ${channel.id} failed: ${result.error}`,
        );
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.deliveryRepository.update(delivery.id, {
        status: 'failed',
        errorMessage: message,
        durationMs,
      });
      this.logger.error(`Delivery ${delivery.id} to channel ${channel.id} threw: ${message}`);
    }

    return delivery.id;
  }
}
