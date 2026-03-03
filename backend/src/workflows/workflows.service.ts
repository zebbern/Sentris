import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { z } from 'zod';

import { requireOrganizationId } from '../common/auth/require-organization-id';

import { compileWorkflowGraph } from '../dsl/compiler';
import '@sentris/worker/components';
import { componentRegistry, extractPorts } from '@sentris/component-sdk';
import { WorkflowDefinition } from '../dsl/types';
import { TemporalService } from '../temporal/temporal.service';
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
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { WorkflowTagsRepository } from './repository/workflow-tags.repository';
import { WorkflowVersionService } from './workflow-version.service';
import { WorkflowRunService } from './workflow-run.service';
import { AuditLogService } from '../audit/audit-log.service';
import { ExecutionStatus, TraceEventPayload, ExecutionTriggerMetadata } from '@sentris/shared';
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

// Re-export run-related types from WorkflowRunService for backward compatibility
export type {
  WorkflowRunRequest,
  WorkflowRunHandle,
  WorkflowRunSummary,
  PreparedRunPayload,
} from './workflow-run.service';

export interface DataFlowPacketDto {
  id: string;
  runId: string;
  sourceNode: string;
  targetNode: string;
  inputKey: string;
  payload: unknown;
  timestamp: number;
  visualTime: number;
  size: number;
  type: 'file' | 'json' | 'text' | 'binary';
}

interface FlowContext {
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  definition: WorkflowDefinition;
  targetsBySource: Map<
    string,
    {
      targetRef: string;
      sourceHandle: string;
      inputKey: string;
    }[]
  >;
}

const FLOW_CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FLOW_CONTEXT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class WorkflowsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowsService.name);
  private readonly flowContexts = new Map<string, FlowContext>();
  private readonly flowContextTimestamps = new Map<string, number>();
  private flowContextCleanupInterval!: NodeJS.Timeout;

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly roleRepository: WorkflowRoleRepository,
    private readonly versionRepository: WorkflowVersionRepository,
    private readonly runRepository: WorkflowRunRepository,
    private readonly temporalService: TemporalService,
    private readonly auditLogService: AuditLogService,
    private readonly tagsRepository: WorkflowTagsRepository,
    private readonly workflowVersionService: WorkflowVersionService,
    private readonly workflowRunService: WorkflowRunService,
  ) {}

  onModuleInit(): void {
    this.flowContextCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.flowContextTimestamps) {
        if (now - timestamp > FLOW_CONTEXT_TTL_MS) {
          this.flowContexts.delete(key);
          this.flowContextTimestamps.delete(key);
          this.logger.debug(`Evicted stale flow context for run ${key}`);
        }
      }
    }, FLOW_CONTEXT_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.flowContextCleanupInterval);
  }

  async ensureWorkflowAdminAccess(workflowId: string, auth?: AuthContext | null): Promise<string> {
    return this.requireWorkflowAdmin(workflowId, auth);
  }

  async getCompiledWorkflowContext(
    workflowId: string,
    request: { inputs?: Record<string, unknown>; versionId?: string; version?: number } = {},
    auth?: AuthContext | null,
  ) {
    return this.workflowRunService.getCompiledWorkflowContext(workflowId, request, auth);
  }

  private ensureOrganizationAdmin(auth?: AuthContext | null): void {
    this.logger.debug(
      `[WORKFLOWS] Checking org admin - Auth: ${auth ? 'present' : 'null'}, Roles: ${auth?.roles ? JSON.stringify(auth.roles) : 'none'}, User: ${auth?.userId || 'none'}, Org: ${auth?.organizationId || 'none'}`,
    );
    if (!auth?.roles || !auth.roles.includes('ADMIN')) {
      this.logger.warn(
        `[WORKFLOWS] Access denied - User: ${auth?.userId || 'none'}, Org: ${auth?.organizationId || 'none'}, Roles: ${auth?.roles ? JSON.stringify(auth.roles) : 'none'}`,
      );
      throw new ForbiddenException('Administrator role required');
    }
    this.logger.debug(`[WORKFLOWS] Org admin check passed for user: ${auth.userId}`);
  }

  private async requireWorkflowAdmin(
    workflowId: string,
    auth?: AuthContext | null,
  ): Promise<string> {
    const organizationId = requireOrganizationId(auth);
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

  async resolveRunForAccess(runId: string, auth?: AuthContext | null) {
    return this.workflowRunService.resolveRunForAccess(runId, auth);
  }

  async resolveRunWithoutAuth(runId: string) {
    return this.workflowRunService.resolveRunWithoutAuth(runId);
  }

  async ensureRunAccess(runId: string, auth?: AuthContext | null): Promise<void> {
    return this.workflowRunService.ensureRunAccess(runId, auth);
  }

  async create(
    dto: WorkflowGraphDto,
    auth?: AuthContext | null,
    options?: { skipValidation?: boolean },
  ): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);

    // Validate workflow graph before saving (including port connections)
    // Templates skip validation because they are blueprints with unfilled inputs
    if (!options?.skipValidation) {
      try {
        compileWorkflowGraph(input);
      } catch (error: unknown) {
        if (error instanceof Error) {
          throw new BadRequestException(`Workflow validation failed: ${error.message}`);
        }
        throw error;
      }
    }

    this.ensureOrganizationAdmin(auth);
    const organizationId = requireOrganizationId(auth);
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
      `Created workflow ${response.id} version ${version.version} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
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

    // Validate workflow graph before saving (including port connections)
    try {
      compileWorkflowGraph(input);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new BadRequestException(`Workflow validation failed: ${error.message}`);
      }
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
      `Updated workflow ${response.id} to version ${version.version} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
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
      metadata: {
        name: dto.name,
      },
    });
    return response;
  }

  async findById(id: string, auth?: AuthContext | null): Promise<ServiceWorkflowResponse> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.repository.findById(id, { organizationId });
    if (!record) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    const version = await this.versionRepository.findLatestByWorkflowId(id, { organizationId });
    return this.buildWorkflowResponse(record, version ?? null);
  }

  private buildWorkflowResponse(
    record: WorkflowRecord,
    version?: WorkflowVersionRecord | null,
  ): ServiceWorkflowResponse {
    // Resolve dynamic ports for the graph so Entry Point nodes show correct outputs
    const resolvedGraph = this.resolveGraphPorts(record.graph);

    return {
      ...record,
      graph: resolvedGraph,
      currentVersionId: version?.id ?? null,
      currentVersion: version?.version ?? null,
    };
  }

  /**
   * Extract component parameters from node data, handling legacy schema formats.
   * This handles the migration from old formats where params might be at:
   * - nodeData.config.params (current schema)
   * - nodeData.parameters (legacy)
   * - nodeData.config (legacy - when config was the params object directly)
   */
  private extractNodeParams(
    nodeData: z.infer<typeof WorkflowNodeDataSchema>,
  ): Record<string, unknown> {
    // Current schema: params are in config.params
    if (nodeData.config?.params && Object.keys(nodeData.config.params).length > 0) {
      return nodeData.config.params;
    }

    // Legacy: params stored directly on nodeData (via extended properties)
    const extendedNodeData = nodeData as Record<string, unknown>;
    if (extendedNodeData.parameters && typeof extendedNodeData.parameters === 'object') {
      return extendedNodeData.parameters as Record<string, unknown>;
    }

    // Legacy: config was the params object itself (before nested config.params structure)
    // Only use this if config doesn't have the modern structure
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

  /**
   * Extract component ID from node, handling frontend extensions.
   * The componentId might be in node.type or in extended nodeData properties.
   */
  private extractComponentId(
    node: z.infer<typeof WorkflowNodeSchema>,
    nodeData: z.infer<typeof WorkflowNodeDataSchema>,
  ): string | null {
    // In backend schema, node.type contains the component ID
    if (node.type && node.type !== 'workflow') {
      return node.type;
    }

    // Frontend extensions might store componentId/componentSlug in nodeData
    const extendedNodeData = nodeData as Record<string, unknown>;
    if (typeof extendedNodeData.componentId === 'string') {
      return extendedNodeData.componentId;
    }
    if (typeof extendedNodeData.componentSlug === 'string') {
      return extendedNodeData.componentSlug;
    }

    return null;
  }

  /**
   * Resolve dynamic ports for a single node based on its component and parameters.
   */
  private resolveNodePorts(
    node: z.infer<typeof WorkflowNodeSchema>,
  ): z.infer<typeof WorkflowNodeSchema> {
    const nodeData = node.data;
    const componentId = this.extractComponentId(node, nodeData);

    if (!componentId) {
      return node;
    }

    try {
      const entry = componentRegistry.getMetadata(componentId);
      if (!entry) {
        return node;
      }
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
            data: {
              ...nodeData,
              dynamicInputs: baseInputs,
              dynamicOutputs: baseOutputs,
            },
          };
        }
      } else {
        return {
          ...node,
          data: {
            ...nodeData,
            dynamicInputs: baseInputs,
            dynamicOutputs: baseOutputs,
          },
        };
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to get component ${componentId} for port resolution: ${error}`);
      return node;
    }
  }

  /**
   * Resolve dynamic ports for all nodes in a workflow graph.
   * This ensures Entry Point nodes and other components with resolvePorts
   * have their dynamicInputs/dynamicOutputs populated correctly.
   */
  private resolveGraphPorts(graph: WorkflowGraph): WorkflowGraph {
    if (!graph || !Array.isArray(graph.nodes)) {
      return graph;
    }

    return {
      ...graph,
      nodes: graph.nodes.map((node) => this.resolveNodePorts(node)),
    };
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

  async list(
    auth?: AuthContext | null,
    options?: { tags?: string[] },
  ): Promise<ServiceWorkflowResponse[]> {
    const organizationId = requireOrganizationId(auth);

    let filteredIds: string[] | undefined;
    if (options?.tags && options.tags.length > 0) {
      filteredIds = await this.tagsRepository.findWorkflowIdsByTags(options.tags, organizationId);
      if (filteredIds.length === 0) return [];
    }

    const records = await this.repository.list({ organizationId });
    const filtered = filteredIds ? records.filter((r) => filteredIds!.includes(r.id)) : records;

    const workflowIds = filtered.map((r) => r.id);
    const latestVersions = await this.versionRepository.findLatestByWorkflowIds(workflowIds, {
      organizationId,
    });
    const latestVersionsMap = new Map(latestVersions.map((v) => [v.workflowId, v]));
    const responses = filtered.map((record) =>
      this.buildWorkflowResponse(record, latestVersionsMap.get(record.id) ?? null),
    );
    this.logger.log(`Loaded ${responses.length} workflow(s) from repository`);
    return responses;
  }

  async listSummary(
    auth?: AuthContext | null,
    options?: { tags?: string[] },
  ): Promise<(WorkflowSummaryResponse & { tags: string[] })[]> {
    const organizationId = requireOrganizationId(auth);

    let filteredIds: string[] | undefined;
    if (options?.tags && options.tags.length > 0) {
      filteredIds = await this.tagsRepository.findWorkflowIdsByTags(options.tags, organizationId);
      if (filteredIds.length === 0) return [];
    }

    const records = await this.repository.listSummary({ organizationId });
    const filtered = filteredIds ? records.filter((r) => filteredIds!.includes(r.id)) : records;

    const workflowIds = filtered.map((r) => r.id);
    const tagsMap = await this.tagsRepository.getTagsByWorkflowIds(workflowIds);

    // raw SQL (db.execute) returns timestamps as strings, not Date objects;
    // normalise to ISO-8601 regardless of the runtime type.
    const toISO = (v: Date | string): string =>
      v instanceof Date ? v.toISOString() : new Date(v).toISOString();

    return filtered.map((record) => ({
      ...record,
      lastRun: record.lastRun ? toISO(record.lastRun) : null,
      latestRunStatus: record.latestRunStatus ?? null,
      createdAt: toISO(record.createdAt),
      updatedAt: toISO(record.updatedAt),
      tags: tagsMap.get(record.id) ?? [],
    }));
  }

  // ── Run operation delegations (→ WorkflowRunService) ────────────────

  async listRuns(
    auth?: AuthContext | null,
    options: {
      workflowId?: string;
      status?: ExecutionStatus;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    return this.workflowRunService.listRuns(auth, options);
  }

  async listChildRuns(
    parentRunId: string,
    auth?: AuthContext | null,
    options: { limit?: number } = {},
  ) {
    return this.workflowRunService.listChildRuns(parentRunId, auth, options);
  }

  async getRun(runId: string, auth?: AuthContext | null) {
    return this.workflowRunService.getRun(runId, auth);
  }

  async run(
    id: string,
    request: import('./workflow-run.service').WorkflowRunRequest = {},
    auth?: AuthContext | null,
    options: {
      trigger?: ExecutionTriggerMetadata;
      nodeOverrides?: Record<
        string,
        { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
      >;
      runId?: string;
      idempotencyKey?: string;
    } = {},
  ) {
    return this.workflowRunService.run(id, request, auth, options);
  }

  async startPreparedRun(prepared: import('./workflow-run.service').PreparedRunPayload) {
    return this.workflowRunService.startPreparedRun(prepared);
  }

  async prepareRunPayload(
    id: string,
    request: import('./workflow-run.service').WorkflowRunRequest = {},
    auth?: AuthContext | null,
    options: {
      trigger?: ExecutionTriggerMetadata;
      nodeOverrides?: Record<
        string,
        { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
      >;
      runId?: string;
      idempotencyKey?: string;
      parentRunId?: string;
      parentNodeRef?: string;
    } = {},
  ) {
    return this.workflowRunService.prepareRunPayload(id, request, auth, options);
  }

  async getRunStatus(runId: string, temporalRunId?: string, auth?: AuthContext | null) {
    return this.workflowRunService.getRunStatus(runId, temporalRunId, auth);
  }

  async getRunResult(runId: string, temporalRunId?: string, auth?: AuthContext | null) {
    return this.workflowRunService.getRunResult(runId, temporalRunId, auth);
  }

  async getRunConfig(runId: string, auth?: AuthContext | null) {
    return this.workflowRunService.getRunConfig(runId, auth);
  }

  async cancelRun(runId: string, temporalRunId?: string, auth?: AuthContext | null) {
    return this.workflowRunService.cancelRun(runId, temporalRunId, auth);
  }

  async buildDataFlows(
    runId: string,
    events: TraceEventPayload[],
    options: { baseTimestamp?: number; latestTimestamp?: number } = {},
  ): Promise<DataFlowPacketDto[]> {
    if (!events || events.length === 0) {
      return [];
    }

    const context = await this.getFlowContext(runId);
    const packets: DataFlowPacketDto[] = [];

    let earliest = options.baseTimestamp ?? null;
    let latest = options.latestTimestamp ?? null;

    for (const event of events) {
      if (event.type !== 'COMPLETED' || !event.nodeId) {
        continue;
      }

      const targets = context.targetsBySource.get(event.nodeId);
      if (!targets || targets.length === 0) {
        continue;
      }

      const summary = event.outputSummary as Record<string, unknown> | undefined;
      if (!summary || Object.keys(summary).length === 0) {
        continue;
      }

      const timestamp = Date.parse(event.timestamp);
      if (Number.isNaN(timestamp)) {
        continue;
      }

      if (earliest === null || timestamp < earliest) {
        earliest = timestamp;
      }
      if (latest === null || timestamp > latest) {
        latest = timestamp;
      }

      let index = 0;
      for (const target of targets) {
        const payload = this.resolveMappingValue(summary, target.sourceHandle);
        if (payload === undefined) {
          continue;
        }

        packets.push({
          id: `${runId}:${event.id ?? 'event'}:${target.targetRef}:${index++}`,
          runId,
          sourceNode: event.nodeId,
          targetNode: target.targetRef,
          inputKey: target.inputKey,
          payload,
          timestamp,
          size: this.estimatePayloadSize(payload),
          type: this.inferPayloadType(payload),
          visualTime: 0,
        });
      }
    }

    if (packets.length === 0) {
      return packets;
    }

    packets.sort((a, b) => a.timestamp - b.timestamp);

    const base = options.baseTimestamp ?? earliest ?? packets[0].timestamp;
    const top = options.latestTimestamp ?? latest ?? packets[packets.length - 1].timestamp;
    const span = Math.max(1, top - base);

    packets.forEach((packet) => {
      packet.visualTime = (packet.timestamp - base) / span;
    });

    return packets;
  }

  async releaseFlowContext(runId: string): Promise<void> {
    this.flowContexts.delete(runId);
    this.flowContextTimestamps.delete(runId);
  }

  private async getFlowContext(runId: string): Promise<FlowContext> {
    const cached = this.flowContexts.get(runId);
    if (cached) {
      return cached;
    }

    const run = await this.runRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    const organizationId = run.organizationId ?? null;

    const workflow = await this.repository.findById(run.workflowId, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${run.workflowId} not found for run ${runId}`);
    }

    const version = run.workflowVersionId
      ? await this.versionRepository.findById(run.workflowVersionId, { organizationId })
      : await this.versionRepository.findLatestByWorkflowId(run.workflowId, {
          organizationId,
        });
    if (!version) {
      throw new NotFoundException(
        `Workflow version not found for run ${runId} (workflow=${run.workflowId})`,
      );
    }

    const definition = await this.workflowVersionService.ensureDefinitionForVersion(
      workflow,
      version,
      organizationId,
    );
    const targetsBySource = this.buildTargetsIndex(definition);

    const context: FlowContext = {
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      definition,
      targetsBySource,
    };

    this.flowContexts.set(runId, context);
    this.flowContextTimestamps.set(runId, Date.now());
    return context;
  }

  private buildTargetsIndex(definition: WorkflowDefinition): FlowContext['targetsBySource'] {
    const map = new Map<string, { targetRef: string; sourceHandle: string; inputKey: string }[]>();

    for (const action of definition.actions) {
      const mappings = action.inputMappings ?? {};
      for (const [inputKey, mapping] of Object.entries(mappings)) {
        const list = map.get(mapping.sourceRef) ?? [];
        list.push({
          targetRef: action.ref,
          sourceHandle: mapping.sourceHandle,
          inputKey,
        });
        map.set(mapping.sourceRef, list);
      }
    }

    return map;
  }

  private resolveMappingValue(
    sourceOutput: Record<string, unknown> | undefined,
    sourceHandle: string,
  ): unknown {
    if (!sourceOutput) {
      return undefined;
    }

    if (sourceHandle === '__self__') {
      return sourceOutput;
    }

    if (Object.prototype.hasOwnProperty.call(sourceOutput, sourceHandle)) {
      return sourceOutput[sourceHandle];
    }

    return undefined;
  }

  private inferPayloadType(value: unknown): 'file' | 'json' | 'text' | 'binary' {
    if (typeof value === 'string') {
      return 'text';
    }
    if (value && typeof value === 'object') {
      return 'json';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return 'json';
    }
    return 'binary';
  }

  private estimatePayloadSize(value: unknown): number {
    try {
      if (typeof value === 'string') {
        return Buffer.byteLength(value, 'utf8');
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return Buffer.byteLength(String(value), 'utf8');
      }
      if (value && typeof value === 'object') {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to estimate payload size: ${error}`);
    }
    return 0;
  }

  private parse(dto: WorkflowGraphDto): WorkflowGraph {
    const parsed = WorkflowGraphSchema.parse(dto);

    // Resolve dynamic ports for all nodes using the shared helper
    return this.resolveGraphPorts(parsed);
  }
}
