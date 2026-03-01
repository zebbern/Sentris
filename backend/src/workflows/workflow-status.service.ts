import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { status as grpcStatus, type ServiceError } from '@grpc/grpc-js';
import { WorkflowNotFoundError } from '@temporalio/client';
import { compileWorkflowGraph } from '../dsl/compiler';
import { WorkflowDefinition } from '../dsl/types';
import { WorkflowGraphSchema } from './dto/workflow-graph.dto';
import {
  TemporalService,
  type WorkflowRunStatus as TemporalWorkflowRunStatus,
} from '../temporal/temporal.service';
import { WorkflowRecord, WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { TraceRepository } from '../trace/trace.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  ExecutionStatus,
  FailureSummary,
  WorkflowRunStatusPayload,
  TraceEventPayload,
  ExecutionTriggerType,
  ExecutionInputPreview,
  TERMINAL_STATUSES,
} from '@sentris/shared';
import type { WorkflowRunRecord, WorkflowVersionRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  organizationId: string;
  workflowVersionId: string | null;
  workflowVersion: number | null;
  status: ExecutionStatus;
  startTime: Date;
  endTime?: Date | null;
  temporalRunId?: string;
  workflowName: string;
  eventCount: number;
  nodeCount: number;
  duration: number;
  triggerType: ExecutionTriggerType;
  triggerSource?: string | null;
  triggerLabel?: string | null;
  inputPreview: ExecutionInputPreview;
  parentRunId?: string | null;
  parentNodeRef?: string | null;
}

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
  targetsBySource: Map<string, { targetRef: string; sourceHandle: string; inputKey: string }[]>;
}

@Injectable()
export class WorkflowStatusService {
  private readonly logger = new Logger(WorkflowStatusService.name);
  private readonly flowContexts = new Map<string, FlowContext>();

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly versionRepository: WorkflowVersionRepository,
    private readonly runRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
    private readonly temporalService: TemporalService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private resolveOrganizationId(auth?: AuthContext | null): string | null {
    return auth?.organizationId ?? null;
  }

  private requireOrganizationId(auth?: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) throw new ForbiddenException('Organization context is required');
    return organizationId;
  }

  private async requireRunAccess(runId: string, auth?: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) throw new NotFoundException(`Workflow run ${runId} not found`);
    return { organizationId, run };
  }

  // ── Public methods ────────────────────────────────────────────────────────

  async getRunStatus(
    runId: string,
    temporalRunId?: string,
    auth?: AuthContext | null,
  ): Promise<WorkflowRunStatusPayload> {
    this.logger.log(
      `Fetching status for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const { organizationId, run } = await this.requireRunAccess(runId, auth);

    let temporalStatus: Awaited<ReturnType<typeof this.temporalService.describeWorkflow>>;
    let completedActions = 0;
    let failedActions = 0;
    let startedActions = 0;
    let statusPayload: WorkflowRunStatusPayload;

    if (run.status && (TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      if (run.totalActions && run.totalActions > 0) {
        completedActions = await this.traceRepository.countByType(
          runId,
          'NODE_COMPLETED',
          organizationId,
        );
      }
      statusPayload = {
        runId,
        workflowId: run.workflowId,
        status: run.status as ExecutionStatus,
        startedAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt ? new Date(run.updatedAt).toISOString() : new Date().toISOString(),
        completedAt: run.closeTime?.toISOString() ?? undefined,
        taskQueue: '',
        historyLength: 0,
        progress:
          run.totalActions && run.totalActions > 0
            ? {
                completedActions: Math.min(completedActions, run.totalActions),
                totalActions: run.totalActions,
              }
            : undefined,
      };
    } else {
      if (run.totalActions && run.totalActions > 0) {
        [completedActions, failedActions, startedActions] = await Promise.all([
          this.traceRepository.countByType(runId, 'NODE_COMPLETED', organizationId),
          this.traceRepository.countByType(runId, 'NODE_FAILED', organizationId),
          this.traceRepository.countByType(runId, 'NODE_STARTED', organizationId),
        ]);
      }
      try {
        temporalStatus = await this.temporalService.describeWorkflow({
          workflowId: runId,
          runId: temporalRunId,
        });
        const normalizedStatus = this.normalizeStatus(temporalStatus.status);
        if ((TERMINAL_STATUSES as readonly string[]).includes(normalizedStatus)) {
          this.runRepository
            .cacheTerminalStatus(
              run.runId,
              normalizedStatus,
              temporalStatus.closeTime ? new Date(temporalStatus.closeTime) : undefined,
            )
            .catch((err) => this.logger.warn(`Failed to cache status for ${run.runId}: ${err}`));
        }
      } catch (error: unknown) {
        if (this.isNotFoundError(error)) {
          const inferredStatus = this.inferStatusFromTraceEvents({
            runId,
            totalActions: run.totalActions ?? 0,
            completedActions,
            failedActions,
            startedActions,
          });
          this.logger.log(
            `Workflow ${runId} not found in Temporal, inferred status: ${inferredStatus} (started=${startedActions}, completed=${completedActions}, failed=${failedActions}, total=${run.totalActions})`,
          );
          temporalStatus = {
            workflowId: runId,
            runId: temporalRunId ?? runId,
            status: inferredStatus as unknown as typeof temporalStatus.status,
            startTime: run.createdAt.toISOString(),
            closeTime: ['COMPLETED', 'FAILED'].includes(inferredStatus)
              ? new Date().toISOString()
              : undefined,
            historyLength: 0,
            taskQueue: '',
          };
        } else {
          throw error;
        }
      }
      statusPayload = this.mapTemporalStatus(runId, temporalStatus, run, completedActions);
      if (statusPayload.status === 'RUNNING') {
        const hasPendingInput = await this.runRepository.hasPendingInputs(runId);
        if (hasPendingInput) statusPayload.status = 'AWAITING_INPUT';
      }
    }

    if ((TERMINAL_STATUSES as readonly string[]).includes(statusPayload.status)) {
      const startTime = run.createdAt;
      const endTime = statusPayload.completedAt ? new Date(statusPayload.completedAt) : new Date();
      this.analyticsService.trackWorkflowCompleted({
        workflowId: run.workflowId,
        runId,
        organizationId,
        durationMs: endTime.getTime() - startTime.getTime(),
        nodeCount: run.totalActions ?? 0,
        success: statusPayload.status === 'COMPLETED',
        failureReason: statusPayload.failure?.reason,
      });
    }
    return statusPayload;
  }

  async getRun(runId: string, auth?: AuthContext | null): Promise<WorkflowRunSummary> {
    const organizationId = this.requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return this.buildRunSummary(run, organizationId);
  }

  async listRuns(
    auth?: AuthContext | null,
    options?: {
      limit?: number;
      offset?: number;
      workflowId?: string;
      status?: string;
      parentRunId?: string;
      onlyRoots?: boolean;
    },
  ) {
    const organizationId = this.requireOrganizationId(auth);
    const runs = await this.runRepository.list({
      organizationId,
      limit: options?.limit,
      offset: options?.offset,
      workflowId: options?.workflowId,
      status: options?.status,
      parentRunId: options?.parentRunId,
      onlyRoots: options?.onlyRoots,
    });
    return Promise.all(runs.map((run) => this.buildRunSummary(run, organizationId)));
  }

  async listChildRuns(
    parentRunId: string,
    auth?: AuthContext | null,
    options?: { limit?: number; offset?: number },
  ) {
    const { organizationId } = await this.requireRunAccess(parentRunId, auth);
    const childRuns = await this.runRepository.list({
      organizationId,
      parentRunId,
      limit: options?.limit,
      offset: options?.offset,
    });
    return Promise.all(childRuns.map((run) => this.buildRunSummary(run, organizationId)));
  }

  async buildRunSummary(
    run: WorkflowRunRecord,
    organizationId: string,
  ): Promise<WorkflowRunSummary> {
    const workflow = await this.repository.findById(run.workflowId, { organizationId });
    const [eventCount, version] = await Promise.all([
      this.traceRepository.countByRunId(run.runId, organizationId),
      run.workflowVersionId
        ? this.versionRepository.findById(run.workflowVersionId, { organizationId })
        : this.versionRepository.findLatestByWorkflowId(run.workflowId, { organizationId }),
    ]);
    const nodeCount = version ? ((version.graph as { nodes?: unknown[] })?.nodes?.length ?? 0) : 0;
    const status = (run.status as ExecutionStatus) ?? 'RUNNING';
    const endTime = run.closeTime ?? null;
    const duration = this.computeDuration(run.createdAt, endTime);
    const triggerType = (run.triggerType as ExecutionTriggerType) ?? 'manual';
    const inputPreview: ExecutionInputPreview = (run.inputPreview as ExecutionInputPreview) ?? {
      runtimeInputs: {},
      nodeOverrides: {},
    };
    return {
      id: run.runId,
      workflowId: run.workflowId,
      organizationId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      status,
      startTime: run.createdAt,
      endTime,
      temporalRunId: run.temporalRunId ?? undefined,
      workflowName: workflow?.name ?? 'Unknown',
      eventCount,
      nodeCount,
      duration,
      triggerType,
      triggerSource: run.triggerSource ?? null,
      triggerLabel: run.triggerLabel ?? null,
      inputPreview,
      parentRunId: run.parentRunId ?? null,
      parentNodeRef: run.parentNodeRef ?? null,
    };
  }

  async buildDataFlows(
    runId: string,
    events: TraceEventPayload[],
    options: { baseTimestamp?: number; latestTimestamp?: number } = {},
  ): Promise<DataFlowPacketDto[]> {
    if (!events || events.length === 0) return [];
    const context = await this.getFlowContext(runId);
    const packets: DataFlowPacketDto[] = [];
    let earliest = options.baseTimestamp ?? null;
    let latest = options.latestTimestamp ?? null;
    for (const event of events) {
      if (event.type !== 'COMPLETED' || !event.nodeId) continue;
      const targets = context.targetsBySource.get(event.nodeId);
      if (!targets || targets.length === 0) continue;
      const summary = event.outputSummary as Record<string, unknown> | undefined;
      if (!summary || Object.keys(summary).length === 0) continue;
      const timestamp = Date.parse(event.timestamp);
      if (Number.isNaN(timestamp)) continue;
      if (earliest === null || timestamp < earliest) earliest = timestamp;
      if (latest === null || timestamp > latest) latest = timestamp;
      let index = 0;
      for (const target of targets) {
        const payload = this.resolveMappingValue(summary, target.sourceHandle);
        if (payload === undefined) continue;
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
    if (packets.length === 0) return packets;
    packets.sort((a, b) => a.timestamp - b.timestamp);
    const base = options.baseTimestamp ?? earliest ?? packets[0].timestamp;
    const top = options.latestTimestamp ?? latest ?? packets[packets.length - 1].timestamp;
    const span = Math.max(1, top - base);
    packets.forEach((p) => {
      p.visualTime = (p.timestamp - base) / span;
    });
    return packets;
  }

  async releaseFlowContext(runId: string): Promise<void> {
    this.flowContexts.delete(runId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private computeDuration(start: Date, end?: Date | null): number {
    const endMs = end ? end.getTime() : Date.now();
    return Math.max(0, endMs - start.getTime());
  }

  private normalizeStatus(status: string): ExecutionStatus {
    switch (status) {
      case 'RUNNING':
        return 'RUNNING';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'FAILED':
        return 'FAILED';
      case 'CANCELED':
        return 'CANCELLED';
      case 'TERMINATED':
        return 'TERMINATED';
      case 'TIMED_OUT':
        return 'TIMED_OUT';
      case 'CONTINUED_AS_NEW':
        return 'RUNNING';
      default:
        this.logger.warn(`Unknown Temporal status '${status}', defaulting to RUNNING`);
        return 'RUNNING';
    }
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    if (error instanceof WorkflowNotFoundError) return true;
    return (error as ServiceError).code === grpcStatus.NOT_FOUND;
  }

  private inferStatusFromTraceEvents(params: {
    runId: string;
    totalActions: number;
    completedActions: number;
    failedActions: number;
    startedActions: number;
  }): ExecutionStatus {
    const { totalActions, completedActions, failedActions, startedActions } = params;
    if (startedActions === 0) return 'STALE';
    if (failedActions > 0) return 'FAILED';
    if (totalActions > 0 && completedActions >= totalActions) return 'COMPLETED';
    if (startedActions > 0 && completedActions < totalActions) return 'FAILED';
    return 'FAILED';
  }

  private mapTemporalStatus(
    requestedRunId: string,
    status: TemporalWorkflowRunStatus,
    metadata: { workflowId: string; totalActions: number } | null,
    completedActions: number,
  ): WorkflowRunStatusPayload {
    const normalizedStatus = this.normalizeStatus(status.status);
    const workflowId = metadata?.workflowId ?? requestedRunId;
    const totalActions = metadata?.totalActions ?? 0;
    const progress =
      totalActions > 0
        ? { completedActions: Math.min(completedActions, totalActions), totalActions }
        : undefined;
    return {
      runId: requestedRunId,
      workflowId,
      status: normalizedStatus,
      startedAt: status.startTime,
      updatedAt: new Date().toISOString(),
      completedAt: status.closeTime ?? undefined,
      taskQueue: status.taskQueue,
      historyLength: status.historyLength,
      progress,
      failure: this.buildFailure(normalizedStatus, status.failure),
    };
  }

  private buildFailure(status: ExecutionStatus, failure?: unknown): FailureSummary | undefined {
    if (!['FAILED', 'TERMINATED', 'TIMED_OUT'].includes(status)) return undefined;
    interface TemporalFailure {
      message?: string;
      stackTrace?: string;
      code?: string;
      applicationFailureInfo?: { type?: string; details?: unknown };
      timeoutFailureInfo?: { timeoutType?: string };
      terminatedFailureInfo?: { reason?: string };
      serverFailureInfo?: { nonRetryable?: boolean };
    }
    const f = failure as TemporalFailure | null | undefined;
    if (!f) return { reason: `Workflow run ended with status ${status}` };
    const reason = f.message ?? `Workflow run ended with status ${status}`;
    const temporalCode =
      f.applicationFailureInfo?.type ??
      f.timeoutFailureInfo?.timeoutType ??
      f.terminatedFailureInfo?.reason ??
      f.serverFailureInfo?.nonRetryable?.toString() ??
      f.code;
    const details: Record<string, unknown> = {};
    if (f.stackTrace) details.stackTrace = f.stackTrace;
    if (f.applicationFailureInfo?.details)
      details.applicationFailureDetails = f.applicationFailureInfo.details;
    return { reason, temporalCode, details: Object.keys(details).length > 0 ? details : undefined };
  }

  private async getFlowContext(runId: string): Promise<FlowContext> {
    const cached = this.flowContexts.get(runId);
    if (cached) return cached;
    const run = await this.runRepository.findByRunId(runId);
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    const organizationId = run.organizationId ?? null;
    const workflow = await this.repository.findById(run.workflowId, { organizationId });
    if (!workflow)
      throw new NotFoundException(`Workflow ${run.workflowId} not found for run ${runId}`);
    const version = run.workflowVersionId
      ? await this.versionRepository.findById(run.workflowVersionId, { organizationId })
      : await this.versionRepository.findLatestByWorkflowId(run.workflowId, { organizationId });
    if (!version)
      throw new NotFoundException(
        `Workflow version not found for run ${runId} (workflow=${run.workflowId})`,
      );
    const definition = await this.ensureDefinitionForVersion(workflow, version, organizationId);
    const targetsBySource = this.buildTargetsIndex(definition);
    const context: FlowContext = {
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      definition,
      targetsBySource,
    };
    this.flowContexts.set(runId, context);
    return context;
  }

  private async ensureDefinitionForVersion(
    workflow: WorkflowRecord,
    version: WorkflowVersionRecord,
    organizationId: string | null,
  ): Promise<WorkflowDefinition> {
    if (version.compiledDefinition) {
      const definition = version.compiledDefinition as WorkflowDefinition;
      const entryAction = definition.actions.find(
        (a) => a.componentId === 'core.workflow.entrypoint',
      );
      if (
        entryAction &&
        (!definition.entrypoint || definition.entrypoint.ref !== entryAction.ref)
      ) {
        const patched: WorkflowDefinition = { ...definition, entrypoint: { ref: entryAction.ref } };
        await this.versionRepository.setCompiledDefinition(version.id, patched, {
          organizationId: organizationId ?? undefined,
        });
        return patched;
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

  private buildTargetsIndex(definition: WorkflowDefinition): FlowContext['targetsBySource'] {
    const map = new Map<string, { targetRef: string; sourceHandle: string; inputKey: string }[]>();
    for (const action of definition.actions) {
      for (const [inputKey, mapping] of Object.entries(action.inputMappings ?? {})) {
        const list = map.get(mapping.sourceRef) ?? [];
        list.push({ targetRef: action.ref, sourceHandle: mapping.sourceHandle, inputKey });
        map.set(mapping.sourceRef, list);
      }
    }
    return map;
  }

  private resolveMappingValue(
    sourceOutput: Record<string, unknown> | undefined,
    sourceHandle: string,
  ): unknown {
    if (!sourceOutput) return undefined;
    if (sourceHandle === '__self__') return sourceOutput;
    if (Object.prototype.hasOwnProperty.call(sourceOutput, sourceHandle))
      return sourceOutput[sourceHandle];
    return undefined;
  }

  private inferPayloadType(value: unknown): 'file' | 'json' | 'text' | 'binary' {
    if (typeof value === 'string') return 'text';
    if (value && typeof value === 'object') return 'json';
    if (typeof value === 'number' || typeof value === 'boolean') return 'json';
    return 'binary';
  }

  private estimatePayloadSize(value: unknown): number {
    try {
      if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
      if (typeof value === 'number' || typeof value === 'boolean')
        return Buffer.byteLength(String(value), 'utf8');
      if (value && typeof value === 'object')
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch (error: unknown) {
      this.logger.warn(`Failed to estimate payload size: ${error}`);
    }
    return 0;
  }
}
