import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { FilesService } from '../files.service';
import type { FilesRepository } from '../files.repository';
import type { StorageService } from '../storage.service';
import type { AuthContext } from '../../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { File as FileRecord } from '../../database/schema/files.schema';

const now = new Date('2024-06-01T00:00:00.000Z');
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 'file-1',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    storageKey: 'abc-123-report.pdf',
    organizationId: DEFAULT_ORGANIZATION_ID,
    uploadedAt: now,
    ...overrides,
  };
}

describe('FilesService', () => {
  let filesRepo: Record<string, ReturnType<typeof vi.fn>>;
  let storage: Record<string, ReturnType<typeof vi.fn>>;
  let service: FilesService;

  beforeEach(() => {
    filesRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };
    storage = {
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    service = new FilesService(
      filesRepo as unknown as FilesRepository,
      storage as unknown as StorageService,
    );
  });

  // ── Upload ────────────────────────────────────────────────────────
  it('uploads a file to storage and saves metadata', async () => {
    storage.uploadFile.mockResolvedValue({
      storageKey: 'key-report.pdf',
      size: 2048,
    });
    filesRepo.create.mockResolvedValue(makeFileRecord({ storageKey: 'key-report.pdf' }));

    const buf = Buffer.from('pdf-content');
    const result = await service.uploadFile(authContext, 'report.pdf', buf, 'application/pdf');

    expect(result.fileName).toBe('report.pdf');
    expect(storage.uploadFile).toHaveBeenCalledWith('report.pdf', buf, 'application/pdf');
    expect(filesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        storageKey: 'key-report.pdf',
        organizationId: DEFAULT_ORGANIZATION_ID,
      }),
    );
  });

  // ── Get by id ─────────────────────────────────────────────────────
  it('returns a file by id', async () => {
    filesRepo.findById.mockResolvedValue(makeFileRecord());
    const result = await service.getFileById(authContext, 'file-1');
    expect(result.id).toBe('file-1');
    expect(filesRepo.findById).toHaveBeenCalledWith('file-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('throws NotFoundException when file does not exist', async () => {
    filesRepo.findById.mockResolvedValue(null);
    await expect(service.getFileById(authContext, 'missing')).rejects.toThrow(NotFoundException);
  });

  // ── Download ──────────────────────────────────────────────────────
  it('downloads a file from storage', async () => {
    filesRepo.findById.mockResolvedValue(makeFileRecord());
    const content = Buffer.from('pdf-bytes');
    storage.downloadFile.mockResolvedValue(content);

    const result = await service.downloadFile(authContext, 'file-1');

    expect(result.buffer).toBe(content);
    expect(result.file.id).toBe('file-1');
    expect(storage.downloadFile).toHaveBeenCalledWith('abc-123-report.pdf');
  });

  // ── List ──────────────────────────────────────────────────────────
  it('lists files with default limit', async () => {
    filesRepo.list.mockResolvedValue([makeFileRecord()]);
    const result = await service.listFiles(authContext);
    expect(result).toHaveLength(1);
    expect(filesRepo.list).toHaveBeenCalledWith(100, {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('passes custom limit to the repository', async () => {
    filesRepo.list.mockResolvedValue([]);
    await service.listFiles(authContext, 25);
    expect(filesRepo.list).toHaveBeenCalledWith(25, {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  // ── Delete ────────────────────────────────────────────────────────
  it('deletes file from storage and database', async () => {
    filesRepo.findById.mockResolvedValue(makeFileRecord());
    storage.deleteFile.mockResolvedValue(undefined);
    filesRepo.delete.mockResolvedValue(undefined);

    await service.deleteFile(authContext, 'file-1');

    expect(storage.deleteFile).toHaveBeenCalledWith('abc-123-report.pdf');
    expect(filesRepo.delete).toHaveBeenCalledWith('file-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });
});
