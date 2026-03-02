import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';

import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { WorkflowTagsRepository } from './repository/workflow-tags.repository';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';

@Injectable()
export class WorkflowTagsService {
  private readonly logger = new Logger(WorkflowTagsService.name);

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly roleRepository: WorkflowRoleRepository,
    private readonly tagsRepository: WorkflowTagsRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  private resolveOrganizationId(auth?: AuthContext | null): string | null {
    return auth?.organizationId ?? null;
  }

  private requireOrganizationId(auth?: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }

  private async requireWorkflowAdmin(
    workflowId: string,
    auth?: AuthContext | null,
  ): Promise<string> {
    const organizationId = this.requireOrganizationId(auth);
    if (auth?.roles?.includes('ADMIN')) {
      return organizationId;
    }

    if (!auth?.userId) {
      throw new ForbiddenException('Administrator role required');
    }

    const hasRole = await this.roleRepository.hasRole({
      workflowId,
      userId: auth.userId,
      role: 'ADMIN',
      organizationId,
    });

    if (!hasRole) {
      throw new ForbiddenException('Administrator role required');
    }

    return organizationId;
  }

  async setWorkflowTags(
    auth: AuthContext | null,
    workflowId: string,
    tags: string[],
  ): Promise<{ tags: string[] }> {
    const organizationId = await this.requireWorkflowAdmin(workflowId, auth);

    // Verify workflow exists
    const workflow = await this.repository.findById(workflowId, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const oldTags = await this.tagsRepository.getTagsByWorkflowId(workflowId);
    const newTags = await this.tagsRepository.setTags(workflowId, tags);

    this.auditLogService.record(auth ?? null, {
      action: 'workflow.tags.updated',
      resourceType: 'workflow',
      resourceId: workflowId,
      resourceName: workflow.name,
      metadata: { oldTags, newTags },
    });

    this.logger.log(`Updated tags for workflow ${workflowId}: [${newTags.join(', ')}]`);
    return { tags: newTags };
  }

  async getWorkflowTags(auth: AuthContext | null, workflowId: string): Promise<{ tags: string[] }> {
    const organizationId = this.requireOrganizationId(auth);

    const workflow = await this.repository.findById(workflowId, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const tags = await this.tagsRepository.getTagsByWorkflowId(workflowId);
    return { tags };
  }

  async listAllTags(
    auth: AuthContext | null,
  ): Promise<{ tags: { name: string; count: number }[] }> {
    const organizationId = this.requireOrganizationId(auth);
    const tags = await this.tagsRepository.listAllTags(organizationId);
    return { tags };
  }
}
