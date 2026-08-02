import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';
import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { OpenSearchTenantService } from './opensearch-tenant.service';
import { AnalyticsController } from './analytics.controller';
import { FindingsController } from './findings.controller';
import { FindingTriageModule } from '../findings/finding-triage.module';
import { DatabaseModule } from '../database/database.module';
import { ScopesRepository } from '../scopes/scopes.repository';
import { FindingsQueryService } from './findings-query.service';

@Module({
  imports: [ConfigModule, DatabaseModule, forwardRef(() => FindingTriageModule)],
  controllers: [AnalyticsController, FindingsController],
  providers: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    OpenSearchTenantService,
    ScopesRepository,
    FindingsQueryService,
  ],
  exports: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    OpenSearchTenantService,
    FindingsQueryService,
  ],
})
export class AnalyticsModule {}
