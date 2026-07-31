import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { McpRuntimeRepository } from './mcp-runtime.repository';

@Module({
  imports: [DatabaseModule],
  providers: [McpRuntimeRepository],
  exports: [McpRuntimeRepository],
})
export class McpRuntimeModule {}
