import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import type { RedisConfig } from '../config';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { TokenEncryptionService } from './token.encryption';
import { INTEGRATION_CACHE_REDIS } from './integrations.tokens';

@Module({
  imports: [DatabaseModule],
  controllers: [IntegrationsController],
  providers: [
    {
      provide: INTEGRATION_CACHE_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl;
        if (!url) {
          new Logger('IntegrationsModule').warn(
            'Redis URL not set; provider overrides cross-instance invalidation disabled',
          );
          return null;
        }
        const client = new Redis(url);
        client.on('error', (err) => new Logger('IntegrationsModule').warn(`INTEGRATION_CACHE_REDIS error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
    IntegrationsService,
    IntegrationsRepository,
    TokenEncryptionService,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
