import { describe, expect, it, vi } from 'bun:test';

import { TemplatesController } from '../templates.controller';

describe('TemplatesController', () => {
  it('delegates template revalidation log requests to TemplateService', async () => {
    const result = {
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
      stream: 'stderr' as const,
      content: 'failed to run template audit',
      bytes: 28,
      maxBytes: 4096,
      truncated: false,
    };
    const templateService = {
      getRevalidationJobLog: vi.fn().mockReturnValue(result),
    };
    const githubSyncService = {};
    const controller = new TemplatesController(templateService as any, githubSyncService as any);

    const response = await controller.getRevalidationJobLog(
      'template-revalidation-00000000-0000-4000-8000-000000000001',
      'stderr',
      '4096',
    );

    expect(templateService.getRevalidationJobLog).toHaveBeenCalledWith(
      'template-revalidation-00000000-0000-4000-8000-000000000001',
      {
        stream: 'stderr',
        maxBytes: 4096,
      },
    );
    expect(response).toEqual(result);
  });

  it('delegates template revalidation history requests to TemplateService', async () => {
    const result = [
      {
        auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
        templateId: 'tpl-1',
        templateName: 'Network Recon Scan',
        requestedBy: 'user-1',
        organizationId: 'org-1',
        status: 'completed' as const,
        command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
        outputDir:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001',
        startedAt: '2026-06-21T06:00:00.000Z',
        outputFiles: {
          marker:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/revalidation-job.json',
          stdout:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/stdout.log',
          stderr:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/stderr.log',
          reportJson:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/template-live-audit.json',
          reportMarkdown:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/template-live-audit.md',
        },
        report: {
          generatedAt: '2026-06-21T06:30:00.000Z',
          resultCount: 1,
          recommendations: ['keep'],
          terminalStatuses: ['COMPLETED'],
        },
      },
    ];
    const templateService = {
      getRevalidationJobs: vi.fn().mockReturnValue(result),
    };
    const githubSyncService = {};
    const controller = new TemplatesController(templateService as any, githubSyncService as any);

    const response = await controller.getRevalidationJobs('5');

    expect(templateService.getRevalidationJobs).toHaveBeenCalledWith({ limit: 5 });
    expect(response).toEqual(result);
  });

  it('delegates template revalidation status requests to TemplateService', async () => {
    const result = {
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000000',
      templateId: 'tpl-1',
      templateName: 'Network Recon Scan',
      requestedBy: 'user-1',
      organizationId: 'org-1',
      status: 'completed' as const,
      command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
      outputDir:
        '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000',
      startedAt: '2026-06-21T06:00:00.000Z',
      outputFiles: {
        marker:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/revalidation-job.json',
        stdout:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/stdout.log',
        stderr:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/stderr.log',
        reportJson:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/template-live-audit.json',
        reportMarkdown:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/template-live-audit.md',
      },
      report: {
        generatedAt: '2026-06-21T06:30:00.000Z',
        resultCount: 1,
        recommendations: ['keep'],
        terminalStatuses: ['COMPLETED'],
      },
    };
    const templateService = {
      getRevalidationJob: vi.fn().mockReturnValue(result),
    };
    const githubSyncService = {};
    const controller = new TemplatesController(templateService as any, githubSyncService as any);

    const response = await controller.getRevalidationJob(
      'template-revalidation-00000000-0000-4000-8000-000000000000',
    );

    expect(templateService.getRevalidationJob).toHaveBeenCalledWith(
      'template-revalidation-00000000-0000-4000-8000-000000000000',
    );
    expect(response).toEqual(result);
  });

  it('delegates template revalidation requests to TemplateService', async () => {
    const result = {
      auditId: 'audit-1',
      templateId: 'tpl-1',
      templateName: 'Network Recon Scan',
      status: 'started' as const,
      command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
      outputDir: '.cache/template-revalidations/audit-1',
    };
    const templateService = {
      revalidateTemplate: vi.fn().mockResolvedValue(result),
    };
    const githubSyncService = {};
    const controller = new TemplatesController(templateService as any, githubSyncService as any);

    const response = await controller.revalidateTemplate('tpl-1', {
      userId: 'user-1',
      organizationId: 'org-1',
    });

    expect(templateService.revalidateTemplate).toHaveBeenCalledWith('tpl-1', {
      requestedBy: 'user-1',
      organizationId: 'org-1',
    });
    expect(response).toEqual(result);
  });
});
