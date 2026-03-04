import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import { TemporalModule } from '../temporal/temporal.module';
import { StorageModule } from '../storage/storage.module';
import { TerminalModule } from '../terminal/terminal.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NodeIOModule } from '../node-io/node-io.module';
import type { RedisConfig } from '../config';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { TerminalRecordRepository } from './repository/terminal-record.repository';
import { WorkflowTagsRepository } from './repository/workflow-tags.repository';
import { TerminalArchiveService } from './terminal-archive.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowTagsController } from './workflow-tags.controller';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowRunObservabilityController } from './workflow-run-observability.controller';
import { WorkflowRunStreamController } from './workflow-run-stream.controller';
import { InternalRunsController } from './internal-runs.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowRunService } from './workflow-run.service';
import { WorkflowTagsService } from './workflow-tags.service';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowRoleGuard } from './workflow-role.guard';
import { FlowContextCacheService } from './flow-context-cache.service';
import { ArchivingLockService } from './archiving-lock.service';
import { FLOW_CONTEXT_REDIS, ARCHIVING_REDIS } from './workflows.tokens';
// import { WorkflowsBootstrapService } from './workflows.bootstrap';

@Module({
  imports: [
    DatabaseModule,
    TemporalModule,
    StorageModule,
    TerminalModule,
    AnalyticsModule,
    NodeIOModule,
  ],
  controllers: [
    WorkflowRunsController, // /runs (literal) — must come before wildcard
    WorkflowRunObservabilityController, // /runs/:runId/trace etc.
    WorkflowRunStreamController, // /runs/:runId/stream etc.
    WorkflowTagsController, // /workflow-tags — different prefix, order doesn't matter
    WorkflowsController, // :id (wildcard) — must come last
    InternalRunsController, // different prefix, order doesn't matter
  ],
  providers: [
    {
      provide: FLOW_CONTEXT_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl;
        if (!url) {
          new Logger('WorkflowsModule').warn('Redis URL not set; flow context cache disabled');
          return null;
        }
        const client = new Redis(url);
        client.on('error', (err) => new Logger('WorkflowsModule').warn(`FLOW_CONTEXT_REDIS error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: ARCHIVING_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl;
        if (!url) {
          new Logger('WorkflowsModule').warn('Redis URL not set; archiving lock disabled');
          return null;
        }
        const client = new Redis(url);
        client.on('error', (err) => new Logger('WorkflowsModule').warn(`ARCHIVING_REDIS error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
    WorkflowsService,
    WorkflowRunService,
    WorkflowTagsService,
    WorkflowVersionService,
    WorkflowRepository,
    WorkflowRunRepository,
    WorkflowVersionRepository,
    WorkflowRoleRepository,
    TerminalRecordRepository,
    TerminalArchiveService,
    FlowContextCacheService,
    ArchivingLockService,
    WorkflowRoleGuard,
    WorkflowTagsRepository,
  ],
  exports: [
    WorkflowsService,
    WorkflowRunService,
    WorkflowTagsService,
    WorkflowVersionService,
    WorkflowRepository,
    WorkflowRunRepository,
    WorkflowVersionRepository,
  ],
})
export class WorkflowsModule {}
