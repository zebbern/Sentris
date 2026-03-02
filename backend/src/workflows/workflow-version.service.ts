import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';

import { compileWorkflowGraph } from '../dsl/compiler';
import { WorkflowDefinition } from '../dsl/types';
import { WorkflowGraphSchema } from './dto/workflow-graph.dto';
import { WorkflowRecord, WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { AuditLogService } from '../audit/audit-log.service';
import type { WorkflowVersionRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';

/** Subset of WorkflowRunRequest that version resolution needs. */
export interface VersionResolveRequest {
  versionId?: string;
  version?: number;
}

@Injectable()
export class WorkflowVersionService {
  private readonly logger = new Logger(WorkflowVersionService.name);

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly roleRepository: WorkflowRoleRepository,
    private readonly versionRepository: WorkflowVersionRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Auth helpers (same pattern as WorkflowTagsService) ──────────────────

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

  // ── Public API ──────────────────────────────────────────────────────────

  async commit(id: string, auth?: AuthContext | null): Promise<WorkflowDefinition> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const workflow = await this.repository.findById(id, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }

    const version = await this.versionRepository.findLatestByWorkflowId(id, {
      organizationId,
    });
    if (!version) {
      throw new NotFoundException(`No versions recorded for workflow ${id}`);
    }

    this.logger.log(`Compiling workflow ${workflow.id} version ${version.version}`);
    const graph = WorkflowGraphSchema.parse(version.graph);
    const definition = compileWorkflowGraph(graph);
    await this.repository.saveCompiledDefinition(id, definition, { organizationId });
    await this.versionRepository.setCompiledDefinition(version.id, definition, {
      organizationId,
    });
    this.logger.log(
      `Compiled workflow ${workflow.id} version ${version.version} with ${definition.actions.length} action(s); entrypoint=${definition.entrypoint.ref}`,
    );
    this.auditLogService.record(auth ?? null, {
      action: 'workflow.commit',
      resourceType: 'workflow',
      resourceId: workflow.id,
      resourceName: workflow.name,
      metadata: {
        version: version.version,
        actionCount: definition.actions.length,
        entrypoint: definition.entrypoint.ref,
      },
    });
    return definition;
  }

  async listVersions(workflowId: string, auth?: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const workflow = await this.repository.findById(workflowId, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }
    const versions = await this.versionRepository.findAllByWorkflowId(workflowId, {
      organizationId,
    });
    return versions.map((v) => ({
      id: v.id,
      workflowId: v.workflowId,
      version: v.version,
      createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : v.createdAt,
    }));
  }

  async getWorkflowVersion(workflowId: string, versionId: string, auth?: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const version = await this.versionRepository.findById(versionId, { organizationId });
    if (!version || version.workflowId !== workflowId) {
      throw new NotFoundException(
        `Workflow version ${versionId} not found for workflow ${workflowId}`,
      );
    }

    return {
      id: version.id,
      workflowId: version.workflowId,
      version: version.version,
      graph: version.graph,
      createdAt:
        version.createdAt instanceof Date ? version.createdAt.toISOString() : version.createdAt,
    };
  }

  async resolveWorkflowVersion(
    workflowId: string,
    request: VersionResolveRequest,
    organizationId: string | null,
  ): Promise<WorkflowVersionRecord> {
    if (request.versionId) {
      const version = await this.versionRepository.findById(request.versionId, {
        organizationId: organizationId ?? undefined,
      });
      if (!version || version.workflowId !== workflowId) {
        throw new NotFoundException(
          `Workflow ${workflowId} version ${request.versionId} not found`,
        );
      }
      return version;
    }

    if (request.version) {
      const version = await this.versionRepository.findByWorkflowAndVersion({
        workflowId,
        version: request.version,
        organizationId,
      });
      if (!version) {
        throw new NotFoundException(`Workflow ${workflowId} version ${request.version} not found`);
      }
      return version;
    }

    const latest = await this.versionRepository.findLatestByWorkflowId(workflowId, {
      organizationId: organizationId ?? undefined,
    });
    if (!latest) {
      throw new NotFoundException(`No versions recorded for workflow ${workflowId}`);
    }
    return latest;
  }

  async ensureDefinitionForVersion(
    workflow: WorkflowRecord,
    version: WorkflowVersionRecord,
    organizationId: string | null,
  ): Promise<WorkflowDefinition> {
    if (version.compiledDefinition) {
      const definition = version.compiledDefinition as WorkflowDefinition;
      const entryAction = definition.actions.find(
        (action) => action.componentId === 'core.workflow.entrypoint',
      );

      if (
        entryAction &&
        (!definition.entrypoint || definition.entrypoint.ref !== entryAction.ref)
      ) {
        const patchedDefinition: WorkflowDefinition = {
          ...definition,
          entrypoint: { ref: entryAction.ref },
        };

        await this.versionRepository.setCompiledDefinition(version.id, patchedDefinition, {
          organizationId: organizationId ?? undefined,
        });

        return patchedDefinition;
      }

      return definition;
    }

    this.logger.log(`Compiling workflow ${workflow.id} version ${version.version} for execution`);
    const graph = WorkflowGraphSchema.parse(version.graph);
    const definition = compileWorkflowGraph(graph);

    await this.versionRepository.setCompiledDefinition(version.id, definition, {
      organizationId: organizationId ?? undefined,
    });

    return definition;
  }
}
