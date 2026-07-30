import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { NodeIOModule } from '../node-io/node-io.module';
import { ScopesModule } from '../scopes/scopes.module';
import { StorageModule } from '../storage/storage.module';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { WorkflowVersionRepository } from '../workflows/repository/workflow-version.repository';
import { AssetInventoryService } from './asset-inventory.service';
import { AssetRunComparisonService } from './asset-run-comparison.service';
import { AssetsController } from './assets.controller';
import { AssetInventoryRepository } from './assets.repository';
import { AssetsService } from './assets.service';

@Module({
  imports: [DatabaseModule, NodeIOModule, StorageModule, ScopesModule],
  controllers: [AssetsController],
  // Workflow repositories are re-provided directly (they only need DRIZZLE_TOKEN)
  // rather than importing the whole WorkflowsModule, which pulls in Temporal/
  // Terminal/Analytics and would be a much heavier, one-directional-only import.
  providers: [
    AssetsService,
    AssetInventoryService,
    AssetRunComparisonService,
    AssetInventoryRepository,
    WorkflowRunRepository,
    WorkflowVersionRepository,
  ],
  exports: [AssetInventoryRepository],
})
export class AssetsModule {}
