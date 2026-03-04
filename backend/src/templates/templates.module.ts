import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import type { RedisConfig } from '../config';
import { TemplatesController } from './templates.controller';
import { TemplateService } from './templates.service';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import { GitHubSyncService } from './github-sync.service';
import { TemplateSeedService } from './template-seed.service';
import { EtagCacheService } from './etag-cache.service';
import { TEMPLATE_CACHE_REDIS } from './templates.tokens';

/**
 * Templates Module
 * Handles template library operations.
 *
 * Uses GitHub web flow for publishing and GitHub API for syncing templates.
 * Templates are synced on startup and via manual admin trigger.
 * Auto-seeds from local JSON files when the templates table is empty.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, WorkflowsModule],
  controllers: [TemplatesController],
  providers: [
    {
      provide: TEMPLATE_CACHE_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl;
        if (!url) {
          new Logger('TemplatesModule').warn('Redis URL not set; etag cache disabled');
          return null;
        }
        const client = new Redis(url);
        client.on('error', (err) => new Logger('TemplatesModule').warn(`TEMPLATE_CACHE_REDIS error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
    TemplateSeedService,
    TemplateService,
    WorkflowSanitizationService,
    TemplatesRepository,
    GitHubSyncService,
    EtagCacheService,
  ],
  exports: [TemplateService, GitHubSyncService],
})
export class TemplatesModule {}
