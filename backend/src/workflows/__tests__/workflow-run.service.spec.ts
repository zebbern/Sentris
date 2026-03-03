import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

// ── Test suite ──────────────────────────────────────────────────────
describe('WorkflowRunService', () => {
  let workflowRepo: Record<string, ReturnType<typeof vi.fn>>;
  let runRepo: Record<string, ReturnType<typeof vi.fn>>;
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
      upsert: vi.fn().mockImplementation(async (input: any) => makeRunRecord(input)),
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
    };
    analyticsSvc = { trackWorkflowStarted: vi.fn() };
    auditLogSvc = { record: vi.fn() };
    versionSvc = {
      resolveWorkflowVersion: vi.fn().mockResolvedValue(makeVersionRecord()),
      ensureDefinitionForVersion: vi.fn().mockResolvedValue(makeDefinition()),
    };
    service = new WorkflowRunService(
      workflowRepo as unknown as WorkflowRepository,
      runRepo as unknown as WorkflowRunRepository,
      {} as unknown as WorkflowVersionRepository,
      {} as unknown as TraceRepository,
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
      expect(auditLogSvc.record).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({
          action: 'workflow.run',
          resourceType: 'workflow',
          resourceId: 'wf-1',
        }),
      );
      expect(analyticsSvc.trackWorkflowStarted).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-1' }),
      );
      expect(temporalSvc.startWorkflow).toHaveBeenCalledTimes(1);
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
      expect(runRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1' }));
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

    it('throws NotFoundException when workflow is not found', async () => {
      workflowRepo.findById.mockResolvedValue(null);
      await expect(service.prepareRunPayload('wf-missing', {}, authContext)).rejects.toThrow(
        NotFoundException,
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
      expect(runRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'sentris-run-abc', temporalRunId: 'temporal-abc' }),
      );
    });

    it('returns existing handle when run already started', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ temporalRunId: 'existing-temporal' }));
      const handle = await service.startPreparedRun(makePreparedPayload());
      expect(handle.temporalRunId).toBe('existing-temporal');
      expect(handle.status).toBe('RUNNING');
      expect(temporalSvc.startWorkflow).not.toHaveBeenCalled();
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

    it('re-throws non-duplicate Temporal errors', async () => {
      runRepo.findByRunId.mockResolvedValue(null);
      temporalSvc.startWorkflow.mockRejectedValue(new Error('Connection refused'));
      await expect(service.startPreparedRun(makePreparedPayload())).rejects.toThrow(
        'Connection refused',
      );
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

    it('returns null result for terminated runs without querying Temporal', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'TERMINATED' }));
      const result = await service.getRunResult('sentris-run-abc', undefined, authContext);
      expect(result).toEqual({ status: 'TERMINATED', result: null });
      expect(temporalSvc.getWorkflowResult).not.toHaveBeenCalled();
    });

    it('returns TERMINATED when Temporal reports workflow failure', async () => {
      runRepo.findByRunId.mockResolvedValue(makeRunRecord({ status: 'RUNNING' }));
      temporalSvc.getWorkflowResult.mockRejectedValue(new Error('Workflow was terminated'));
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
