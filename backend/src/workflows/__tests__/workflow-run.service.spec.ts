import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it, vi } from 'bun:test';

import { WorkflowRunService } from '../workflow-run.service';
import type { PreparedRunPayload } from '../workflow-run.service';
import type { WorkflowRepository } from '../repository/workflow.repository';
import type { WorkflowRunRepository } from '../repository/workflow-run.repository';
import type { WorkflowVersionRepository } from '../repository/workflow-version.repository';
import type { TraceRepository } from '../../trace/trace.repository';
import type { TemporalService } from '../../temporal/temporal.service';
import type { AnalyticsService } from '../../analytics/analytics.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { WorkflowVersionService } from '../workflow-version.service';
import type { AuthContext } from '../../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import { componentRegistry } from '@sentris/component-sdk';

// Save the original get method before any tests can modify it
const _originalRegistryGet = componentRegistry.get.bind(componentRegistry);

// ── Fixtures ────────────────────────────────────────────────────────
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const noOrgAuth: AuthContext = {
  userId: 'tester',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeWorkflowRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: null,
    graph: { name: 'Test Workflow', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    organizationId: DEFAULT_ORGANIZATION_ID,
    compiledDefinition: null,
    lastRun: null,
    runCount: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeVersionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-1',
    workflowId: 'wf-1',
    version: 1,
    graph: { name: 'Test Workflow', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    organizationId: DEFAULT_ORGANIZATION_ID,
    compiledDefinition: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDefinition() {
  return {
    actions: [
      {
        ref: 'action-1',
        componentId: 'comp-1',
        params: {},
        inputOverrides: {},
        dependsOn: [],
        inputMappings: {},
      },
    ],
  };
}

function makeRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'sentris-run-abc',
    workflowId: 'wf-1',
    workflowVersionId: 'ver-1',
    workflowVersion: 1,
    temporalRunId: 'temporal-abc',
    parentRunId: null,
    parentNodeRef: null,
    scopeId: null,
    totalActions: 1,
    inputs: {},
    organizationId: DEFAULT_ORGANIZATION_ID,
    status: 'RUNNING',
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    closeTime: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makePreparedPayload(overrides: Partial<PreparedRunPayload> = {}): PreparedRunPayload {
  return {
    runId: 'sentris-run-abc',
    workflowId: 'wf-1',
    workflowVersionId: 'ver-1',
    workflowVersion: 1,
    organizationId: DEFAULT_ORGANIZATION_ID,
    definition: makeDefinition() as any,
    inputs: {},
    triggerMetadata: { type: 'manual', sourceId: 'tester', label: 'Manual run by tester' },
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    totalActions: 1,
    ...overrides,
  };
}

class WorkflowFailedError extends Error {}

// ── Test suite ──────────────────────────────────────────────────────
describe('WorkflowRunService', () => {
  let workflowRepo: Record<string, ReturnType<typeof vi.fn>>;
  let runRepo: Record<string, ReturnType<typeof vi.fn>>;
  let versionRepo: Record<string, ReturnType<typeof vi.fn>>;
  let traceRepo: Record<string, ReturnType<typeof vi.fn>>;
  let temporalSvc: Record<string, ReturnType<typeof vi.fn>>;
  let analyticsSvc: Record<string, ReturnType<typeof vi.fn>>;
  let auditLogSvc: Record<string, ReturnType<typeof vi.fn>>;
  let versionSvc: Record<string, ReturnType<typeof vi.fn>>;
  let service: WorkflowRunService;

  afterAll(() => {
    // Restore the real componentRegistry.get so it doesn't leak to other test files
    componentRegistry.get = _originalRegistryGet;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    // Replace registry.get for this file's tests (no retry policy logic needed)
    componentRegistry.get = vi.fn().mockReturnValue(undefined) as any;
    workflowRepo = {
      findById: vi.fn(),
      incrementRunCount: vi.fn().mockResolvedValue(undefined),
    };
    runRepo = {
      findByRunId: vi.fn(),
      prepare: vi
        .fn()
        .mockImplementation(async (input: any, onPrepared?: (...args: any[]) => any) => {
          const record = makeRunRecord(input);
          await onPrepared?.({ insert: vi.fn() }, record);
          return { record, created: true };
        }),
      markStarted: vi
        .fn()
        .mockImplementation(
          async (input: any, onTransition?: (executor: any, record: any) => Promise<void>) => {
            const record = makeRunRecord(input);
            await onTransition?.({ update: vi.fn() }, record);
            return { record, transitioned: true };
          },
        ),
      finalizeTerminalRun: vi.fn().mockImplementation(async (input: any) => ({
        record: makeRunRecord({
          runId: input.runId,
          organizationId: input.organizationId,
          status: input.status,
          closeTime: input.completedAt,
        }),
        duplicate: false,
      })),
      scopeBelongsToOrganization: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
    };
    versionRepo = {
      findById: vi.fn().mockResolvedValue(makeVersionRecord()),
      findLatestByWorkflowId: vi.fn().mockResolvedValue(makeVersionRecord()),
    };
    traceRepo = {
      countByType: vi.fn().mockResolvedValue(0),
      getEventTimeRange: vi.fn().mockResolvedValue({ firstTimestamp: null, lastTimestamp: null }),
    };
    temporalSvc = {
      startWorkflow: vi.fn().mockResolvedValue({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
        taskQueue: 'test-queue',
      }),
      getWorkflowResult: vi.fn().mockResolvedValue({ status: 'COMPLETED', result: { ok: true } }),
      cancelWorkflow: vi.fn().mockResolvedValue(undefined),
      getDefaultTaskQueue: vi.fn().mockReturnValue('test-queue'),
      describeWorkflow: vi.fn().mockResolvedValue({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
        status: 'RUNNING',
        startTime: '2025-01-01T00:00:00.000Z',
        historyLength: 1,
        taskQueue: 'test-queue',
      }),
    };
    analyticsSvc = { trackWorkflowStarted: vi.fn() };
    auditLogSvc = {
      record: vi.fn(),
      recordDurable: vi.fn().mockResolvedValue(undefined),
      recordDurableWithExecutor: vi.fn().mockResolvedValue(undefined),
    };
    versionSvc = {
      resolveWorkflowVersion: vi.fn().mockResolvedValue(makeVersionRecord()),
      ensureDefinitionForVersion: vi.fn().mockResolvedValue(makeDefinition()),
    };
    service = new WorkflowRunService(
      workflowRepo as unknown as WorkflowRepository,
      runRepo as unknown as WorkflowRunRepository,
      versionRepo as unknown as WorkflowVersionRepository,
      traceRepo as unknown as TraceRepository,
      temporalSvc as unknown as TemporalService,
      analyticsSvc as unknown as AnalyticsService,
      auditLogSvc as unknown as AuditLogService,
      versionSvc as unknown as WorkflowVersionService,
    );
  });

  // ── resolveRunForAccess ─────────────────────────────────────────
  describe('resolveRunForAccess', () => {
    it('returns the run when it exists and org matches', async () => {
      const run = makeRunRecord();
      runRepo.findByRunId.mockResolvedValue(run);
      const result = await service.resolveRunForAccess('sentris-run-abc', authContext);
      expect(result.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
      expect(result.run).toEqual(run);
      expect(runRepo.findByRunId).toHaveBeenCalledWith('sentris-run-abc', {
        organizationId: DEFAULT_ORGANIZATION_ID,
      });
    });

    it('throws NotFoundException when the run does not exist', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);
      await expect(service.resolveRunForAccess('non-existent', authContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when auth has no org context', async () => {
      await expect(service.resolveRunForAccess('sentris-run-abc', noOrgAuth)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── resolveRunWithoutAuth ──────────────────────────────────────
  describe('resolveRunWithoutAuth', () => {
    it('returns the run without requiring organization context', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord());
      const result = await service.resolveRunWithoutAuth('sentris-run-abc');
      expect(result.run).toEqual(makeRunRecord());
      expect(runRepo.findByRunId).toHaveBeenCalledWith('sentris-run-abc');
    });

    it('throws NotFoundException when the run does not exist', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);
      await expect(service.resolveRunWithoutAuth('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── ensureRunAccess ─────────────────────────────────────────────
  describe('ensureRunAccess', () => {
    it('resolves without error for accessible runs', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord());
      await expect(
        service.ensureRunAccess('sentris-run-abc', authContext),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException for inaccessible runs', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);
      await expect(service.ensureRunAccess('sentris-run-abc', authContext)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getCompiledWorkflowContext ─────────────────────────────────
  describe('getCompiledWorkflowContext', () => {
    it('returns workflow, version, definition, and organizationId', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      const result = await service.getCompiledWorkflowContext('wf-1', {}, authContext);
      expect(result.workflow).toEqual(makeWorkflowRecord());
      expect(result.version).toEqual(makeVersionRecord());
      expect(result.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    });

    it('throws NotFoundException when workflow is not found', async () => {
      workflowRepo.findById.mockResolvedValue(null);
      await expect(
        service.getCompiledWorkflowContext('wf-missing', {}, authContext),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── run ─────────────────────────────────────────────────────────
  describe('run', () => {
    it('orchestrates a successful workflow run', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.findByRunId.mockResolvedValue(null);
      const handle = await service.run('wf-1', {}, authContext);
      expect(handle.status).toBe('RUNNING');
      expect(handle.temporalRunId).toBe('temporal-abc');
      expect(handle.workflowId).toBe('wf-1');
      expect(handle.taskQueue).toBe('test-queue');
      expect(auditLogSvc.recordDurableWithExecutor).toHaveBeenCalledWith(
        expect.any(Object),
        authContext,
        expect.objectContaining({
          action: 'workflow.run',
          resourceType: 'workflow',
          resourceId: 'wf-1',
        }),
        undefined,
        DEFAULT_ORGANIZATION_ID,
      );
      expect(analyticsSvc.trackWorkflowStarted).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-1' }),
      );
      expect(temporalSvc.startWorkflow).toHaveBeenCalledTimes(1);
    });

    it('does not start Temporal when the durable run-request audit cannot be accepted', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.findByRunId.mockResolvedValue(null);
      auditLogSvc.recordDurableWithExecutor.mockRejectedValueOnce(
        new Error('audit outbox unavailable'),
      );

      await expect(service.run('wf-1', {}, authContext)).rejects.toThrow(
        'audit outbox unavailable',
      );

      expect(temporalSvc.startWorkflow).not.toHaveBeenCalled();
      expect(analyticsSvc.trackWorkflowStarted).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when workflow is not found', async () => {
      workflowRepo.findById.mockResolvedValue(null);
      await expect(service.run('wf-missing', {}, authContext)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when auth has no org context', async () => {
      await expect(service.run('wf-1', {}, noOrgAuth)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── prepareRunPayload ──────────────────────────────────────────
  describe('prepareRunPayload', () => {
    it('returns a complete PreparedRunPayload with correct data', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      const payload = await service.prepareRunPayload(
        'wf-1',
        { inputs: { key: 'val' } },
        authContext,
      );
      expect(payload.workflowId).toBe('wf-1');
      expect(payload.workflowVersionId).toBe('ver-1');
      expect(payload.workflowVersion).toBe(1);
      expect(payload.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
      expect(payload.inputs).toEqual({ key: 'val' });
      expect(payload.totalActions).toBe(1);
      expect(payload.triggerMetadata.type).toBe('manual');
      expect(runRepo.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-1' }),
        expect.any(Function),
      );
    });

    it('uses provided runId when specified', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      const payload = await service.prepareRunPayload('wf-1', {}, authContext, {
        runId: 'custom-run-id',
      });
      expect(payload.runId).toBe('custom-run-id');
    });

    it('generates deterministic runId from idempotencyKey', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      const p1 = await service.prepareRunPayload('wf-1', {}, authContext, {
        idempotencyKey: 'same-key',
      });
      const p2 = await service.prepareRunPayload('wf-1', {}, authContext, {
        idempotencyKey: 'same-key',
      });
      expect(p1.runId).toBe(p2.runId);
      expect(p1.runId).toContain('sentris-run-');
    });

    it('rejects idempotency keys over 128 characters instead of prefix-aliasing them', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());

      await expect(
        service.prepareRunPayload('wf-1', {}, authContext, {
          idempotencyKey: 'a'.repeat(129),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(runRepo.prepare).not.toHaveBeenCalled();
      expect(auditLogSvc.recordDurableWithExecutor).not.toHaveBeenCalled();
    });

    it('does not audit or track an exact idempotent replay twice', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.prepare
        .mockResolvedValueOnce({ record: makeRunRecord(), created: true })
        .mockResolvedValueOnce({ record: makeRunRecord(), created: false });

      await service.prepareRunPayload('wf-1', { inputs: { target: 'example.com' } }, authContext, {
        idempotencyKey: 'same-request',
      });
      await service.prepareRunPayload('wf-1', { inputs: { target: 'example.com' } }, authContext, {
        idempotencyKey: 'same-request',
      });

      expect(analyticsSvc.trackWorkflowStarted).toHaveBeenCalledTimes(1);
    });

    it('propagates an idempotency payload conflict before audit or Temporal start', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.prepare.mockRejectedValueOnce(
        new ConflictException('Idempotency key was already used for a different workflow run'),
      );

      await expect(
        service.run('wf-1', { inputs: { target: 'changed.example' } }, authContext, {
          idempotencyKey: 'reused-key',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(auditLogSvc.recordDurableWithExecutor).not.toHaveBeenCalled();
      expect(analyticsSvc.trackWorkflowStarted).not.toHaveBeenCalled();
      expect(temporalSvc.startWorkflow).not.toHaveBeenCalled();
    });

    it('namespaces idempotency-derived run ids by organization and workflow', async () => {
      workflowRepo.findById.mockImplementation(async (id: string) => makeWorkflowRecord({ id }));
      const otherOrgAuth = {
        ...authContext,
        organizationId: 'other-org',
      };

      const original = await service.prepareRunPayload('wf-1', {}, authContext, {
        idempotencyKey: 'caller-key',
      });
      const otherOrganization = await service.prepareRunPayload('wf-1', {}, otherOrgAuth, {
        idempotencyKey: 'caller-key',
      });
      const otherWorkflow = await service.prepareRunPayload('wf-2', {}, authContext, {
        idempotencyKey: 'caller-key',
      });

      expect(otherOrganization.runId).not.toBe(original.runId);
      expect(otherWorkflow.runId).not.toBe(original.runId);
    });

    it('throws NotFoundException when workflow is not found', async () => {
      workflowRepo.findById.mockResolvedValue(null);
      await expect(service.prepareRunPayload('wf-missing', {}, authContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('threads scopeId into the prepared record and the returned payload', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      const payload = await service.prepareRunPayload('wf-1', { scopeId: 'scope-1' }, authContext);
      expect(runRepo.scopeBelongsToOrganization).toHaveBeenCalledWith(
        'scope-1',
        DEFAULT_ORGANIZATION_ID,
      );
      expect(payload.scopeId).toBe('scope-1');
      expect(runRepo.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ scopeId: 'scope-1' }),
        expect.any(Function),
      );
    });

    it('rejects a supplied scope that does not belong to the authenticated organization', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.scopeBelongsToOrganization.mockResolvedValueOnce(false);

      await expect(
        service.prepareRunPayload('wf-1', { scopeId: 'foreign-scope' }, authContext),
      ).rejects.toThrow(NotFoundException);

      expect(runRepo.prepare).not.toHaveBeenCalled();
      expect(auditLogSvc.recordDurableWithExecutor).not.toHaveBeenCalled();
      expect(analyticsSvc.trackWorkflowStarted).not.toHaveBeenCalled();
    });

    it('defaults scopeId to null when the request omits it', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      const payload = await service.prepareRunPayload('wf-1', {}, authContext);
      expect(payload.scopeId).toBeNull();
      expect(runRepo.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ scopeId: null }),
        expect.any(Function),
      );
    });
  });

  // ── startPreparedRun ──────────────────────────────────────────
  describe('startPreparedRun', () => {
    it('starts a temporal workflow and creates a run record', async () => {
      runRepo.findByRunId.mockResolvedValue(null);
      const handle = await service.startPreparedRun(makePreparedPayload());
      expect(handle.runId).toBe('sentris-run-abc');
      expect(handle.temporalRunId).toBe('temporal-abc');
      expect(handle.status).toBe('RUNNING');
      expect(handle.taskQueue).toBe('test-queue');
      expect(temporalSvc.startWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowType: 'sentrisWorkflowRun',
          workflowId: 'sentris-run-abc',
        }),
      );
      expect(runRepo.markStarted).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'sentris-run-abc', temporalRunId: 'temporal-abc' }),
        expect.any(Function),
      );
    });

    it('returns existing handle when run already started', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ temporalRunId: 'existing-temporal' }));
      const handle = await service.startPreparedRun(makePreparedPayload());
      expect(handle.temporalRunId).toBe('existing-temporal');
      expect(handle.status).toBe('RUNNING');
      expect(temporalSvc.startWorkflow).not.toHaveBeenCalled();
    });

    it('returns the persisted terminal status for an exact idempotent replay', async () => {
      runRepo.findByRunId.mockResolvedValue(
        makeRunRecord({ temporalRunId: 'existing-temporal', status: 'COMPLETED' }),
      );

      const handle = await service.startPreparedRun(makePreparedPayload());

      expect(handle.temporalRunId).toBe('existing-temporal');
      expect(handle.status).toBe('COMPLETED');
      expect(temporalSvc.startWorkflow).not.toHaveBeenCalled();
      expect(workflowRepo.incrementRunCount).not.toHaveBeenCalled();
    });

    it('handles "execution already started" error by returning existing run', async () => {
      runRepo.findByRunId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeRunRecord({ temporalRunId: 'temporal-dup' }));
      temporalSvc.startWorkflow.mockRejectedValue(new Error('Workflow execution already started'));
      const handle = await service.startPreparedRun(makePreparedPayload());
      expect(handle.temporalRunId).toBe('temporal-dup');
      expect(handle.status).toBe('RUNNING');
    });

    it('recovers a Temporal execution after its first temporalRunId persistence failed', async () => {
      runRepo.findByRunId.mockResolvedValue(null);
      runRepo.markStarted
        .mockRejectedValueOnce(new Error('database unavailable after Temporal start'))
        .mockImplementationOnce(
          async (input: any, onTransition?: (executor: any, record: any) => Promise<void>) => {
            const record = makeRunRecord({ ...input, temporalRunId: 'temporal-recovered' });
            await onTransition?.({ update: vi.fn() }, record);
            return { record, transitioned: true };
          },
        );

      await expect(service.startPreparedRun(makePreparedPayload())).rejects.toThrow(
        'database unavailable after Temporal start',
      );

      temporalSvc.startWorkflow.mockRejectedValueOnce(
        new Error('Workflow execution already started'),
      );
      temporalSvc.describeWorkflow.mockResolvedValueOnce({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-recovered',
        status: 'COMPLETED',
        startTime: '2025-01-01T00:00:00.000Z',
        closeTime: '2025-01-01T00:01:00.000Z',
        historyLength: 10,
        taskQueue: 'test-queue',
      });

      const recovered = await service.startPreparedRun(makePreparedPayload());

      expect(temporalSvc.describeWorkflow).toHaveBeenCalledWith({
        workflowId: 'sentris-run-abc',
      });
      expect(runRepo.markStarted).toHaveBeenLastCalledWith(
        expect.objectContaining({
          runId: 'sentris-run-abc',
          temporalRunId: 'temporal-recovered',
        }),
        expect.any(Function),
      );
      expect(recovered.temporalRunId).toBe('temporal-recovered');
      expect(recovered.status).toBe('COMPLETED');
      expect(runRepo.finalizeTerminalRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'sentris-run-abc',
          status: 'COMPLETED',
        }),
      );
      expect(workflowRepo.incrementRunCount).toHaveBeenCalledTimes(1);
    });

    it('increments run count only for the caller that persists the started transition', async () => {
      runRepo.findByRunId.mockResolvedValue(null);
      runRepo.markStarted.mockResolvedValueOnce({
        record: makeRunRecord({ temporalRunId: 'temporal-abc' }),
        transitioned: false,
      });

      await service.startPreparedRun(makePreparedPayload());

      expect(workflowRepo.incrementRunCount).not.toHaveBeenCalled();
    });

    it('re-throws non-duplicate Temporal errors', async () => {
      runRepo.findByRunId.mockResolvedValue(null);
      temporalSvc.startWorkflow.mockRejectedValue(new Error('Connection refused'));
      await expect(service.startPreparedRun(makePreparedPayload())).rejects.toThrow(
        'Connection refused',
      );
    });

    it('carries scopeId from the prepared payload into Temporal', async () => {
      runRepo.findByRunId.mockResolvedValue(null);
      await service.startPreparedRun(makePreparedPayload({ scopeId: 'scope-1' }));
      expect(temporalSvc.startWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [
            expect.objectContaining({
              scopeId: 'scope-1',
            }),
          ],
        }),
      );
      expect(runRepo.markStarted).toHaveBeenCalledWith(
        expect.objectContaining({ temporalRunId: 'temporal-abc' }),
        expect.any(Function),
      );
    });
  });

  describe('markRunStarted', () => {
    it('atomically persists a worker-started run and increments run count', async () => {
      runRepo.findByRunId.mockResolvedValue(
        makeRunRecord({
          temporalRunId: null,
          status: null,
        }),
      );

      const result = await service.markRunStarted(
        'sentris-run-abc',
        'temporal-worker-1',
        authContext,
      );

      expect(runRepo.findByRunId).toHaveBeenCalledWith('sentris-run-abc', {
        organizationId: DEFAULT_ORGANIZATION_ID,
      });
      expect(runRepo.markStarted).toHaveBeenCalledWith(
        {
          runId: 'sentris-run-abc',
          workflowId: 'wf-1',
          organizationId: DEFAULT_ORGANIZATION_ID,
          temporalRunId: 'temporal-worker-1',
        },
        expect.any(Function),
      );
      expect(workflowRepo.incrementRunCount).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          temporalRunId: 'temporal-worker-1',
          duplicate: false,
        }),
      );
    });

    it('treats an exact worker replay as success without incrementing again', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ temporalRunId: 'temporal-worker-1' }));
      runRepo.markStarted.mockResolvedValueOnce({
        record: makeRunRecord({ temporalRunId: 'temporal-worker-1' }),
        transitioned: false,
      });

      const result = await service.markRunStarted(
        'sentris-run-abc',
        'temporal-worker-1',
        authContext,
      );

      expect(result.duplicate).toBe(true);
      expect(workflowRepo.incrementRunCount).not.toHaveBeenCalled();
    });

    it('allows one transition winner across concurrent schedule/child callbacks', async () => {
      runRepo.findByRunId.mockResolvedValue(
        makeRunRecord({
          temporalRunId: null,
          status: null,
        }),
      );
      let claimed = false;
      runRepo.markStarted.mockImplementation(
        async (input: any, onTransition?: (executor: any, record: any) => Promise<void>) => {
          const transitioned = !claimed;
          claimed = true;
          const record = makeRunRecord({
            ...input,
            temporalRunId: 'temporal-worker-1',
          });
          if (transitioned) {
            await onTransition?.({ update: vi.fn() }, record);
          }
          return { record, transitioned };
        },
      );

      const results = await Promise.all([
        service.markRunStarted('sentris-run-abc', 'temporal-worker-1', authContext),
        service.markRunStarted('sentris-run-abc', 'temporal-worker-1', authContext),
      ]);

      expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
      expect(workflowRepo.incrementRunCount).toHaveBeenCalledTimes(1);
    });

    it('does not reveal or mutate a run outside the authenticated tenant', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);

      await expect(
        service.markRunStarted('sentris-run-abc', 'temporal-worker-1', {
          ...authContext,
          organizationId: 'foreign-org',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(runRepo.markStarted).not.toHaveBeenCalled();
      expect(workflowRepo.incrementRunCount).not.toHaveBeenCalled();
    });
  });

  // ── listRuns ────────────────────────────────────────────────────
  describe('listRuns', () => {
    it('forwards scopeId to the repository', async () => {
      await service.listRuns(authContext, { scopeId: 'scope-1' });
      expect(runRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeId: 'scope-1',
          organizationId: DEFAULT_ORGANIZATION_ID,
        }),
      );
    });
  });

  // ── getRun ──────────────────────────────────────────────────────
  describe('getRun', () => {
    it('surfaces scopeId on the run summary', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.findByRunId.mockResolvedValue(
        makeRunRecord({ status: 'COMPLETED', scopeId: 'scope-1' }),
      );
      const summary = await service.getRun('sentris-run-abc', authContext);
      expect(summary.scopeId).toBe('scope-1');
    });

    it('yields scopeId null when the run has no scope', async () => {
      workflowRepo.findById.mockResolvedValue(makeWorkflowRecord());
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'COMPLETED', scopeId: null }));
      const summary = await service.getRun('sentris-run-abc', authContext);
      expect(summary.scopeId).toBeNull();
    });
  });

  // ── getRunResult ──────────────────────────────────────────────
  describe('getRunResult', () => {
    it('returns the workflow result from Temporal', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'COMPLETED' }));
      const result = await service.getRunResult('sentris-run-abc', 'temporal-abc', authContext);
      expect(result).toEqual({ status: 'COMPLETED', result: { ok: true } });
      expect(temporalSvc.getWorkflowResult).toHaveBeenCalledWith({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
      });
    });

    it.each(['FAILED', 'CANCELLED', 'TIMED_OUT', 'TERMINATED'] as const)(
      'returns a null result for a cached %s run without querying Temporal',
      async (status) => {
        runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status }));
        const result = await service.getRunResult('sentris-run-abc', undefined, authContext);
        expect(result).toEqual({ status, result: null });
        expect(temporalSvc.getWorkflowResult).not.toHaveBeenCalled();
      },
    );

    it('uses a tenant-scoped durable terminal status recorded while result retrieval was failing', async () => {
      runRepo.findByRunId
        .mockResolvedValueOnce(makeRunRecord({ status: 'RUNNING' }))
        .mockResolvedValueOnce(makeRunRecord({ status: 'FAILED' }));
      temporalSvc.getWorkflowResult.mockRejectedValue(
        new WorkflowFailedError('Workflow execution failed'),
      );

      const result = await service.getRunResult('sentris-run-abc', undefined, authContext);

      expect(result).toEqual({ status: 'FAILED', result: null });
      expect(runRepo.findByRunId).toHaveBeenLastCalledWith('sentris-run-abc', {
        organizationId: DEFAULT_ORGANIZATION_ID,
      });
      expect(temporalSvc.describeWorkflow).not.toHaveBeenCalled();
    });

    it.each(['FAILED', 'CANCELLED', 'TIMED_OUT', 'TERMINATED'] as const)(
      'reconciles a rejected Temporal result to the exact %s lifecycle status',
      async (status) => {
        runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'RUNNING' }));
        temporalSvc.getWorkflowResult.mockRejectedValue(
          new WorkflowFailedError(`Workflow execution ended as ${status}`),
        );
        temporalSvc.describeWorkflow.mockResolvedValue({
          workflowId: 'sentris-run-abc',
          runId: 'temporal-abc',
          status,
          startTime: '2025-01-01T00:00:00.000Z',
          closeTime: '2025-01-01T00:01:00.000Z',
          historyLength: 5,
          taskQueue: 'test-queue',
        });

        const result = await service.getRunResult('sentris-run-abc', 'temporal-abc', authContext);

        expect(result).toEqual({ status, result: null });
        expect(runRepo.finalizeTerminalRun).toHaveBeenCalledWith({
          runId: 'sentris-run-abc',
          organizationId: DEFAULT_ORGANIZATION_ID,
          status,
          completedAt: new Date('2025-01-01T00:01:00.000Z'),
        });
      },
    );

    it('propagates a rejected result when Temporal still describes the workflow as running', async () => {
      const workflowFailure = new WorkflowFailedError('Workflow result rejected ambiguously');
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'RUNNING' }));
      temporalSvc.getWorkflowResult.mockRejectedValue(workflowFailure);
      temporalSvc.describeWorkflow.mockResolvedValue({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
        status: 'RUNNING',
        startTime: '2025-01-01T00:00:00.000Z',
        historyLength: 5,
        taskQueue: 'test-queue',
      });

      await expect(
        service.getRunResult('sentris-run-abc', 'temporal-abc', authContext),
      ).rejects.toBe(workflowFailure);
    });

    it('does not report a null result when a concurrent finalizer records COMPLETED', async () => {
      const workflowFailure = new WorkflowFailedError('Workflow result could not be decoded');
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'RUNNING' }));
      temporalSvc.getWorkflowResult.mockRejectedValue(workflowFailure);
      temporalSvc.describeWorkflow.mockResolvedValue({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
        status: 'FAILED',
        startTime: '2025-01-01T00:00:00.000Z',
        closeTime: '2025-01-01T00:01:00.000Z',
        historyLength: 5,
        taskQueue: 'test-queue',
      });
      runRepo.finalizeTerminalRun.mockResolvedValue({
        record: makeRunRecord({
          status: 'COMPLETED',
          closeTime: new Date('2025-01-01T00:01:00.000Z'),
        }),
        duplicate: true,
      });

      await expect(
        service.getRunResult('sentris-run-abc', 'temporal-abc', authContext),
      ).rejects.toBe(workflowFailure);
    });

    it('preserves generic lifecycle-error handling by reconciling the described status', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'RUNNING' }));
      temporalSvc.getWorkflowResult.mockRejectedValue(new Error('Workflow was terminated'));
      temporalSvc.describeWorkflow.mockResolvedValue({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
        status: 'TERMINATED',
        startTime: '2025-01-01T00:00:00.000Z',
        closeTime: '2025-01-01T00:01:00.000Z',
        historyLength: 5,
        taskQueue: 'test-queue',
      });

      const result = await service.getRunResult('sentris-run-abc', undefined, authContext);

      expect(result).toEqual({ status: 'TERMINATED', result: null });
    });

    it('throws NotFoundException when run is not accessible', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);
      await expect(service.getRunResult('sentris-run-abc', undefined, authContext)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── cancelRun ─────────────────────────────────────────────────
  describe('cancelRun', () => {
    it('cancels the workflow run via Temporal', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord());
      await service.cancelRun('sentris-run-abc', 'temporal-abc', authContext);
      expect(temporalSvc.cancelWorkflow).toHaveBeenCalledWith({
        workflowId: 'sentris-run-abc',
        runId: 'temporal-abc',
      });
      expect(auditLogSvc.recordDurable).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({
          action: 'workflow_run.cancel',
          resourceId: 'sentris-run-abc',
          metadata: expect.objectContaining({ phase: 'requested' }),
        }),
      );
    });

    it('does not call Temporal when durable cancellation audit acceptance fails', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord());
      auditLogSvc.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));

      await expect(
        service.cancelRun('sentris-run-abc', 'temporal-abc', authContext),
      ).rejects.toThrow('audit outbox unavailable');

      expect(temporalSvc.cancelWorkflow).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when run is not found', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);
      await expect(service.cancelRun('sentris-run-abc', undefined, authContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when auth has no org context', async () => {
      await expect(service.cancelRun('sentris-run-abc', undefined, noOrgAuth)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── getRunConfig ──────────────────────────────────────────────
  describe('getRunConfig', () => {
    it('returns the run configuration for an accessible run', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ inputs: { target: 'example.com' } }));
      const config = await service.getRunConfig('sentris-run-abc', authContext);
      expect(config.runId).toBe('sentris-run-abc');
      expect(config.workflowId).toBe('wf-1');
      expect(config.workflowVersionId).toBe('ver-1');
      expect(config.workflowVersion).toBe(1);
      expect(config.inputs).toEqual({ target: 'example.com' });
    });

    it('throws NotFoundException for runs the user cannot access', async () => {
      runRepo.findByRunId.mockResolvedValue(undefined);
      await expect(service.getRunConfig('sentris-run-abc', authContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when auth has no org context', async () => {
      await expect(service.getRunConfig('sentris-run-abc', noOrgAuth)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
