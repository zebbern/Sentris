import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthInfo } from '@modelcontextprotocol/server';

import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { parseRunMcpRequestContext, type RunMcpRequestContext } from './run-mcp-request-context';

@Injectable()
export class RunMcpScopeResolver {
  constructor(
    @Inject(WorkflowRunRepository)
    private readonly workflowRunRepository: WorkflowRunRepository,
  ) {}

  async resolve(authInfo: AuthInfo): Promise<RunMcpRequestContext> {
    const context = parseRunMcpRequestContext(authInfo.extra);
    const run = await this.workflowRunRepository.findByRunId(context.runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${context.runId} not found`);
    }
    if (run.organizationId !== context.organizationId) {
      throw new ForbiddenException(`You do not have access to workflow run ${context.runId}`);
    }
    return context;
  }
}
