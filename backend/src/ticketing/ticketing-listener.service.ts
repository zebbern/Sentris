import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { FindingTriageChangedEvent, TicketingConnectionConfig } from '@sentris/shared';
import { TicketingService } from './ticketing.service';
import { TicketingRepository } from './ticketing.repository';

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

      const existingLink = await this.repository.findTicketLinkByTriageId(event.findingTriageId);

      if (existingLink) {
        // Ticket exists — sync status
        await this.ticketingService.updateTicketStatus(
          event.organizationId,
          event.findingTriageId,
          event.status,
        );
        this.logger.log(
          `Synced ticket ${existingLink.externalId} status for triage ${event.findingTriageId}`,
        );
      } else if (
        config.autoCreateOnStatuses &&
        (config.autoCreateOnStatuses as string[]).includes(event.status)
      ) {
        // No ticket yet — auto-create if status is in the auto-create list
        await this.ticketingService.createTicket(event.organizationId, event.findingTriageId, {
          findingOpensearchId: event.findingOpensearchId,
          title: `Security Finding: ${event.findingOpensearchId}`,
          description: `Status changed to ${event.status} (from ${event.previousStatus})`,
          severity: undefined,
        });
        this.logger.log(
          `Auto-created Jira ticket for triage ${event.findingTriageId} (status: ${event.status})`,
        );
      }
    } catch (error) {
      // Never let listener errors propagate — they are non-blocking
      this.logger.error(
        `Failed to process finding.triage.changed event for triage ${event.findingTriageId}: ${error}`,
      );
    }
  }
}
