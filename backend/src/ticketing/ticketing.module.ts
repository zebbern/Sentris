import { forwardRef, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FindingTriageModule } from '../findings/finding-triage.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TicketingController } from './ticketing.controller';
import { TicketingService } from './ticketing.service';
import { TicketingRepository } from './ticketing.repository';
import { TicketingListenerService } from './ticketing-listener.service';
import { JiraAdapter } from './jira/jira.adapter';
import { JiraWebhookController } from './jira/jira-webhook.controller';
import { JiraWebhookService } from './jira/jira-webhook.service';

@Module({
  imports: [DatabaseModule, IntegrationsModule, forwardRef(() => FindingTriageModule)],
  controllers: [TicketingController, JiraWebhookController],
  providers: [
    TicketingService,
    TicketingRepository,
    TicketingListenerService,
    JiraAdapter,
    JiraWebhookService,
  ],
  exports: [TicketingService, TicketingRepository],
})
export class TicketingModule {}
