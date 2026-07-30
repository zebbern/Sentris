import { afterEach, describe, expect, it, vi } from 'bun:test';
import { HttpException, NotFoundException } from '@nestjs/common';

import { CommunityImportService } from '../community-import.service';

const INDEX_URL =
  'https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/index.json';

const catalog = {
  version: 1 as const,
  updatedAt: '2026-07-30T00:00:00.000Z',
  templates: [
    {
      id: 'demo-passive-lookup',
      name: 'Demo Passive Lookup',
      description: 'Fixture template',
      category: 'recon',
      tags: ['demo'],
      author: { displayName: 'Ada Contributor', githubLogin: 'ada-contrib' },
      reviewed: true,
      templatePath: 'community/template/demo-passive-lookup/template.json',
      htmlUrl:
        'https://github.com/zebbern/Sentris/tree/main/community/template/demo-passive-lookup',
    },
  ],
};

const templateJson = {
  _metadata: {
    name: 'Demo Passive Lookup',
    description: 'Fixture template',
    category: 'recon',
    tags: ['demo'],
    author: 'Ada Contributor',
    version: '1.0.0',
  },
  graph: {
    name: 'Demo Passive Lookup',
    nodes: [{ id: 'trigger_1', type: 'core.workflow.entrypoint', data: { label: 'Start' } }],
    edges: [],
  },
  requiredSecrets: [],
};

describe('CommunityImportService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createService(overrides?: {
    upsert?: ReturnType<typeof vi.fn>;
    sanitizeWorkflow?: ReturnType<typeof vi.fn>;
  }) {
    const configService = {
      get: vi.fn().mockReturnValue({ community: { indexUrl: INDEX_URL } }),
    };
    const upsert =
      overrides?.upsert ??
      vi.fn().mockResolvedValue({
        id: 'tmpl-imported',
        name: 'Demo Passive Lookup',
        isOfficial: false,
      });
    const templatesRepository = { upsert };
    const sanitizeWorkflow =
      overrides?.sanitizeWorkflow ??
      vi.fn().mockImplementation((graph: Record<string, unknown>) => ({
        sanitizedGraph: graph,
        requiredSecrets: [],
        removedSecrets: [],
      }));
    const sanitizationService = { sanitizeWorkflow };

    const service = new CommunityImportService(
      configService as any,
      templatesRepository as any,
      sanitizationService as any,
    );

    return { service, upsert, sanitizeWorkflow };
  }

  it('imports a catalog entry by id and persists a non-official template', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(templateJson), { status: 200 }));

    const { service, upsert, sanitizeWorkflow } = createService();
    const result = await service.importCommunityTemplate({ id: 'demo-passive-lookup' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sanitizeWorkflow).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Demo Passive Lookup',
        path: 'community/template/demo-passive-lookup/template.json',
        repository: 'zebbern/Sentris',
        branch: 'main',
        isOfficial: false,
        isVerified: true,
      }),
    );
    expect(result.id).toBe('tmpl-imported');
  });

  it('rejects unknown catalog ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(catalog), { status: 200 }),
    );

    const { service } = createService();
    await expect(service.importCommunityTemplate({ id: 'missing' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid template paths even if present in a forged payload path', async () => {
    const forged = {
      ...catalog,
      templates: [
        {
          ...catalog.templates[0],
          templatePath: '../secrets/template.json',
        },
      ],
    };
    // Path fails zod? Actually our schema allows any string min 1 - assertSafeTemplatePath catches it
    // But wait - forged path won't match startsWith community/template/
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(forged), { status: 200 }),
    );

    const { service } = createService();
    await expect(
      service.importCommunityTemplate({ id: 'demo-passive-lookup' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
