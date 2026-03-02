import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import { SecretsModule } from '../secrets/secrets.module';
import { TemporalModule } from '../temporal/temporal.module';
import { McpServersController } from './mcp-servers.controller';
import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository } from './mcp-servers.repository';
import { McpServersService } from './mcp-servers.service';
import type { RedisConfig } from '../config';

// Redis injection token - must match the one in mcp-servers.service.ts
const MCP_SERVERS_REDIS = 'MCP_SERVERS_REDIS';

@Module({
  imports: [DatabaseModule, SecretsModule, TemporalModule],
  controllers: [McpServersController],
  providers: [
    McpServersService,
    McpServersRepository,
    McpServersEncryptionService,
    {
      provide: MCP_SERVERS_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl ?? 'redis://localhost:6379';
        return new Redis(url);
      },
      inject: [ConfigService],
    },
  ],
  exports: [McpServersService, McpServersRepository],
})
export class McpServersModule {}
