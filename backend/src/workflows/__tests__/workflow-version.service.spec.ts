import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { WorkflowVersionService } from '../workflow-version.service';
import type { WorkflowRepository, WorkflowRecord } from '../repository/workflow.repository';
import type { WorkflowRoleRepository } from '../repository/workflow-role.repository';
import type { WorkflowVersionRepository } from '../repository/workflow-version.repository';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import type { WorkflowVersionRecord } from '../../database/schema';
import type { WorkflowDefinition } from '../../dsl/types';

// ── Mock DSL compiler ───────────────────────────────────────────────
const mockDefinition: WorkflowDefinition = {
  version: 2,
  title: 'Test Workflow',
  entrypoint: { ref: 'trigger' },
  nodes: {},
  edges: [],
  dependencyCounts: {},
  actions: [
    {
      ref: 'trigger',
      componentId: 'core.workflow.entrypoint',
      params: {},
      inputOverrides: {},
      dependsOn: [],
      inputMappings: {},
    },
  ],
  config: { environment: 'default', timeoutSeconds: 0 },
};

vi.mock('../../dsl/compiler', () => ({
  compileWorkflowGraph: vi.fn().mockReturnValue(mockDefinition),
}));

// ── Constants ───────────────────────────────────────────────────────
const TEST_ORG = 'test-org';
const now = new Date('2024-06-01T00:00:00.000Z');

const authContext: AuthContext = {
  userId: 'user-1',
  organizationId: TEST_ORG,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const noOrgAuth: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

// ── Factories ───────────────────────────────────────────────────────
function makeWorkflowRecord(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: null,
    graph: { name: 'Test Workflow', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    compiledDefinition: null,
    organizationId: TEST_ORG,
    createdAt: now,
    updatedAt: now,
    lastRun: null,
    latestRunStatus: null,
    runCount: 0,
    ...overrides,
  } as WorkflowRecord;
}

const validGraph = {
  name: 'Test Workflow',
  nodes: [
    {
      id: 'trigger',
      type: 'core.workflow.entrypoint',
      position: { x: 0, y: 0 },
      data: { label: 'Trigger', config: { params: {}, inputOverrides: {} } },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function makeVersionRecord(overrides: Partial<WorkflowVersionRecord> = {}): WorkflowVersionRecord {
  return {
    id: 'ver-1',
    workflowId: 'wf-1',
    version: 1,
    graph: validGraph,
    organizationId: TEST_ORG,
    compiledDefinition: null,
    createdAt: now,
    ...overrides,
  } as WorkflowVersionRecord;
}

// ── Tests ───────────────────────────────────────────────────────────
describe('WorkflowVersionService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let roleRepo: Record<string, ReturnType<typeof vi.fn>>;
  let versionRepo: Record<string, ReturnType<typeof vi.fn>>;
  let auditLog: Record<string, ReturnType<typeof vi.fn>>;
  let service: WorkflowVersionService;

  beforeEach(() => {
    vi.clearAllMocks();

    repo = {
      findById: vi.fn(),
      saveCompiledDefinition: vi.fn(),
    };
    roleRepo = {
      hasRole: vi.fn(),
    };
    versionRepo = {
      findLatestByWorkflowId: vi.fn(),
      findAllByWorkflowId: vi.fn(),
      findById: vi.fn(),
      findByWorkflowAndVersion: vi.fn(),
      setCompiledDefinition: vi.fn(),
    };
    auditLog = {
      record: vi.fn(),
    };

    service = new WorkflowVersionService(
      repo as unknown as WorkflowRepository,
      roleRepo as unknown as WorkflowRoleRepository,
      versionRepo as unknown as WorkflowVersionRepository,
      auditLog as unknown as AuditLogService,
    );
  });

  // ── commit ──────────────────────────────────────────────────────

  describe('commit', () => {
    it('should compile and save the latest version definition', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      versionRepo.findLatestByWorkflowId.mockResolvedValue(makeVersionRecord({ version: 3 }));
      versionRepo.setCompiledDefinition.mockResolvedValue(undefined);
      repo.saveCompiledDefinition.mockResolvedValue(undefined);

      const result = await service.commit('wf-1', authContext);

      expect(result).toEqual(mockDefinition);
      expect(repo.saveCompiledDefinition).toHaveBeenCalledWith('wf-1', mockDefinition, {
        organizationId: TEST_ORG,
      });
      expect(versionRepo.setCompiledDefinition).toHaveBeenCalledWith('ver-1', mockDefinition, {
        organizationId: TEST_ORG,
      });
      expect(auditLog.record).toHaveBeenCalledTimes(1);
    });

    it('should throw ForbiddenException when org context is missing', async () => {
      await expect(service.commit('wf-1', noOrgAuth)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when workflow does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.commit('wf-missing', authContext)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when no versions exist', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      versionRepo.findLatestByWorkflowId.mockResolvedValue(undefined);

      await expect(service.commit('wf-1', authContext)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listVersions ────────────────────────────────────────────────

  describe('listVersions', () => {
    it('should return mapped version list for the workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      versionRepo.findAllByWorkflowId.mockResolvedValue([
        { id: 'ver-2', workflowId: 'wf-1', version: 2, createdAt: now },
        { id: 'ver-1', workflowId: 'wf-1', version: 1, createdAt: now },
      ]);

      const result = await service.listVersions('wf-1', authContext);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'ver-2',
        workflowId: 'wf-1',
        version: 2,
        createdAt: now.toISOString(),
      });
      expect(versionRepo.findAllByWorkflowId).toHaveBeenCalledWith('wf-1', {
        organizationId: TEST_ORG,
      });
    });

    it('should throw ForbiddenException when org context is missing', async () => {
      await expect(service.listVersions('wf-1', noOrgAuth)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when workflow does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.listVersions('wf-missing', authContext)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getWorkflowVersion ──────────────────────────────────────────

  describe('getWorkflowVersion', () => {
    it('should return the requested version with mapped fields', async () => {
      versionRepo.findById.mockResolvedValue(makeVersionRecord({ id: 'ver-1', version: 1 }));

      const result = await service.getWorkflowVersion('wf-1', 'ver-1', authContext);

      expect(result).toEqual({
        id: 'ver-1',
        workflowId: 'wf-1',
        version: 1,
        graph: expect.any(Object),
        createdAt: now.toISOString(),
      });
    });

    it('should throw NotFoundException when version does not exist', async () => {
      versionRepo.findById.mockResolvedValue(undefined);

      await expect(service.getWorkflowVersion('wf-1', 'ver-missing', authContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when version belongs to a different workflow', async () => {
      versionRepo.findById.mockResolvedValue(makeVersionRecord({ workflowId: 'wf-other' }));

      await expect(service.getWorkflowVersion('wf-1', 'ver-1', authContext)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── resolveWorkflowVersion ──────────────────────────────────────

  describe('resolveWorkflowVersion', () => {
    it('should resolve by versionId when provided', async () => {
      const version = makeVersionRecord({ id: 'ver-1' });
      versionRepo.findById.mockResolvedValue(version);

      const result = await service.resolveWorkflowVersion('wf-1', { versionId: 'ver-1' }, TEST_ORG);

      expect(result).toEqual(version);
      expect(versionRepo.findById).toHaveBeenCalledWith('ver-1', {
        organizationId: TEST_ORG,
      });
    });

    it('should resolve by version number when provided', async () => {
      const version = makeVersionRecord({ version: 3 });
      versionRepo.findByWorkflowAndVersion.mockResolvedValue(version);

      const result = await service.resolveWorkflowVersion('wf-1', { version: 3 }, TEST_ORG);

      expect(result).toEqual(version);
      expect(versionRepo.findByWorkflowAndVersion).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        version: 3,
        organizationId: TEST_ORG,
      });
    });

    it('should resolve to latest version when no version specified', async () => {
      const latest = makeVersionRecord({ version: 5 });
      versionRepo.findLatestByWorkflowId.mockResolvedValue(latest);

      const result = await service.resolveWorkflowVersion('wf-1', {}, TEST_ORG);

      expect(result).toEqual(latest);
      expect(versionRepo.findLatestByWorkflowId).toHaveBeenCalledWith('wf-1', {
        organizationId: TEST_ORG,
      });
    });

    it('should throw NotFoundException when no versions exist', async () => {
      versionRepo.findLatestByWorkflowId.mockResolvedValue(undefined);

      await expect(service.resolveWorkflowVersion('wf-1', {}, TEST_ORG)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when versionId not found', async () => {
      versionRepo.findById.mockResolvedValue(undefined);

      await expect(
        service.resolveWorkflowVersion('wf-1', { versionId: 'ver-x' }, TEST_ORG),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── ensureDefinitionForVersion ──────────────────────────────────

  describe('ensureDefinitionForVersion', () => {
    it('should return cached definition when already compiled', async () => {
      const workflow = makeWorkflowRecord();
      const version = makeVersionRecord({ compiledDefinition: mockDefinition });

      const result = await service.ensureDefinitionForVersion(
        workflow as WorkflowRecord,
        version,
        TEST_ORG,
      );

      expect(result).toEqual(mockDefinition);
      expect(versionRepo.setCompiledDefinition).not.toHaveBeenCalled();
    });

    it('should compile and cache when no definition exists', async () => {
      const workflow = makeWorkflowRecord();
      const version = makeVersionRecord({ compiledDefinition: null });

      const result = await service.ensureDefinitionForVersion(
        workflow as WorkflowRecord,
        version,
        TEST_ORG,
      );

      expect(result).toEqual(mockDefinition);
      expect(versionRepo.setCompiledDefinition).toHaveBeenCalledWith('ver-1', mockDefinition, {
        organizationId: TEST_ORG,
      });
    });

    it('should patch definition when entrypoint is missing but entry action exists', async () => {
      const definitionWithoutEntrypoint = {
        ...mockDefinition,
        entrypoint: { ref: 'wrong-ref' },
      };
      const workflow = makeWorkflowRecord();
      const version = makeVersionRecord({
        compiledDefinition: definitionWithoutEntrypoint,
      });

      const result = await service.ensureDefinitionForVersion(
        workflow as WorkflowRecord,
        version,
        TEST_ORG,
      );

      expect(result.entrypoint.ref).toBe('trigger');
      expect(versionRepo.setCompiledDefinition).toHaveBeenCalledTimes(1);
    });
  });
});
