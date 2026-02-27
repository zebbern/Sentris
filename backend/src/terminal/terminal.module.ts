import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TerminalStreamService, TERMINAL_REDIS } from './terminal-stream.service';
import type { RedisConfig } from '../config';

@Global()
@Module({
  providers: [
    {
      provide: TERMINAL_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.terminalUrl;
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
      inject: [ConfigService],
    },
    TerminalStreamService,
  ],
  exports: [TerminalStreamService],
})
export class TerminalModule {}
