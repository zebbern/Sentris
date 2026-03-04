import { forwardRef, Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { OrgMembersModule } from '../org/org-members.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { FindingTriageController } from './finding-triage.controller';
import { FindingTriageService } from './finding-triage.service';
import { FindingTriageRepository } from './finding-triage.repository';
import { TriageAnalyticsController } from './triage-analytics.controller';
import { TriageAnalyticsService } from './triage-analytics.service';
import { TriageAnalyticsRepository } from './triage-analytics.repository';
import { SlaPolicyService } from './sla-policy.service';
import { SlaPolicyRepository } from './sla-policy.repository';

@Module({
  imports: [forwardRef(() => AnalyticsModule), OrgMembersModule, TicketingModule],
  controllers: [FindingTriageController, TriageAnalyticsController],
  providers: [
    FindingTriageService,
    FindingTriageRepository,
    TriageAnalyticsService,
    TriageAnalyticsRepository,
    SlaPolicyService,
    SlaPolicyRepository,
  ],
  exports: [FindingTriageService, SlaPolicyService],
})
export class FindingTriageModule {}
