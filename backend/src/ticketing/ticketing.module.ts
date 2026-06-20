import { forwardRef, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { TICKETING_OAUTH_REDIS } from '../common/redis/redis.tokens';
import type { RedisConfig } from '../config';
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
  imports: [
    ConfigModule,
    DatabaseModule,
    IntegrationsModule,
    forwardRef(() => FindingTriageModule),
  ],
  controllers: [TicketingController, JiraWebhookController],
  providers: [
    {
      provide: TICKETING_OAUTH_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis');
        const url = redis?.url ?? redis?.terminalUrl;
        if (!url) {
          new Logger('TicketingModule').warn('Redis URL not set; ticketing OAuth state disabled');
          return null;
        }
        const client = new Redis(url);
        client.on('error', (err) =>
          new Logger('TicketingModule').warn(`TICKETING_OAUTH_REDIS error: ${err.message}`),
        );
        return client;
      },
      inject: [ConfigService],
    },
    TicketingService,
    TicketingRepository,
    TicketingListenerService,
    JiraAdapter,
    JiraWebhookService,
  ],
  exports: [TicketingService, TicketingRepository],
})
export class TicketingModule {}
