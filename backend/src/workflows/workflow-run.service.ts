import { randomUUID, createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import '@sentris/worker/components';
import { componentRegistry } from '@sentris/component-sdk';
import { WorkflowDefinition } from '../dsl/types';
import { TemporalService } from '../temporal/temporal.service';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionService } from './workflow-version.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditLogService } from '../audit/audit-log.service';
import {
  ExecutionStatus,
  WorkflowRunConfigPayload,
  ExecutionTriggerType,
  ExecutionInputPreview,
  ExecutionTriggerMetadata,
} from '@sentris/shared';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { AuthContext } from '../auth/types';

export interface WorkflowRunRequest {
  inputs?: Record<string, unknown>;
  versionId?: string;
  version?: number;
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
}

const SENTRIS_WORKFLOW_TYPE = 'sentrisWorkflowRun';

@Injectable()
export class WorkflowRunService {
  private readonly logger = new Logger(WorkflowRunService.name);

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runRepository: WorkflowRunRepository,
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
    this.auditLogService.record(auth ?? null, {
      action: 'workflow.run',
      resourceType: 'workflow',
      resourceId: prepared.workflowId,
      resourceName: null,
      metadata: {
        runId: prepared.runId,
        workflowVersion: prepared.workflowVersion,
        triggerType: options.trigger?.type ?? null,
        triggerSourceId: options.trigger?.sourceId ?? null,
        triggerLabel: options.trigger?.label ?? null,
      },
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
      return {
        runId: existingRecord.runId,
        workflowId: existingRecord.workflowId,
        workflowVersionId: existingRecord.workflowVersionId ?? prepared.workflowVersionId,
        workflowVersion: existingRecord.workflowVersion ?? prepared.workflowVersion,
        temporalRunId: existingRecord.temporalRunId,
        status: 'RUNNING',
        taskQueue: this.temporalService.getDefaultTaskQueue(),
      };
    }
    await this.repository.incrementRunCount(prepared.workflowId, {
      organizationId: prepared.organizationId,
    });
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
          },
        ],
      });
      temporalRunId = temporalRun.runId;
      this.logger.log(
        `Started workflow run ${prepared.runId} (workflowVersion=${prepared.workflowVersion}, temporalRunId=${temporalRun.runId}, taskQueue=${temporalRun.taskQueue}, actions=${prepared.totalActions})`,
      );
      await this.runRepository.upsert({
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        temporalRunId: temporalRun.runId,
        totalActions: prepared.totalActions,
        inputs: prepared.inputs,
        organizationId: prepared.organizationId,
        triggerType: prepared.triggerMetadata.type,
        triggerSource: prepared.triggerMetadata.sourceId,
        triggerLabel: prepared.triggerMetadata.label,
        inputPreview: prepared.inputPreview,
      });
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
          return {
            runId: existing.runId,
            workflowId: existing.workflowId,
            workflowVersionId: existing.workflowVersionId ?? prepared.workflowVersionId,
            workflowVersion: existing.workflowVersion ?? prepared.workflowVersion,
            temporalRunId: existing.temporalRunId,
            status: 'RUNNING',
            taskQueue: this.temporalService.getDefaultTaskQueue(),
          };
        }
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to start workflow ${prepared.workflowId} run ${prepared.runId}: ${errorMessage}`,
      );
      if (error instanceof Error && error.stack) this.logger.error(`Stack trace: ${error.stack}`);
      throw error;
    }
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
    definitionWithOverrides = {
      ...definitionWithOverrides,
      actions: definitionWithOverrides.actions.map((action) => {
        const component = componentRegistry.get(action.componentId);
        if (component?.retryPolicy) return { ...action, retryPolicy: component.retryPolicy };
        return action;
      }),
    };
    const normalizedKey = this.normalizeIdempotencyKey(options.idempotencyKey);
    const runId =
      options.runId ??
      (normalizedKey ? this.runIdFromIdempotencyKey(normalizedKey) : `sentris-run-${randomUUID()}`);
    const triggerMetadata = options.trigger ?? this.buildEntryPointTriggerMetadata(auth);
    const inputs = request.inputs ?? {};
    const inputPreview = this.buildInputPreview(inputs, nodeOverrides);
    await this.runRepository.upsert({
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
    });
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
    };
  }

  async getRunResult(runId: string, temporalRunId?: string, auth?: AuthContext | null) {
    this.logger.log(
      `Fetching result for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const { run } = await this.requireRunAccess(runId, auth);
    const cachedStatus = run.status as string | undefined;
    const nonResultStatuses = new Set(['TERMINATED', 'CANCELLED', 'TIMED_OUT']);
    if (cachedStatus && nonResultStatuses.has(cachedStatus))
      return { status: cachedStatus, result: null };
    try {
      return await this.temporalService.getWorkflowResult({
        workflowId: runId,
        runId: temporalRunId,
      });
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.constructor.name : '';
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorName === 'WorkflowFailedError' ||
        errorMessage.includes('terminated') ||
        errorMessage.includes('cancelled') ||
        errorMessage.includes('timed out')
      ) {
        this.logger.warn(`Workflow run ${runId} ended without a result: ${errorMessage}`);
        return { status: 'TERMINATED', result: null };
      }
      throw error;
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
    await this.requireRunAccess(runId, auth);
    await this.temporalService.cancelWorkflow({ workflowId: runId, runId: temporalRunId });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private normalizeIdempotencyKey(key?: string | null): string | undefined {
    if (!key) return undefined;
    const trimmed = key.trim();
    return trimmed ? trimmed.slice(0, 128) : undefined;
  }

  private runIdFromIdempotencyKey(key: string): string {
    return `sentris-run-${createHash('sha256').update(key).digest('hex')}`;
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
