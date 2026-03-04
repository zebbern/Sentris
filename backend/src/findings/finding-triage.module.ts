import { forwardRef, Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { OrgMembersModule } from '../org/org-members.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { FindingTriageController } from './finding-triage.controller';
import { FindingTriageService } from './finding-triage.service';
import { FindingTriageRepository } from './finding-triage.repository';

@Module({
  imports: [forwardRef(() => AnalyticsModule), OrgMembersModule, TicketingModule],
  controllers: [FindingTriageController],
  providers: [FindingTriageService, FindingTriageRepository],
  exports: [FindingTriageService],
})
export class FindingTriageModule {}
