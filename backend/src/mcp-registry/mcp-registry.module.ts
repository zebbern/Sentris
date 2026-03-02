import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import { McpServersModule } from '../mcp-servers/mcp-servers.module';
import { McpRegistryController } from './mcp-registry.controller';
import { McpRegistryService } from './mcp-registry.service';
import { McpRegistrySyncService } from './mcp-registry-sync.service';
import { McpRegistryRepository } from './mcp-registry.repository';
import type { RedisConfig } from '../config';

export const MCP_REGISTRY_REDIS = 'MCP_REGISTRY_REDIS';

@Module({
  imports: [DatabaseModule, McpServersModule],
  controllers: [McpRegistryController],
  providers: [
    McpRegistryService,
    McpRegistrySyncService,
    McpRegistryRepository,
    {
      provide: MCP_REGISTRY_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? 'redis://localhost:6379';
        return new Redis(url);
      },
      inject: [ConfigService],
    },
  ],
  exports: [McpRegistryService],
})
export class McpRegistryModule {}
