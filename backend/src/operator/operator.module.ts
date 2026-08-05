import { Module } from '@nestjs/common';

import { InternalOnlyGuard } from '../auth/internal-only.guard';
import { AnalyticsModule } from '../analytics/analytics.module';
import { FindingTriageModule } from '../findings/finding-triage.module';
import { McpRuntimeModule } from '../mcp-runtime/mcp-runtime.module';
import { McpServersModule } from '../mcp-servers/mcp-servers.module';
import { SecretsModule } from '../secrets/secrets.module';
import { StorageModule } from '../storage/storage.module';
import { TemplatesModule } from '../templates/templates.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InternalOperatorController } from './internal-operator.controller';
import { OperatorActivityStreamService } from './operator-activity-stream.service';
import { OperatorCommandService } from './operator-command.service';
import { OperatorController } from './operator.controller';
import { OperatorMcpAuthorityService } from './operator-mcp-authority.service';
import { OperatorRepository } from './operator.repository';
import { OperatorRunFollowUpListener } from './operator-run-follow-up.listener';
import { OperatorSessionStreamService } from './operator-session-stream.service';
import { OperatorService } from './operator.service';
import { OperatorWorkflowAuthoringService } from './operator-workflow-authoring.service';

@Module({
  imports: [
    AnalyticsModule,
    FindingTriageModule,
    McpRuntimeModule,
    McpServersModule,
    SecretsModule,
    StorageModule,
    TemplatesModule,
    WorkflowsModule,
  ],
  controllers: [InternalOperatorController, OperatorController],
  providers: [
    OperatorService,
    OperatorActivityStreamService,
    OperatorCommandService,
    OperatorMcpAuthorityService,
    OperatorRunFollowUpListener,
    OperatorSessionStreamService,
    OperatorWorkflowAuthoringService,
    OperatorRepository,
    InternalOnlyGuard,
  ],
  exports: [OperatorService],
})
export class OperatorModule {}
