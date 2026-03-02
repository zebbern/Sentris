import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { WorkflowTagsService } from '../workflow-tags.service';
import type { WorkflowRepository } from '../repository/workflow.repository';
import type { WorkflowRoleRepository } from '../repository/workflow-role.repository';
import type { WorkflowTagsRepository } from '../repository/workflow-tags.repository';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';

const TEST_ORG = 'test-org';

const authContext: AuthContext = {
  userId: 'user-1',
  organizationId: TEST_ORG,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const memberAuth: AuthContext = {
  userId: 'user-2',
  organizationId: TEST_ORG,
  roles: ['MEMBER'],
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

function makeWorkflowRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: null,
    graph: {},
    compiledDefinition: null,
    organizationId: TEST_ORG,
    createdAt: new Date('2024-06-01'),
    updatedAt: new Date('2024-06-01'),
    lastRun: null,
    latestRunStatus: null,
    runCount: 0,
    ...overrides,
  };
}

describe('WorkflowTagsService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let roleRepo: Record<string, ReturnType<typeof vi.fn>>;
  let tagsRepo: Record<string, ReturnType<typeof vi.fn>>;
  let auditLog: Record<string, ReturnType<typeof vi.fn>>;
  let service: WorkflowTagsService;

  beforeEach(() => {
    vi.clearAllMocks();

    repo = {
      findById: vi.fn(),
    };
    roleRepo = {
      hasRole: vi.fn(),
    };
    tagsRepo = {
      setTags: vi.fn(),
      getTagsByWorkflowId: vi.fn(),
      listAllTags: vi.fn(),
    };
    auditLog = {
      record: vi.fn(),
    };

    service = new WorkflowTagsService(
      repo as unknown as WorkflowRepository,
      roleRepo as unknown as WorkflowRoleRepository,
      tagsRepo as unknown as WorkflowTagsRepository,
      auditLog as unknown as AuditLogService,
    );
  });

  // ── setWorkflowTags ─────────────────────────────────────────────

  describe('setWorkflowTags', () => {
    it('should set tags successfully when user is admin', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      tagsRepo.getTagsByWorkflowId.mockResolvedValue(['old-tag']);
      tagsRepo.setTags.mockResolvedValue(['security', 'compliance']);

      const result = await service.setWorkflowTags(authContext, 'wf-1', ['security', 'compliance']);

      expect(result).toEqual({ tags: ['security', 'compliance'] });
      expect(tagsRepo.setTags).toHaveBeenCalledWith('wf-1', ['security', 'compliance']);
      expect(auditLog.record).toHaveBeenCalledTimes(1);
    });

    it('should throw ForbiddenException when organization context is missing', async () => {
      await expect(service.setWorkflowTags(noOrgAuth, 'wf-1', ['tag'])).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when non-admin member lacks workflow role', async () => {
      roleRepo.hasRole.mockResolvedValue(false);

      await expect(service.setWorkflowTags(memberAuth, 'wf-1', ['tag'])).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow non-admin member with workflow ADMIN role', async () => {
      roleRepo.hasRole.mockResolvedValue(true);
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      tagsRepo.getTagsByWorkflowId.mockResolvedValue([]);
      tagsRepo.setTags.mockResolvedValue(['new-tag']);

      const result = await service.setWorkflowTags(memberAuth, 'wf-1', ['new-tag']);

      expect(result).toEqual({ tags: ['new-tag'] });
      expect(roleRepo.hasRole).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        userId: 'user-2',
        role: 'ADMIN',
        organizationId: TEST_ORG,
      });
    });

    it('should throw NotFoundException when workflow does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.setWorkflowTags(authContext, 'wf-missing', ['tag'])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle setting an empty tags array', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      tagsRepo.getTagsByWorkflowId.mockResolvedValue(['old-tag']);
      tagsRepo.setTags.mockResolvedValue([]);

      const result = await service.setWorkflowTags(authContext, 'wf-1', []);

      expect(result).toEqual({ tags: [] });
      expect(tagsRepo.setTags).toHaveBeenCalledWith('wf-1', []);
    });
  });

  // ── getWorkflowTags ─────────────────────────────────────────────

  describe('getWorkflowTags', () => {
    it('should return tags for a valid workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      tagsRepo.getTagsByWorkflowId.mockResolvedValue(['security', 'compliance']);

      const result = await service.getWorkflowTags(authContext, 'wf-1');

      expect(result).toEqual({ tags: ['security', 'compliance'] });
      expect(repo.findById).toHaveBeenCalledWith('wf-1', { organizationId: TEST_ORG });
    });

    it('should throw ForbiddenException when organization context is missing', async () => {
      await expect(service.getWorkflowTags(noOrgAuth, 'wf-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when workflow does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getWorkflowTags(authContext, 'wf-missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return empty tags array when workflow has no tags', async () => {
      repo.findById.mockResolvedValue(makeWorkflowRecord());
      tagsRepo.getTagsByWorkflowId.mockResolvedValue([]);

      const result = await service.getWorkflowTags(authContext, 'wf-1');

      expect(result).toEqual({ tags: [] });
    });
  });

  // ── listAllTags ─────────────────────────────────────────────────

  describe('listAllTags', () => {
    it('should return all tags with counts for the organization', async () => {
      tagsRepo.listAllTags.mockResolvedValue([
        { name: 'security', count: 5 },
        { name: 'compliance', count: 3 },
      ]);

      const result = await service.listAllTags(authContext);

      expect(result).toEqual({
        tags: [
          { name: 'security', count: 5 },
          { name: 'compliance', count: 3 },
        ],
      });
      expect(tagsRepo.listAllTags).toHaveBeenCalledWith(TEST_ORG);
    });

    it('should throw ForbiddenException when organization context is missing', async () => {
      await expect(service.listAllTags(noOrgAuth)).rejects.toThrow(ForbiddenException);
    });

    it('should return empty array when no tags exist', async () => {
      tagsRepo.listAllTags.mockResolvedValue([]);

      const result = await service.listAllTags(authContext);

      expect(result).toEqual({ tags: [] });
    });
  });
});
