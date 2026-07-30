import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseModule } from '../database/database.module';
import { ScopeFindingsController } from './scope-findings.controller';
import { ScopeFindingsService } from './scope-findings.service';
import { ScopesController } from './scopes.controller';
import { ScopesRepository } from './scopes.repository';
import { ScopesService } from './scopes.service';

@Module({
  imports: [DatabaseModule, AnalyticsModule],
  controllers: [ScopesController, ScopeFindingsController],
  providers: [ScopesService, ScopeFindingsService, ScopesRepository],
  exports: [ScopesService],
})
export class ScopesModule {}
