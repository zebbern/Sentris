import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { WorkflowsModule } from '../workflows/workflows.module';
import { TraceModule } from '../trace/trace.module';
import { TemporalModule } from '../temporal/temporal.module';
import { AgentFollowUpService } from './agent-follow-up.service';
import { AgentFollowUpsController } from './agent-follow-ups.controller';

@Module({
  imports: [WorkflowsModule, TraceModule, TemporalModule],
  controllers: [AgentsController, AgentFollowUpsController],
  providers: [AgentFollowUpService],
})
export class AgentsModule {}
