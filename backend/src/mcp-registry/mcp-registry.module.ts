import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from '../database/database.module';
import { McpServersModule } from '../mcp-servers/mcp-servers.module';
import { McpRegistryController } from './mcp-registry.controller';
import { McpRegistryService } from './mcp-registry.service';
import { McpRegistrySyncService } from './mcp-registry-sync.service';
import { McpRegistryRepository } from './mcp-registry.repository';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot(), McpServersModule],
  controllers: [McpRegistryController],
  providers: [McpRegistryService, McpRegistrySyncService, McpRegistryRepository],
  exports: [McpRegistryService],
})
export class McpRegistryModule {}
