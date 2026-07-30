import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { ArtifactsService } from '../artifacts.service';
import type { ArtifactsRepository } from '../artifacts.repository';
import type { FilesService } from '../files.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import type { ArtifactRecord } from '../../database/schema/artifacts.schema';

const now = new Date('2024-06-01T00:00:00.000Z');
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'artifact-1',
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowVersionId: 'wfv-1',
    componentId: 'comp-1',
    componentRef: 'scanner',
    fileId: 'file-1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    destinations: ['run'],
    metadata: null,
    organizationId: 'org-1',
    createdAt: now,
    ...overrides,
  };
}

describe('ArtifactsService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let filesService: Record<string, ReturnType<typeof vi.fn>>;
  let auditLog: Record<string, ReturnType<typeof vi.fn>>;
  let service: ArtifactsService;

  beforeEach(() => {
    repo = {
      listByRun: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(),
      findByIdForRun: vi.fn(),
      delete: vi.fn(),
    };
    filesService = {
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
    };
    auditLog = {
      recordDurable: vi.fn(async () => undefined),
      recordDurableWithExecutor: vi.fn(async () => undefined),
    };

    service = new ArtifactsService(
      repo as unknown as ArtifactsRepository,
      filesService as unknown as FilesService,
      auditLog as unknown as AuditLogService,
    );
  });

  // ── List ──────────────────────────────────────────────────────────
  it('lists artifacts for a run', async () => {
    repo.listByRun.mockResolvedValue([makeArtifact()]);
    const result = await service.listRunArtifacts(authContext, 'run-1');
    expect(result.runId).toBe('run-1');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].id).toBe('artifact-1');
    expect(repo.listByRun).toHaveBeenCalledWith('run-1', { organizationId: 'org-1' });
  });

  it('lists artifacts with filters', async () => {
    repo.list.mockResolvedValue([makeArtifact()]);
    const result = await service.listArtifacts(authContext, { workflowId: 'wf-1' });
    expect(result.artifacts).toHaveLength(1);
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-1', organizationId: 'org-1' }),
    );
  });

  // ── Get ───────────────────────────────────────────────────────────
  it('returns an artifact record by id', async () => {
    repo.findById.mockResolvedValue(makeArtifact());
    const result = await service.getArtifactRecord(authContext, 'artifact-1');
    expect(result.id).toBe('artifact-1');
  });

  it('throws NotFoundException when artifact does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.getArtifactRecord(authContext, 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── Download ──────────────────────────────────────────────────────
  it('downloads an artifact and records audit log', async () => {
    repo.findById.mockResolvedValue(makeArtifact());
    const buf = Buffer.from('pdf-content');
    filesService.downloadFile.mockResolvedValue({
      file: { id: 'file-1', fileName: 'report.pdf' },
      buffer: buf,
    });

    const result = await service.downloadArtifact(authContext, 'artifact-1');

    expect(result.buffer).toBe(buf);
    expect(filesService.downloadFile).toHaveBeenCalledWith(authContext, 'file-1');
    expect(auditLog.recordDurable).toHaveBeenCalledWith(
      authContext,
      expect.objectContaining({
        action: 'artifact.download',
        metadata: expect.objectContaining({ phase: 'requested' }),
      }),
    );
  });

  it('does not read artifact bytes when durable download audit acceptance fails', async () => {
    repo.findById.mockResolvedValue(makeArtifact());
    auditLog.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));

    await expect(service.downloadArtifact(authContext, 'artifact-1')).rejects.toThrow(
      'audit outbox unavailable',
    );

    expect(filesService.downloadFile).not.toHaveBeenCalled();
  });

  it('downloads an artifact scoped to a run', async () => {
    repo.findByIdForRun.mockResolvedValue(makeArtifact());
    filesService.downloadFile.mockResolvedValue({
      file: { id: 'file-1' },
      buffer: Buffer.alloc(0),
    });

    await service.downloadArtifactForRun(authContext, 'run-1', 'artifact-1');

    expect(repo.findByIdForRun).toHaveBeenCalledWith('artifact-1', 'run-1', {
      organizationId: 'org-1',
    });
    expect(auditLog.recordDurable).toHaveBeenCalledWith(
      authContext,
      expect.objectContaining({
        action: 'artifact.download',
        metadata: expect.objectContaining({ phase: 'requested' }),
      }),
    );
  });

  it('throws when run-scoped artifact is not found', async () => {
    repo.findByIdForRun.mockResolvedValue(null);
    await expect(service.downloadArtifactForRun(authContext, 'run-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── Delete ────────────────────────────────────────────────────────
  it('deletes an artifact and its file', async () => {
    repo.findById.mockResolvedValue(makeArtifact());
    filesService.deleteFile.mockResolvedValue(undefined);

    await service.deleteArtifact(authContext, 'artifact-1');

    expect(auditLog.recordDurable).toHaveBeenCalledWith(
      authContext,
      expect.objectContaining({
        action: 'artifact.delete',
        metadata: expect.objectContaining({ phase: 'requested' }),
      }),
    );
    expect(filesService.deleteFile).toHaveBeenCalledWith(authContext, 'file-1');
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('does not touch storage when durable audit enqueueing fails', async () => {
    repo.findById.mockResolvedValue(makeArtifact());
    auditLog.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));
    filesService.deleteFile.mockResolvedValue(undefined);

    await expect(service.deleteArtifact(authContext, 'artifact-1')).rejects.toThrow(
      'audit outbox unavailable',
    );

    expect(filesService.deleteFile).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when deleting non-existent artifact', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.deleteArtifact(authContext, 'artifact-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(filesService.deleteFile).not.toHaveBeenCalled();
  });

  it('propagates a storage outage and retains the artifact retry anchor', async () => {
    repo.findById.mockResolvedValue(makeArtifact());
    filesService.deleteFile.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.deleteArtifact(authContext, 'artifact-1')).rejects.toThrow(
      'storage unavailable',
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  // ── Organization context ──────────────────────────────────────────
  it('throws when organization context is missing', async () => {
    await expect(service.listRunArtifacts(null, 'run-1')).rejects.toThrow(ForbiddenException);
  });
});
