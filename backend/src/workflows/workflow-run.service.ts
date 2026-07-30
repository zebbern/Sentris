import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { status as grpcStatus, type ServiceError } from '@grpc/grpc-js';
import { WorkflowNotFoundError } from '@temporalio/client';
import '@sentris/worker/components';
import { componentRegistry } from '@sentris/component-sdk';
import { WorkflowDefinition } from '../dsl/types';
import {
  TemporalService,
  type WorkflowRunStatus as TemporalWorkflowRunStatus,
} from '../temporal/temporal.service';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { WorkflowVersionService } from './workflow-version.service';
import { TraceRepository } from '../trace/trace.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditLogService } from '../audit/audit-log.service';
import {
  ExecutionStatus,
  EXECUTION_STATUS,
  FailureSummary,
  WorkflowRunStatusPayload,
  WorkflowRunConfigPayload,
  ExecutionTriggerType,
  ExecutionInputPreview,
  ExecutionTriggerMetadata,
  TERMINAL_STATUSES,
} from '@sentris/shared';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { AuthContext } from '../auth/types';
import type { WorkflowRunRecord } from '../database/schema';
import type { FinalizeRunRequestDto, ReportableTerminalStatus } from './dto/run-finalization.dto';

export interface WorkflowRunRequest {
  inputs?: Record<string, unknown>;
  versionId?: string;
  version?: number;
  scopeId?: string;
}

export interface WorkflowRunHandle {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  temporalRunId: string;
  status: ExecutionStatus;
  taskQueue: string;
}

export interface PreparedRunPayload {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  organizationId: string;
  definition: WorkflowDefinition;
  inputs: Record<string, unknown>;
  triggerMetadata: ExecutionTriggerMetadata;
  inputPreview: ExecutionInputPreview;
  totalActions: number;
  scopeId?: string | null;
}

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
  scopeId: string | null;
}

const SENTRIS_WORKFLOW_TYPE = 'sentrisWorkflowRun';

@Injectable()
export class WorkflowRunService {
  private readonly logger = new Logger(WorkflowRunService.name);

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runRepository: WorkflowRunRepository,
    private readonly versionRepository: WorkflowVersionRepository,
    private readonly traceRepository: TraceRepository,
    private readonly temporalService: TemporalService,
    private readonly analyticsService: AnalyticsService,
    private readonly auditLogService: AuditLogService,
    private readonly workflowVersionService: WorkflowVersionService,
  ) {}

  private async requireRunAccess(runId: string, auth?: AuthContext | null) {
    const organizationId = requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) throw new NotFoundException(`Workflow run ${runId} not found`);
    return { organizationId, run };
  }

  async resolveRunForAccess(runId: string, auth?: AuthContext | null) {
    return this.requireRunAccess(runId, auth);
  }

  async resolveRunWithoutAuth(runId: string) {
    const run = await this.runRepository.findByRunId(runId);
    if (!run) throw new NotFoundException(`Workflow run ${runId} not found`);
    return { organizationId: run.organizationId ?? null, run };
  }

  async ensureRunAccess(runId: string, auth?: AuthContext | null): Promise<void> {
    await this.requireRunAccess(runId, auth);
  }

  async finalizeRun(
    runId: string,
    input: FinalizeRunRequestDto,
    auth?: AuthContext | null,
  ): Promise<{
    runId: string;
    status: ReportableTerminalStatus;
    completedAt: string;
    duplicate: boolean;
  }> {
    const organizationId = requireOrganizationId(auth);
    const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
    const finalized = await this.runRepository.finalizeTerminalRun({
      runId,
      organizationId,
      status: input.status,
      completedAt,
    });
    if (!finalized) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    return {
      runId,
      status: finalized.record.status as ReportableTerminalStatus,
      completedAt: (finalized.record.closeTime ?? completedAt).toISOString(),
      duplicate: finalized.duplicate,
    };
  }

  async getCompiledWorkflowContext(
    workflowId: string,
    request: WorkflowRunRequest = {},
    auth?: AuthContext | null,
  ) {
    const organizationId = requireOrganizationId(auth);
    const workflow = await this.repository.findById(workflowId, { organizationId });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);
    const version = await this.workflowVersionService.resolveWorkflowVersion(
      workflowId,
      request,
      organizationId,
    );
    const definition = await this.workflowVersionService.ensureDefinitionForVersion(
      workflow,
      version,
      organizationId,
    );
    return { workflow, version, definition, organizationId };
  }

  async run(
    id: string,
    request: WorkflowRunRequest = {},
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
  ): Promise<WorkflowRunHandle> {
    const prepared = await this.prepareRunPayload(id, request, auth, {
      trigger: options.trigger,
      nodeOverrides: options.nodeOverrides,
      runId: options.runId,
      idempotencyKey: options.idempotencyKey,
    });
    return this.startPreparedRun(prepared);
  }

  async startPreparedRun(prepared: PreparedRunPayload): Promise<WorkflowRunHandle> {
    const inputSummary = this.formatInputSummary(prepared.inputs);
    this.logger.log(
      `Starting workflow ${prepared.workflowId} (runId=${prepared.runId}, inputs=${inputSummary})`,
    );
    const existingRecord = await this.runRepository.findByRunId(prepared.runId, {
      organizationId: prepared.organizationId,
    });
    if (existingRecord?.temporalRunId) {
      this.logger.log(
        `Run ${prepared.runId} already started (temporalRunId=${existingRecord.temporalRunId})`,
      );
      return this.buildStartedRunHandle(
        existingRecord,
        prepared,
        existingRecord.temporalRunId,
        this.temporalService.getDefaultTaskQueue(),
      );
    }
    let temporalRunId: string | null = null;
    try {
      const temporalRun = await this.temporalService.startWorkflow({
        workflowType: SENTRIS_WORKFLOW_TYPE,
        workflowId: prepared.runId,
        args: [
          {
            runId: prepared.runId,
            workflowId: prepared.workflowId,
            definition: prepared.definition,
            inputs: prepared.inputs,
            workflowVersionId: prepared.workflowVersionId,
            workflowVersion: prepared.workflowVersion,
            organizationId: prepared.organizationId,
            scopeId: prepared.scopeId ?? null,
          },
        ],
      });
      temporalRunId = temporalRun.runId;
      this.logger.log(
        `Started workflow run ${prepared.runId} (workflowVersion=${prepared.workflowVersion}, temporalRunId=${temporalRun.runId}, taskQueue=${temporalRun.taskQueue}, actions=${prepared.totalActions})`,
      );
      await this.persistStartedRun(prepared, temporalRun.runId);
      return {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        temporalRunId: temporalRun.runId,
        status: 'RUNNING',
        taskQueue: temporalRun.taskQueue,
      };
    } catch (error: unknown) {
      if (temporalRunId) {
        this.logger.warn(
          `Temporal workflow ${prepared.runId} reported error after start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (error instanceof Error && error.message.includes('Workflow execution already started')) {
        const existing = await this.runRepository.findByRunId(prepared.runId, {
          organizationId: prepared.organizationId,
        });
        if (existing?.temporalRunId) {
          this.logger.warn(
            `Workflow run ${prepared.runId} already active (temporalRunId=${existing.temporalRunId})`,
          );
          return this.buildStartedRunHandle(
            existing,
            prepared,
            existing.temporalRunId,
            this.temporalService.getDefaultTaskQueue(),
          );
        }

        const recovered = await this.temporalService.describeWorkflow({
          workflowId: prepared.runId,
        });
        await this.persistStartedRun(prepared, recovered.runId);
        const recoveredStatus = this.normalizeStatus(recovered.status);
        await this.finalizeTemporalTerminalStatus({
          runId: prepared.runId,
          organizationId: prepared.organizationId,
          status: recoveredStatus,
          closeTime: recovered.closeTime,
        });
        this.logger.warn(
          `Recovered workflow run ${prepared.runId} after its Temporal start was not persisted (temporalRunId=${recovered.runId})`,
        );
        return {
          runId: prepared.runId,
          workflowId: prepared.workflowId,
          workflowVersionId: prepared.workflowVersionId,
          workflowVersion: prepared.workflowVersion,
          temporalRunId: recovered.runId,
          status: recoveredStatus,
          taskQueue: recovered.taskQueue,
        };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to start workflow ${prepared.workflowId} run ${prepared.runId}: ${errorMessage}`,
      );
      if (error instanceof Error && error.stack) this.logger.error(`Stack trace: ${error.stack}`);
      throw error;
    }
  }

  async markRunStarted(
    runId: string,
    temporalRunId: string,
    auth?: AuthContext | null,
  ): Promise<{
    runId: string;
    workflowId: string;
    temporalRunId: string;
    duplicate: boolean;
  }> {
    const organizationId = requireOrganizationId(auth);
    const prepared = await this.runRepository.findByRunId(runId, { organizationId });
    if (!prepared) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    const result = await this.persistStartedRun(
      {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        organizationId,
      },
      temporalRunId,
    );

    return {
      runId: result.record.runId,
      workflowId: result.record.workflowId,
      temporalRunId,
      duplicate: !result.transitioned,
    };
  }

  async prepareRunPayload(
    id: string,
    request: WorkflowRunRequest = {},
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
  ): Promise<PreparedRunPayload> {
    const organizationId = requireOrganizationId(auth);
    const workflow = await this.repository.findById(id, { organizationId });
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
    const scopeId = request.scopeId ?? null;
    if (
      scopeId &&
      !(await this.runRepository.scopeBelongsToOrganization(scopeId, organizationId))
    ) {
      throw new NotFoundException(`Scope ${scopeId} not found`);
    }
    const version = await this.workflowVersionService.resolveWorkflowVersion(
      workflow.id,
      request,
      organizationId,
    );
    const compiledDefinition = await this.workflowVersionService.ensureDefinitionForVersion(
      workflow,
      version,
      organizationId,
    );
    const nodeOverrides = options.nodeOverrides ?? {};
    let definitionWithOverrides = this.applyNodeOverrides(compiledDefinition, nodeOverrides);
    definitionWithOverrides = this.applyComponentRetryPolicies(definitionWithOverrides);
    const normalizedKey = this.normalizeIdempotencyKey(options.idempotencyKey);
    const runId =
      options.runId ??
      (normalizedKey
        ? this.runIdFromIdempotencyKey(organizationId, workflow.id, normalizedKey)
        : `sentris-run-${randomUUID()}`);
    const triggerMetadata = options.trigger ?? this.buildEntryPointTriggerMetadata(auth);
    const inputs = request.inputs ?? {};
    const inputPreview = this.buildInputPreview(inputs, nodeOverrides);
    const preparation = await this.runRepository.prepare(
      {
        runId,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        workflowVersion: version.version,
        totalActions: definitionWithOverrides.actions.length,
        inputs,
        organizationId,
        triggerType: triggerMetadata.type,
        triggerSource: triggerMetadata.sourceId,
        triggerLabel: triggerMetadata.label,
        inputPreview,
        parentRunId: options.parentRunId,
        parentNodeRef: options.parentNodeRef,
        scopeId,
      },
      async (executor) => {
        await this.auditLogService.recordDurableWithExecutor(
          executor,
          auth ?? null,
          {
            action: 'workflow.run',
            resourceType: 'workflow',
            resourceId: workflow.id,
            resourceName: null,
            metadata: {
              runId,
              workflowVersion: version.version,
              triggerType: triggerMetadata.type,
              triggerSourceId: triggerMetadata.sourceId,
              triggerLabel: triggerMetadata.label,
              phase: 'requested',
            },
          },
          undefined,
          organizationId,
        );
      },
    );
    if (preparation.created) {
      this.analyticsService.trackWorkflowStarted({
        workflowId: workflow.id,
        workflowVersionId: version.id,
        workflowVersion: version.version,
        runId,
        organizationId,
        nodeCount: compiledDefinition.actions.length,
        inputCount: Object.keys(request.inputs ?? {}).length,
        triggerType: triggerMetadata.type,
        triggerSource: triggerMetadata.sourceId ?? undefined,
        triggerLabel: triggerMetadata.label ?? undefined,
      });
    }
    return {
      runId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      organizationId,
      definition: definitionWithOverrides,
      inputs,
      triggerMetadata,
      inputPreview,
      totalActions: definitionWithOverrides.actions.length,
      scopeId,
    };
  }

  private applyComponentRetryPolicies(definition: WorkflowDefinition): WorkflowDefinition {
    const applyPolicies = (actions: WorkflowDefinition['actions']) =>
      actions.map((action) => {
        const component = componentRegistry.get(action.componentId);
        if (component?.retryPolicy) return { ...action, retryPolicy: component.retryPolicy };
        return action;
      });

    const loopBodies = Object.fromEntries(
      Object.entries(definition.loopBodies ?? {}).map(([ref, body]) => [
        ref,
        {
          ...body,
          definition: {
            ...body.definition,
            actions: applyPolicies(body.definition.actions),
          },
        },
      ]),
    );

    return {
      ...definition,
      actions: applyPolicies(definition.actions),
      loopBodies,
    };
  }

  async getRunResult(runId: string, temporalRunId?: string, auth?: AuthContext | null) {
    this.logger.log(
      `Fetching result for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const { organizationId, run } = await this.requireRunAccess(runId, auth);
    const cachedStatus = this.toResultlessTerminalStatus(run.status);
    if (cachedStatus) return { status: cachedStatus, result: null };
    try {
      return await this.temporalService.getWorkflowResult({
        workflowId: runId,
        runId: temporalRunId,
      });
    } catch (error: unknown) {
      if (!this.isTerminalWorkflowResultError(error)) throw error;
      return this.reconcileResultlessTerminalStatus({
        runId,
        temporalRunId,
        organizationId,
        resultError: error,
      });
    }
  }

  async getRunConfig(runId: string, auth?: AuthContext | null): Promise<WorkflowRunConfigPayload> {
    const { run } = await this.requireRunAccess(runId, auth);
    return {
      runId: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      inputs: run.inputs ?? {},
    };
  }

  async cancelRun(runId: string, temporalRunId?: string, auth?: AuthContext | null): Promise<void> {
    this.logger.warn(
      `Cancelling workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const { run } = await this.requireRunAccess(runId, auth);
    await this.auditLogService.recordDurable(auth ?? null, {
      action: 'workflow_run.cancel',
      resourceType: 'workflow',
      resourceId: runId,
      resourceName: run.workflowId,
      metadata: {
        temporalRunId: temporalRunId ?? null,
        phase: 'requested',
      },
    });
    await this.temporalService.cancelWorkflow({ workflowId: runId, runId: temporalRunId });
  }

  // ── Run queries ────────────────────────────────────────────────────────

  async listRuns(
    auth?: AuthContext | null,
    options: {
      workflowId?: string;
      status?: ExecutionStatus;
      limit?: number;
      offset?: number;
      scopeId?: string;
    } = {},
  ) {
    const organizationId = requireOrganizationId(auth);
    const runs = await this.runRepository.list({
      ...options,
      organizationId,
    });
    const summaries = await this.buildRunSummariesBatch(runs, organizationId);
    summaries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    this.logger.log(`Loaded ${summaries.length} workflow run(s) for timeline`);
    return { runs: summaries };
  }

  async listChildRuns(
    parentRunId: string,
    auth?: AuthContext | null,
    options: { limit?: number } = {},
  ): Promise<{
    runs: {
      runId: string;
      workflowId: string;
      workflowName: string;
      parentNodeRef: string | null;
      status: ExecutionStatus;
      startedAt: string;
      completedAt?: string;
    }[];
  }> {
    const { organizationId } = await this.requireRunAccess(parentRunId, auth);
    const children = await this.runRepository.listChildren(parentRunId, {
      organizationId,
      limit: options.limit,
    });
    const summaries = await this.buildRunSummariesBatch(children, organizationId);
    const runs = summaries.map((summary, index) => ({
      runId: summary.id,
      workflowId: summary.workflowId,
      workflowName: summary.workflowName,
      parentNodeRef: children[index]?.parentNodeRef ?? null,
      status: summary.status,
      startedAt: new Date(summary.startTime).toISOString(),
      completedAt: summary.endTime ? new Date(summary.endTime).toISOString() : undefined,
    }));
    return { runs };
  }

  async getRun(runId: string, auth?: AuthContext | null): Promise<WorkflowRunSummary> {
    const organizationId = requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    return this.buildRunSummary(run, organizationId);
  }

  async getRunStatus(
    runId: string,
    temporalRunId?: string,
    auth?: AuthContext | null,
  ): Promise<WorkflowRunStatusPayload> {
    this.logger.log(
      `Fetching status for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const { organizationId, run } = await this.requireRunAccess(runId, auth);
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

      let temporalStatus: TemporalWorkflowRunStatus;
      try {
        temporalStatus = await this.temporalService.describeWorkflow({
          workflowId: runId,
          runId: temporalRunId,
        });
        const normalizedStatus = this.normalizeStatus(temporalStatus.status);
        await this.finalizeTemporalTerminalStatus({
          runId: run.runId,
          organizationId,
          status: normalizedStatus,
          closeTime: temporalStatus.closeTime,
        });
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
            `Workflow ${runId} not found in Temporal, inferred status: ${inferredStatus} ` +
              `(started=${startedActions}, completed=${completedActions}, failed=${failedActions}, total=${run.totalActions})`,
          );

          temporalStatus = {
            workflowId: runId,
            runId: temporalRunId ?? runId,
            status: inferredStatus as unknown as TemporalWorkflowRunStatus['status'],
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
        if (hasPendingInput) {
          statusPayload.status = 'AWAITING_INPUT';
        }
      }
    }

    if ((TERMINAL_STATUSES as readonly string[]).includes(statusPayload.status)) {
      const startTime = run.createdAt;
      const endTime = statusPayload.completedAt ? new Date(statusPayload.completedAt) : new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      this.analyticsService.trackWorkflowCompleted({
        workflowId: run.workflowId,
        runId,
        organizationId,
        durationMs,
        nodeCount: run.totalActions ?? 0,
        success: statusPayload.status === 'COMPLETED',
        failureReason: statusPayload.failure?.reason,
      });
    }

    return statusPayload;
  }

  // ── Run summary builders ──────────────────────────────────────────────

  private async resolveRunStatus(
    run: {
      runId: string;
      status: string | null;
      temporalRunId: string | null;
      closeTime: Date | null;
      totalActions: number | null;
    },
    traceCounts: { startedActions: number; completedActions: number; failedActions: number },
    nodeCount: number,
    organizationId: string,
  ): Promise<{ status: ExecutionStatus; closeTime: string | null }> {
    if (run.status && (TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      return {
        status: run.status as ExecutionStatus,
        closeTime: run.closeTime?.toISOString() ?? null,
      };
    }
    try {
      const desc = await this.temporalService.describeWorkflow({
        workflowId: run.runId,
        runId: run.temporalRunId ?? undefined,
      });
      const currentStatus = this.normalizeStatus(desc.status);
      await this.finalizeTemporalTerminalStatus({
        runId: run.runId,
        organizationId,
        status: currentStatus,
        closeTime: desc.closeTime,
      });
      return { status: currentStatus, closeTime: desc.closeTime ?? null };
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        const inferredStatus = this.inferStatusFromTraceEvents({
          runId: run.runId,
          totalActions: run.totalActions ?? nodeCount,
          ...traceCounts,
        });
        this.logger.log(
          `Run ${run.runId} not found in Temporal, inferred status: ${inferredStatus} ` +
            `(started=${traceCounts.startedActions}, completed=${traceCounts.completedActions}, failed=${traceCounts.failedActions})`,
        );
        return { status: inferredStatus, closeTime: null };
      }
      this.logger.warn(`Failed to get status for run ${run.runId}: ${error}`);
      return { status: 'RUNNING', closeTime: null };
    }
  }

  private buildSummaryRecord(
    run: WorkflowRunRecord,
    organizationId: string,
    resolved: {
      status: ExecutionStatus;
      closeTime: string | null;
      workflowName: string;
      nodeCount: number;
      startedActions: number;
      duration: number;
    },
  ): WorkflowRunSummary {
    const triggerType = (run.triggerType as ExecutionTriggerType) ?? 'manual';
    const triggerSource = run.triggerSource ?? null;
    const triggerLabel = run.triggerLabel ?? (triggerType === 'manual' ? 'Manual run' : null);
    const inputPreview: ExecutionInputPreview = run.inputPreview ?? {
      runtimeInputs: {},
      nodeOverrides: {},
    };
    return {
      id: run.runId,
      workflowId: run.workflowId,
      organizationId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      status: resolved.status,
      startTime: run.createdAt,
      endTime: resolved.closeTime
        ? new Date(resolved.closeTime)
        : (run.closeTime ?? run.updatedAt ?? null),
      temporalRunId: run.temporalRunId ?? undefined,
      workflowName: resolved.workflowName,
      eventCount: resolved.startedActions,
      nodeCount: resolved.nodeCount,
      duration: resolved.duration,
      triggerType,
      triggerSource,
      triggerLabel,
      inputPreview,
      parentRunId: run.parentRunId ?? null,
      parentNodeRef: run.parentNodeRef ?? null,
      scopeId: run.scopeId ?? null,
    };
  }

  private async buildRunSummariesBatch(
    runs: WorkflowRunRecord[],
    organizationId: string,
  ): Promise<WorkflowRunSummary[]> {
    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.runId);
    const workflowIds = [...new Set(runs.map((r) => r.workflowId))];
    const versionIds = [
      ...new Set(runs.map((r) => r.workflowVersionId).filter((id): id is string => id != null)),
    ];
    const workflowIdsNeedingLatest = [
      ...new Set(runs.filter((r) => !r.workflowVersionId).map((r) => r.workflowId)),
    ];

    const [
      workflows,
      versions,
      latestVersions,
      startedCounts,
      completedCounts,
      failedCounts,
      timeRanges,
    ] = await Promise.all([
      this.repository.findByIds(workflowIds, { organizationId }),
      this.versionRepository.findByIds(versionIds, { organizationId }),
      this.versionRepository.findLatestByWorkflowIds(workflowIdsNeedingLatest, { organizationId }),
      this.traceRepository.countByTypeForRuns(runIds, 'NODE_STARTED', organizationId),
      this.traceRepository.countByTypeForRuns(runIds, 'NODE_COMPLETED', organizationId),
      this.traceRepository.countByTypeForRuns(runIds, 'NODE_FAILED', organizationId),
      this.traceRepository.getEventTimeRangesForRuns(runIds, organizationId),
    ]);

    const workflowMap = new Map(workflows.map((w) => [w.id, w]));
    const versionMap = new Map(versions.map((v) => [v.id, v]));
    const latestVersionMap = new Map(latestVersions.map((v) => [v.workflowId, v]));

    return Promise.all(
      runs.map(async (run) => {
        const workflow = workflowMap.get(run.workflowId);
        const workflowName = workflow?.name ?? 'Unknown Workflow';
        const version = run.workflowVersionId
          ? versionMap.get(run.workflowVersionId)
          : workflow
            ? latestVersionMap.get(workflow.id)
            : undefined;
        const graph = (version?.graph ?? workflow?.graph) as { nodes?: unknown[] } | undefined;
        const nodeCount = graph?.nodes && Array.isArray(graph.nodes) ? graph.nodes.length : 0;

        const startedActions = startedCounts.get(run.runId) ?? 0;
        const completedActions = completedCounts.get(run.runId) ?? 0;
        const failedActions = failedCounts.get(run.runId) ?? 0;

        const eventTimeRange = timeRanges.get(run.runId) ?? {
          firstTimestamp: null,
          lastTimestamp: null,
        };
        const duration =
          eventTimeRange.firstTimestamp && eventTimeRange.lastTimestamp
            ? this.computeDuration(eventTimeRange.firstTimestamp, eventTimeRange.lastTimestamp)
            : this.computeDuration(run.createdAt, run.updatedAt);

        const { status, closeTime } = await this.resolveRunStatus(
          run,
          { startedActions, completedActions, failedActions },
          nodeCount,
          organizationId,
        );

        return this.buildSummaryRecord(run, organizationId, {
          status,
          closeTime,
          workflowName,
          nodeCount,
          startedActions,
          duration,
        });
      }),
    );
  }

  private async buildRunSummary(
    run: WorkflowRunRecord,
    organizationId: string,
  ): Promise<WorkflowRunSummary> {
    const [workflow, startedActions, completedActions, failedActions, eventTimeRange] =
      await Promise.all([
        this.repository.findById(run.workflowId, { organizationId }),
        this.traceRepository.countByType(run.runId, 'NODE_STARTED', organizationId),
        this.traceRepository.countByType(run.runId, 'NODE_COMPLETED', organizationId),
        this.traceRepository.countByType(run.runId, 'NODE_FAILED', organizationId),
        this.traceRepository.getEventTimeRange(run.runId, organizationId),
      ]);

    const workflowName = workflow?.name ?? 'Unknown Workflow';
    const version = run.workflowVersionId
      ? await this.versionRepository.findById(run.workflowVersionId, { organizationId })
      : workflow
        ? await this.versionRepository.findLatestByWorkflowId(workflow.id, { organizationId })
        : undefined;
    const graph = (version?.graph ?? workflow?.graph) as { nodes?: unknown[] } | undefined;
    const nodeCount = graph?.nodes && Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const duration =
      eventTimeRange.firstTimestamp && eventTimeRange.lastTimestamp
        ? this.computeDuration(eventTimeRange.firstTimestamp, eventTimeRange.lastTimestamp)
        : this.computeDuration(run.createdAt, run.updatedAt);

    const { status, closeTime } = await this.resolveRunStatus(
      run,
      { startedActions, completedActions, failedActions },
      nodeCount,
      organizationId,
    );

    return this.buildSummaryRecord(run, organizationId, {
      status,
      closeTime,
      workflowName,
      nodeCount,
      startedActions,
      duration,
    });
  }

  // ── Status helpers ────────────────────────────────────────────────────

  private computeDuration(start: Date, end?: Date | null): number {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) return 0;
    return Math.max(0, endTime - startTime);
  }

  private normalizeStatus(status: string): ExecutionStatus {
    switch (status) {
      case 'RUNNING':
        return 'RUNNING';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'FAILED':
        return 'FAILED';
      case 'CANCELLED':
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

  private async finalizeTemporalTerminalStatus(input: {
    runId: string;
    organizationId: string;
    status: ExecutionStatus;
    closeTime?: string;
  }): Promise<ReportableTerminalStatus | null> {
    const status = this.toReportableTerminalStatus(input.status);
    if (!status) return null;

    try {
      const result = await this.runRepository.finalizeTerminalRun({
        runId: input.runId,
        organizationId: input.organizationId,
        status,
        completedAt: input.closeTime ? new Date(input.closeTime) : new Date(),
      });
      if (!result) {
        this.logger.warn(`Terminal finalization found no tenant-owned run for ${input.runId}`);
        return null;
      }
      return this.toReportableTerminalStatus(result.record.status as ExecutionStatus);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to durably finalize status for ${input.runId}; reconciler will retry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private toReportableTerminalStatus(status: ExecutionStatus): ReportableTerminalStatus | null {
    switch (status) {
      case 'COMPLETED':
      case 'FAILED':
      case 'CANCELLED':
      case 'TERMINATED':
      case 'TIMED_OUT':
        return status;
      default:
        return null;
    }
  }

  private toResultlessTerminalStatus(status?: string | null): ReportableTerminalStatus | null {
    switch (status) {
      case 'FAILED':
      case 'CANCELLED':
      case 'TERMINATED':
      case 'TIMED_OUT':
        return status;
      default:
        return null;
    }
  }

  private isTerminalWorkflowResultError(error: unknown): boolean {
    const errorName = error instanceof Error ? error.constructor.name : '';
    const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
      errorName === 'WorkflowFailedError' ||
      errorMessage.includes('terminated') ||
      errorMessage.includes('cancelled') ||
      errorMessage.includes('canceled') ||
      errorMessage.includes('timed out')
    );
  }

  private async reconcileResultlessTerminalStatus(input: {
    runId: string;
    temporalRunId?: string;
    organizationId: string;
    resultError: unknown;
  }): Promise<{ status: ReportableTerminalStatus; result: null }> {
    const refreshedRun = await this.runRepository.findByRunId(input.runId, {
      organizationId: input.organizationId,
    });
    if (!refreshedRun) {
      throw new NotFoundException(`Workflow run ${input.runId} not found`);
    }

    const durableStatus = this.toResultlessTerminalStatus(refreshedRun.status);
    if (durableStatus) {
      return { status: durableStatus, result: null };
    }

    try {
      const described = await this.temporalService.describeWorkflow({
        workflowId: input.runId,
        runId: input.temporalRunId,
      });
      const describedStatus = this.toResultlessTerminalStatus(
        this.normalizeStatus(described.status),
      );
      if (!describedStatus) {
        throw input.resultError;
      }

      const durableResult = await this.finalizeTemporalTerminalStatus({
        runId: input.runId,
        organizationId: input.organizationId,
        status: describedStatus,
        closeTime: described.closeTime,
      });
      const reconciledStatus =
        durableResult === null ? describedStatus : this.toResultlessTerminalStatus(durableResult);
      if (!reconciledStatus) {
        throw input.resultError;
      }
      return { status: reconciledStatus, result: null };
    } catch (reconciliationError: unknown) {
      if (reconciliationError !== input.resultError) {
        this.logger.warn(
          `Failed to reconcile result status for ${input.runId}: ${
            reconciliationError instanceof Error
              ? reconciliationError.message
              : String(reconciliationError)
          }`,
        );
      }
      throw input.resultError;
    }
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    if (error instanceof WorkflowNotFoundError) return true;
    const serviceError = error as ServiceError;
    return serviceError.code === grpcStatus.NOT_FOUND;
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
    metadata: { workflowId: string; totalActions: number | null } | null,
    completedActions: number,
  ): WorkflowRunStatusPayload {
    const normalizedStatus = this.normalizeStatus(status.status);
    const completedAt = status.closeTime ?? undefined;
    const workflowId = metadata?.workflowId ?? requestedRunId;
    const totalActions = metadata?.totalActions ?? 0;
    const progress =
      totalActions > 0
        ? {
            completedActions: Math.min(completedActions, totalActions),
            totalActions,
          }
        : undefined;
    return {
      runId: requestedRunId,
      workflowId,
      status: normalizedStatus,
      startedAt: status.startTime,
      updatedAt: new Date().toISOString(),
      completedAt,
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
    const failureObj = failure as TemporalFailure | null | undefined;
    if (!failureObj) {
      return { reason: `Workflow run ended with status ${status}` };
    }
    const reason: string = failureObj.message ?? `Workflow run ended with status ${status}`;
    const temporalCode: string | undefined =
      failureObj.applicationFailureInfo?.type ??
      failureObj.timeoutFailureInfo?.timeoutType ??
      failureObj.terminatedFailureInfo?.reason ??
      failureObj.serverFailureInfo?.nonRetryable?.toString() ??
      failureObj.code;
    const details: Record<string, unknown> = {};
    if (failureObj.stackTrace) details.stackTrace = failureObj.stackTrace;
    if (failureObj.applicationFailureInfo?.details) {
      details.applicationFailureDetails = failureObj.applicationFailureInfo.details;
    }
    return {
      reason,
      temporalCode,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private normalizeIdempotencyKey(key?: string | null): string | undefined {
    if (!key) return undefined;
    const trimmed = key.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > 128) {
      throw new BadRequestException('Idempotency key must be at most 128 characters');
    }
    return trimmed;
  }

  private async persistStartedRun(
    prepared: Pick<PreparedRunPayload, 'runId' | 'workflowId' | 'organizationId'>,
    temporalRunId: string,
  ) {
    return this.runRepository.markStarted(
      {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        organizationId: prepared.organizationId,
        temporalRunId,
      },
      async (executor) => {
        await this.repository.incrementRunCount(prepared.workflowId, {
          organizationId: prepared.organizationId,
          executor,
        });
      },
    );
  }

  private buildStartedRunHandle(
    record: WorkflowRunRecord,
    prepared: PreparedRunPayload,
    temporalRunId: string,
    taskQueue: string,
  ): WorkflowRunHandle {
    const status =
      record.status && (EXECUTION_STATUS as readonly string[]).includes(record.status)
        ? (record.status as ExecutionStatus)
        : 'RUNNING';
    return {
      runId: record.runId,
      workflowId: record.workflowId,
      workflowVersionId: record.workflowVersionId ?? prepared.workflowVersionId,
      workflowVersion: record.workflowVersion ?? prepared.workflowVersion,
      temporalRunId,
      status,
      taskQueue,
    };
  }

  private runIdFromIdempotencyKey(organizationId: string, workflowId: string, key: string): string {
    const namespace = JSON.stringify([organizationId, workflowId, key]);
    return `sentris-run-${createHash('sha256').update(namespace).digest('hex')}`;
  }

  private applyNodeOverrides(
    definition: WorkflowDefinition,
    overrides?: Record<
      string,
      { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
    >,
  ): WorkflowDefinition {
    if (!overrides || Object.keys(overrides).length === 0) return definition;
    return {
      ...definition,
      actions: definition.actions.map((action) => {
        const o = overrides[action.ref];
        if (
          !o ||
          (Object.keys(o.params ?? {}).length === 0 &&
            Object.keys(o.inputOverrides ?? {}).length === 0)
        )
          return action;
        return {
          ...action,
          params: { ...(action.params ?? {}), ...(o.params ?? {}) },
          inputOverrides: { ...(action.inputOverrides ?? {}), ...(o.inputOverrides ?? {}) },
        };
      }),
    };
  }

  private formatInputSummary(inputs?: Record<string, unknown>): string {
    if (!inputs || Object.keys(inputs).length === 0) return 'none';
    return Object.entries(inputs)
      .map(([key, value]) => `${key}=${this.describeValue(value)}`)
      .join(', ');
  }

  private describeValue(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (Array.isArray(value)) return `array(len=${value.length})`;
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string')
      return value.length <= 48 ? value : `${value.slice(0, 48)}… (len=${value.length})`;
    return String(value);
  }

  private buildEntryPointTriggerMetadata(auth?: AuthContext | null): {
    type: ExecutionTriggerType;
    sourceId: string | null;
    label: string;
  } {
    const sourceId = auth?.userId ?? null;
    return {
      type: 'manual',
      sourceId,
      label: sourceId ? `Manual run by ${sourceId}` : 'Manual run',
    };
  }

  private buildInputPreview(
    inputs?: Record<string, unknown>,
    nodeOverrides?: Record<
      string,
      { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
    >,
  ): ExecutionInputPreview {
    const runtimeInputs = inputs ? { ...inputs } : {};
    const overrides: Record<
      string,
      { params: Record<string, unknown>; inputOverrides: Record<string, unknown> }
    > = {};
    if (nodeOverrides) {
      for (const [key, value] of Object.entries(nodeOverrides)) {
        overrides[key] = { params: value.params ?? {}, inputOverrides: value.inputOverrides ?? {} };
      }
    }
    return { runtimeInputs, nodeOverrides: overrides };
  }
}
