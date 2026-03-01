import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { compileWorkflowGraph } from '../dsl/compiler';
import '@sentris/worker/components';
import { componentRegistry, extractPorts } from '@sentris/component-sdk';
import { WorkflowDefinition } from '../dsl/types';
import {
  WorkflowGraphDto,
  WorkflowGraphSchema,
  WorkflowNodeSchema,
  WorkflowNodeDataSchema,
  ServiceWorkflowResponse,
  UpdateWorkflowMetadataDto,
} from './dto/workflow-graph.dto';
import { WorkflowRecord, WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { AuditLogService } from '../audit/audit-log.service';
import type { WorkflowVersionRecord, WorkflowGraph } from '../database/schema';
import type { AuthContext } from '../auth/types';

export interface WorkflowSummaryResponse {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  lastRun: string | null;
  latestRunStatus: string | null;
  runCount: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WorkflowCrudService {
  private readonly logger = new Logger(WorkflowCrudService.name);

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly roleRepository: WorkflowRoleRepository,
    private readonly versionRepository: WorkflowVersionRepository,
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

  private ensureOrganizationAdmin(auth?: AuthContext | null): void {
    if (!auth?.roles || !auth.roles.includes('ADMIN')) {
      this.logger.warn(
        `Access denied - User: ${auth?.userId || 'none'}, Roles: ${JSON.stringify(auth?.roles ?? [])}`,
      );
      throw new ForbiddenException('Administrator role required');
    }
  }

  private async requireWorkflowAdmin(
    workflowId: string,
    auth?: AuthContext | null,
  ): Promise<string> {
    const organizationId = this.requireOrganizationId(auth);
    if (auth?.roles?.includes('ADMIN')) return organizationId;
    if (!auth?.userId) throw new ForbiddenException('Administrator role required');
    const hasRole = await this.roleRepository.hasRole({
      workflowId,
      userId: auth.userId,
      role: 'ADMIN',
      organizationId,
    });
    if (!hasRole) throw new ForbiddenException('Administrator role required');
    return organizationId;
  }

  async ensureWorkflowAdminAccess(workflowId: string, auth?: AuthContext | null): Promise<string> {
    return this.requireWorkflowAdmin(workflowId, auth);
  }

  async create(
    dto: WorkflowGraphDto,
    auth?: AuthContext | null,
    options?: { skipValidation?: boolean },
  ): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);
    if (!options?.skipValidation) {
      try {
        compileWorkflowGraph(input);
      } catch (error: unknown) {
        if (error instanceof Error)
          throw new BadRequestException(`Workflow validation failed: ${error.message}`);
        throw error;
      }
    }
    this.ensureOrganizationAdmin(auth);
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.create(input, { organizationId });
    let version: WorkflowVersionRecord;
    try {
      version = await this.versionRepository.create({
        workflowId: record.id,
        graph: input,
        organizationId,
      });
      if (auth?.userId) {
        await this.roleRepository.upsert({
          workflowId: record.id,
          userId: auth.userId,
          role: 'ADMIN',
          organizationId,
        });
      }
    } catch (error: unknown) {
      await this.repository.delete(record.id, { organizationId });
      throw error;
    }
    const response = this.buildWorkflowResponse(record, version);
    this.logger.log(
      `Created workflow ${response.id} v${version.version} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
    );
    this.auditLogService.record(auth ?? null, {
      action: 'workflow.create',
      resourceType: 'workflow',
      resourceId: response.id,
      resourceName: response.name,
      metadata: {
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        version: version.version,
      },
    });
    return response;
  }

  async update(
    id: string,
    dto: WorkflowGraphDto,
    auth?: AuthContext | null,
  ): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);
    try {
      compileWorkflowGraph(input);
    } catch (error: unknown) {
      if (error instanceof Error)
        throw new BadRequestException(`Workflow validation failed: ${error.message}`);
      throw error;
    }
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const record = await this.repository.update(id, input, { organizationId });
    const version = await this.versionRepository.create({
      workflowId: record.id,
      graph: input,
      organizationId,
    });
    const response = this.buildWorkflowResponse(record, version);
    this.logger.log(
      `Updated workflow ${response.id} to v${version.version} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
    );
    this.auditLogService.record(auth ?? null, {
      action: 'workflow.update',
      resourceType: 'workflow',
      resourceId: response.id,
      resourceName: response.name,
      metadata: {
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        version: version.version,
      },
    });
    return response;
  }

  async updateMetadata(
    id: string,
    dto: UpdateWorkflowMetadataDto,
    auth?: AuthContext | null,
  ): Promise<ServiceWorkflowResponse> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const record = await this.repository.updateMetadata(
      id,
      { name: dto.name, description: dto.description ?? null },
      { organizationId },
    );
    const version = await this.versionRepository.findLatestByWorkflowId(id, { organizationId });
    const response = this.buildWorkflowResponse(record, version ?? null);
    this.logger.log(`Updated workflow ${response.id} metadata (name=${dto.name})`);
    this.auditLogService.record(auth ?? null, {
      action: 'workflow.update_metadata',
      resourceType: 'workflow',
      resourceId: response.id,
      resourceName: response.name,
      metadata: { name: dto.name },
    });
    return response;
  }

  async findById(id: string, auth?: AuthContext | null): Promise<ServiceWorkflowResponse> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findById(id, { organizationId });
    if (!record) throw new NotFoundException(`Workflow ${id} not found`);
    const version = await this.versionRepository.findLatestByWorkflowId(id, { organizationId });
    return this.buildWorkflowResponse(record, version ?? null);
  }

  async delete(id: string, auth?: AuthContext | null): Promise<void> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const existing = await this.repository.findById(id, { organizationId }).catch(() => null);
    await this.repository.delete(id, { organizationId });
    this.logger.log(`Deleted workflow ${id}`);
    this.auditLogService.record(auth ?? null, {
      action: 'workflow.delete',
      resourceType: 'workflow',
      resourceId: id,
      resourceName: existing?.name ?? null,
    });
  }

  async list(auth?: AuthContext | null): Promise<ServiceWorkflowResponse[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.list({ organizationId });
    const versions = await Promise.all(
      records.map((r) => this.versionRepository.findLatestByWorkflowId(r.id, { organizationId })),
    );
    const responses = records.map((r, i) => this.buildWorkflowResponse(r, versions[i] ?? null));
    this.logger.log(`Loaded ${responses.length} workflow(s) from repository`);
    return responses;
  }

  async listSummary(auth?: AuthContext | null): Promise<WorkflowSummaryResponse[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listSummary({ organizationId });
    return records.map((r) => ({
      ...r,
      lastRun: r.lastRun?.toISOString() ?? null,
      latestRunStatus: r.latestRunStatus ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listVersions(workflowId: string, auth?: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const workflow = await this.repository.findById(workflowId, { organizationId });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);
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

  async commit(id: string, auth?: AuthContext | null): Promise<WorkflowDefinition> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const workflow = await this.repository.findById(id, { organizationId });
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
    const version = await this.versionRepository.findLatestByWorkflowId(id, { organizationId });
    if (!version) throw new NotFoundException(`No versions recorded for workflow ${id}`);
    this.logger.log(`Compiling workflow ${workflow.id} version ${version.version}`);
    const graph = WorkflowGraphSchema.parse(version.graph);
    const definition = compileWorkflowGraph(graph);
    await this.repository.saveCompiledDefinition(id, definition, { organizationId });
    await this.versionRepository.setCompiledDefinition(version.id, definition, { organizationId });
    this.logger.log(
      `Compiled workflow ${workflow.id} v${version.version} with ${definition.actions.length} action(s); entrypoint=${definition.entrypoint.ref}`,
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

  // ── Private helpers ───────────────────────────────────────────────────────

  private parse(dto: WorkflowGraphDto): WorkflowGraph {
    const parsed = WorkflowGraphSchema.parse(dto);
    return this.resolveGraphPorts(parsed);
  }

  private buildWorkflowResponse(
    record: WorkflowRecord,
    version?: WorkflowVersionRecord | null,
  ): ServiceWorkflowResponse {
    const resolvedGraph = this.resolveGraphPorts(record.graph);
    return {
      ...record,
      graph: resolvedGraph,
      currentVersionId: version?.id ?? null,
      currentVersion: version?.version ?? null,
    };
  }

  private resolveGraphPorts(graph: WorkflowGraph): WorkflowGraph {
    if (!graph || !Array.isArray(graph.nodes)) return graph;
    return { ...graph, nodes: graph.nodes.map((node) => this.resolveNodePorts(node)) };
  }

  private resolveNodePorts(
    node: z.infer<typeof WorkflowNodeSchema>,
  ): z.infer<typeof WorkflowNodeSchema> {
    const nodeData = node.data;
    const componentId = this.extractComponentId(node, nodeData);
    if (!componentId) return node;
    try {
      const entry = componentRegistry.getMetadata(componentId);
      if (!entry) return node;
      const component = entry.definition;
      const baseInputs = entry.inputs ?? extractPorts(component.inputs);
      const baseOutputs = entry.outputs ?? extractPorts(component.outputs);
      const params = this.extractNodeParams(nodeData);
      if (typeof component.resolvePorts === 'function') {
        try {
          const resolved = component.resolvePorts(params);
          return {
            ...node,
            data: {
              ...nodeData,
              dynamicInputs: resolved.inputs ? extractPorts(resolved.inputs) : baseInputs,
              dynamicOutputs: resolved.outputs ? extractPorts(resolved.outputs) : baseOutputs,
            },
          };
        } catch (resolveError) {
          this.logger.warn(`Failed to resolve ports for component ${componentId}: ${resolveError}`);
          return {
            ...node,
            data: { ...nodeData, dynamicInputs: baseInputs, dynamicOutputs: baseOutputs },
          };
        }
      }
      return {
        ...node,
        data: { ...nodeData, dynamicInputs: baseInputs, dynamicOutputs: baseOutputs },
      };
    } catch (error: unknown) {
      this.logger.warn(`Failed to get component ${componentId} for port resolution: ${error}`);
      return node;
    }
  }

  private extractNodeParams(
    nodeData: z.infer<typeof WorkflowNodeDataSchema>,
  ): Record<string, unknown> {
    if (nodeData.config?.params && Object.keys(nodeData.config.params).length > 0)
      return nodeData.config.params;
    const ext = nodeData as Record<string, unknown>;
    if (ext.parameters && typeof ext.parameters === 'object')
      return ext.parameters as Record<string, unknown>;
    if (
      nodeData.config &&
      !('params' in nodeData.config) &&
      !('inputOverrides' in nodeData.config) &&
      typeof nodeData.config === 'object'
    ) {
      return nodeData.config as Record<string, unknown>;
    }
    return {};
  }

  private extractComponentId(
    node: z.infer<typeof WorkflowNodeSchema>,
    nodeData: z.infer<typeof WorkflowNodeDataSchema>,
  ): string | null {
    if (node.type && node.type !== 'workflow') return node.type;
    const ext = nodeData as Record<string, unknown>;
    if (typeof ext.componentId === 'string') return ext.componentId;
    if (typeof ext.componentSlug === 'string') return ext.componentSlug;
    return null;
  }
}
