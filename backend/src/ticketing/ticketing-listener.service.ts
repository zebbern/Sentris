import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { FindingTriageChangedEvent, TicketingConnectionConfig } from '@sentris/shared';
import { TicketingService } from './ticketing.service';
import {
  JIRA_WEBHOOK_REGISTRATION_EVENT_TYPE,
  type JiraWebhookRegistrationRequestedEvent,
  TicketingRepository,
} from './ticketing.repository';

@Injectable()
export class TicketingListenerService {
  private readonly logger = new Logger(TicketingListenerService.name);

  constructor(
    private readonly ticketingService: TicketingService,
    private readonly repository: TicketingRepository,
  ) {}

  @OnEvent('finding.triage.changed', { async: true })
  async handleFindingTriageChanged(event: FindingTriageChangedEvent): Promise<void> {
    try {
      this.requireProjectionVersion(event.projectionVersion);

      // Circular sync prevention: skip events originating from Jira webhooks
      if (event.source === 'jira_webhook') {
        return;
      }

      const conn = await this.repository.findConnectionByOrg(event.organizationId);
      if (!conn) {
        return; // No ticketing connection for this org
      }

      const config = conn.config as TicketingConnectionConfig;
      if (!config?.projectKey || !config?.issueTypeId) {
        return; // Connection not fully configured
      }

      const existingLink = await this.repository.findTicketLinkByTriageId(
        event.findingTriageId,
        event.organizationId,
      );
      const unresolvedIntent =
        existingLink?.syncStatus === 'pending' ||
        existingLink?.syncStatus === 'unknown' ||
        existingLink?.externalId.startsWith('sentris-pending:');
      const lastAppliedProjectionVersion = this.lastAppliedProjectionVersion(
        existingLink?.metadata,
      );

      if (
        existingLink &&
        !unresolvedIntent &&
        lastAppliedProjectionVersion >= event.projectionVersion
      ) {
        return;
      }

      if (existingLink && !unresolvedIntent) {
        // Ticket exists — sync status
        await this.ticketingService.updateTicketStatus(
          event.organizationId,
          event.findingTriageId,
          event.status,
          event.projectionVersion,
        );
        this.logger.log(
          `Synced ticket ${existingLink.externalId} status for triage ${event.findingTriageId}`,
        );
      } else if (
        config.autoCreateOnStatuses &&
        (config.autoCreateOnStatuses as string[]).includes(event.status)
      ) {
        // No ticket yet — auto-create if status is in the auto-create list
        await this.ticketingService.createTicket(
          event.organizationId,
          event.findingTriageId,
          {
            findingOpensearchId: event.findingOpensearchId,
            title: `Security Finding: ${event.findingOpensearchId}`,
            description: `Status changed to ${event.status} (from ${event.previousStatus})`,
            severity: undefined,
          },
          event.projectionVersion,
        );
        this.logger.log(
          `Auto-created Jira ticket for triage ${event.findingTriageId} (status: ${event.status})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process finding.triage.changed event for triage ${event.findingTriageId}: ${error}`,
      );
      throw error;
    }
  }

  @OnEvent(JIRA_WEBHOOK_REGISTRATION_EVENT_TYPE, { async: true })
  async handleJiraWebhookRegistrationRequested(
    event: JiraWebhookRegistrationRequestedEvent,
  ): Promise<void> {
    await this.ticketingService.registerPendingWebhook(event);
  }

  private lastAppliedProjectionVersion(metadata: unknown): number {
    if (!metadata || typeof metadata !== 'object') return 0;
    const value = (metadata as Record<string, unknown>).lastAppliedProjectionVersion;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private requireProjectionVersion(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('finding.triage.changed projectionVersion must be a positive integer');
    }
  }
}
