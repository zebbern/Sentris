import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import { FilesController } from '../files.controller';
import type { FilesService } from '../files.service';

const auth: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'test',
};

const fileMetadata = {
  id: 'file-1',
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
  size: 3,
  storageKey: 'storage-key',
  uploadedAt: new Date('2026-07-29T00:00:00.000Z'),
};

describe('FilesController strict user-operation auditing', () => {
  let filesService: Record<string, ReturnType<typeof vi.fn>>;
  let auditLogService: Record<string, ReturnType<typeof vi.fn>>;
  let controller: FilesController;

  beforeEach(() => {
    filesService = {
      uploadFile: vi.fn().mockResolvedValue(fileMetadata),
      getFileById: vi.fn().mockResolvedValue(fileMetadata),
      downloadFile: vi.fn().mockResolvedValue({
        file: fileMetadata,
        buffer: Buffer.from('pdf'),
      }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };
    auditLogService = {
      recordDurable: vi.fn().mockResolvedValue(undefined),
    };
    controller = new FilesController(
      filesService as unknown as FilesService,
      auditLogService as unknown as AuditLogService,
    );
  });

  it('accepts the durable upload audit before writing bytes to object storage', async () => {
    const upload = {
      fieldname: 'file',
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
      size: 3,
      buffer: Buffer.from('pdf'),
    };

    await controller.uploadFile(auth, upload);

    expect(auditLogService.recordDurable).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        action: 'file.upload',
        resourceType: 'file',
        resourceName: 'report.pdf',
        metadata: expect.objectContaining({ phase: 'requested', size: 3 }),
      }),
    );
    expect(filesService.uploadFile).toHaveBeenCalledWith(
      auth,
      'report.pdf',
      upload.buffer,
      'application/pdf',
    );
  });

  it('does not upload bytes when durable audit acceptance fails', async () => {
    auditLogService.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));

    await expect(
      controller.uploadFile(auth, {
        fieldname: 'file',
        originalname: 'report.pdf',
        mimetype: 'application/pdf',
        size: 3,
        buffer: Buffer.from('pdf'),
      }),
    ).rejects.toThrow('audit outbox unavailable');

    expect(filesService.uploadFile).not.toHaveBeenCalled();
  });

  it('does not read or release download bytes when durable audit acceptance fails', async () => {
    auditLogService.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));
    const response = { set: vi.fn() };

    await expect(
      controller.downloadFile(auth, { id: 'file-1' }, response as never),
    ).rejects.toThrow('audit outbox unavailable');

    expect(filesService.getFileById).toHaveBeenCalledWith(auth, 'file-1');
    expect(filesService.downloadFile).not.toHaveBeenCalled();
    expect(response.set).not.toHaveBeenCalled();
  });

  it('does not delete object bytes or metadata when durable audit acceptance fails', async () => {
    auditLogService.recordDurable.mockRejectedValue(new Error('audit outbox unavailable'));

    await expect(controller.deleteFile(auth, { id: 'file-1' })).rejects.toThrow(
      'audit outbox unavailable',
    );

    expect(filesService.getFileById).toHaveBeenCalledWith(auth, 'file-1');
    expect(filesService.deleteFile).not.toHaveBeenCalled();
  });
});
