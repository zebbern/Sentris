import { Global, Module } from '@nestjs/common';

import { TraceService } from './trace.service';
import { TraceRepository } from './trace.repository';
import { LogStreamRepository } from './log-stream.repository';
import { LogStreamService } from './log-stream.service';
import { DatabaseModule } from '../database/database.module';
import { LogIngestService } from '../logging/log-ingest.service';
import { EventIngestService } from '../events/event-ingest.service';
import { AgentTraceIngestService } from '../agent-trace/agent-trace-ingest.service';
import { AgentTraceRepository } from '../agent-trace/agent-trace.repository';
import { AgentTraceService } from '../agent-trace/agent-trace.service';
import { AgentConversationRepository } from '../agent-trace/agent-conversation.repository';
import { KafkaIngestRuntimeModule } from '../common/kafka-ingest-runtime.module';

@Global()
@Module({
  imports: [DatabaseModule, KafkaIngestRuntimeModule],
  providers: [
    TraceRepository,
    TraceService,
    LogStreamRepository,
    LogStreamService,
    AgentTraceRepository,
    AgentConversationRepository,
    AgentTraceService,
    LogIngestService,
    EventIngestService,
    AgentTraceIngestService,
  ],
  exports: [
    TraceService,
    TraceRepository,
    LogStreamRepository,
    LogStreamService,
    AgentTraceRepository,
    AgentTraceService,
    AgentConversationRepository,
  ],
})
export class TraceModule {}
