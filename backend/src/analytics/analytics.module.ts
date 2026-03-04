import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';
import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { OpenSearchTenantService } from './opensearch-tenant.service';
import { AnalyticsController } from './analytics.controller';
import { FindingsController } from './findings.controller';

@Module({
  imports: [ConfigModule],
  controllers: [AnalyticsController, FindingsController],
  providers: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    OpenSearchTenantService,
  ],
  exports: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    OpenSearchTenantService,
  ],
})
export class AnalyticsModule {}
