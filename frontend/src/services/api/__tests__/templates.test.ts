import { afterEach, beforeEach, describe, expect, it, vi, mock } from 'bun:test';

const fetchMock = vi.fn();

mock.module('@/services/api/client', () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
  API_V1_URL: 'http://localhost:3211/api/v1',
}));

import { templatesApi } from '../templates';

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('templatesApi.revalidate', () => {
  it('posts to the template revalidation endpoint', async () => {
    const response = {
      auditId: 'audit-1',
      templateId: 'tpl-1',
      templateName: 'Network Recon Scan',
      status: 'started' as const,
      command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
      outputDir: '.cache/template-revalidations/audit-1',
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await templatesApi.revalidate('tpl-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3211/api/v1/templates/tpl-1/revalidate',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(result).toEqual(response);
  });

  it('throws the backend error message when revalidation fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Template not found' }),
    });

    await expect(templatesApi.revalidate('missing-template')).rejects.toThrow('Template not found');
  });
});

describe('templatesApi.getRepoInfo', () => {
  it('fetches template repository metadata', async () => {
    const response = {
      owner: 'acme',
      repo: 'security-templates',
      branch: 'main',
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await templatesApi.getRepoInfo();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3211/api/v1/templates/repo-info', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(result).toEqual(response);
  });
});

describe('templatesApi.getRevalidationJob', () => {
  it('fetches a template revalidation job status', async () => {
    const response = {
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await templatesApi.getRevalidationJob(
      'template-revalidation-00000000-0000-4000-8000-000000000000',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3211/api/v1/templates/revalidations/template-revalidation-00000000-0000-4000-8000-000000000000',
      {
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(result).toEqual(response);
  });
});

describe('templatesApi.listRevalidationJobs', () => {
  it('fetches recent template revalidation jobs with a limit', async () => {
    const response = [
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await templatesApi.listRevalidationJobs(5);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3211/api/v1/templates/revalidations?limit=5',
      {
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(result).toEqual(response);
  });
});

describe('templatesApi.getRevalidationJobLog', () => {
  it('fetches a bounded template revalidation log tail', async () => {
    const response = {
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
      stream: 'stderr' as const,
      content: 'failed to run template audit',
      bytes: 28,
      maxBytes: 4096,
      truncated: false,
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await templatesApi.getRevalidationJobLog(
      'template-revalidation-00000000-0000-4000-8000-000000000001',
      { stream: 'stderr', maxBytes: 4096 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3211/api/v1/templates/revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/log?stream=stderr&maxBytes=4096',
      {
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(result).toEqual(response);
  });
});
