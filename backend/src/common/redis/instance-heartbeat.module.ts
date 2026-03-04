import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { RedisConfig } from '../../config';
import { INSTANCE_HEARTBEAT_REDIS } from './redis.tokens';
import { InstanceHeartbeatService } from './instance-heartbeat.service';

/**
 * Global module providing instance heartbeat registration.
 * Runs in every backend instance — publishes liveness to Redis.
 */
@Global()
@Module({
  providers: [
    {
      provide: INSTANCE_HEARTBEAT_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl;
        if (!url) {
          new Logger('InstanceHeartbeatModule').warn(
            'Redis URL not set; instance heartbeat disabled',
          );
          return null;
        }
        const client = new Redis(url);
        client.on('error', (err) => new Logger('InstanceHeartbeatModule').warn(`INSTANCE_HEARTBEAT_REDIS error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
    InstanceHeartbeatService,
  ],
  exports: [InstanceHeartbeatService],
})
export class InstanceHeartbeatModule {}
