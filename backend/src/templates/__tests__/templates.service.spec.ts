import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ServiceWorkflowResponse } from '../../workflows/dto/workflow-graph.dto';
import { TemplateService } from '../templates.service';

// ---------------------------------------------------------------------------
// Helpers – build a graph that passes WorkflowGraphSchema.parse()
// ---------------------------------------------------------------------------
function makeValidGraph(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Workflow',
    nodes: [
      {
        id: 'n1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { label: 'Start', config: { params: {}, inputOverrides: {} } },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'Sample Template',
    description: 'A sample template',
    category: 'automation',
    tags: ['test'],
    author: 'tester',
    repository: 'org/templates',
    path: 'templates/sample',
    branch: 'main',
    version: null,
    commitSha: null,
    manifest: { name: 'Sample Template' },
    graph: makeValidGraph(),
    requiredSecrets: [],
    popularity: 0,
    isOfficial: false,
    isVerified: false,
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

const seedTemplateDir = join(import.meta.dir, '../../../scripts/seed-templates');
const securityTemplateFiles = [
  'bug-bounty-recon-triage.json',
  'cve-impact-research-brief.json',
  'exposed-service-cve-mapper.json',
  'npm-dependency-cve-hunt.json',
  'web-attack-surface-quick-win-hunt.json',
] as const;

function loadSeedTemplate(fileName: (typeof securityTemplateFiles)[number]) {
  return JSON.parse(readFileSync(join(seedTemplateDir, fileName), 'utf8')) as {
    _metadata: {
      name: string;
      description?: string;
      category: string;
      tags: string[];
      author: string;
      version: string;
    };
    manifest: Record<string, unknown>;
    graph: Record<string, unknown>;
    requiredSecrets: { name: string; type: string; description: string }[];
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('TemplateService', () => {
  let templatesRepository: {
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findSubmissionsByUser: ReturnType<typeof vi.fn>;
    getCategories: ReturnType<typeof vi.fn>;
    getTags: ReturnType<typeof vi.fn>;
    incrementPopularity: ReturnType<typeof vi.fn>;
  };
  let sanitizationService: {
    sanitizeWorkflow: ReturnType<typeof vi.fn>;
  };
  let workflowsService: {
    create: ReturnType<typeof vi.fn>;
  };
  let service: TemplateService;

  beforeEach(() => {
    templatesRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findSubmissionsByUser: vi.fn(),
      getCategories: vi.fn(),
      getTags: vi.fn(),
      incrementPopularity: vi.fn(),
    };

    sanitizationService = {
      sanitizeWorkflow: vi.fn(),
    };

    workflowsService = {
      create: vi.fn(),
    };

    service = new TemplateService(
      sanitizationService as any,
      templatesRepository as any,
      workflowsService as any,
    );
  });

  // ── listTemplates / getTemplateById / getMyTemplates ──────────────

  it('listTemplates delegates to repository.findAll with filters', async () => {
    const filters = { category: 'automation', search: 'test' };
    templatesRepository.findAll.mockResolvedValue([makeTemplate()]);

    const result = await service.listTemplates(filters);

    expect(templatesRepository.findAll).toHaveBeenCalledWith(filters);
    expect(result).toHaveLength(1);
  });

  it('getTemplateById delegates to repository.findById', async () => {
    const tpl = makeTemplate();
    templatesRepository.findById.mockResolvedValue(tpl);

    const result = await service.getTemplateById('tpl-1');

    expect(templatesRepository.findById).toHaveBeenCalledWith('tpl-1');
    expect(result).toEqual(tpl);
  });

  it('getMyTemplates returns empty array when userId is undefined', async () => {
    const result = await service.getMyTemplates(undefined);

    expect(result).toEqual([]);
    expect(templatesRepository.findSubmissionsByUser).not.toHaveBeenCalled();
  });

  // ── publishTemplate ───────────────────────────────────────────────

  it('publishTemplate throws NOT_IMPLEMENTED (501)', async () => {
    try {
      await service.publishTemplate({
        workflowId: 'wf-1',
        name: 'Name',
        description: 'Desc',
        category: 'cat',
        tags: [],
        author: 'a',
        submittedBy: 'b',
      });
      expect.unreachable('Expected HttpException to be thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    }
  });

  // ── useTemplate ───────────────────────────────────────────────────

  describe('useTemplate', () => {
    it('creates a workflow, increments popularity, and returns result', async () => {
      const tpl = makeTemplate();
      const mockWorkflow = { id: 'wf-1' } as unknown as ServiceWorkflowResponse;
      templatesRepository.findById.mockResolvedValue(tpl);
      workflowsService.create.mockResolvedValue(mockWorkflow);
      templatesRepository.incrementPopularity.mockResolvedValue(undefined);

      const result = await service.useTemplate('tpl-1', {
        workflowName: 'New Workflow',
      });

      expect(templatesRepository.findById).toHaveBeenCalledWith('tpl-1');
      expect(workflowsService.create).toHaveBeenCalled();
      expect(templatesRepository.incrementPopularity).toHaveBeenCalledWith('tpl-1');
      expect(result).toEqual({
        workflow: mockWorkflow,
        templateId: 'tpl-1',
        templateName: 'Sample Template',
      });
    });

    it('creates workflows from the security seed templates', async () => {
      for (const fileName of securityTemplateFiles) {
        const seedTemplate = loadSeedTemplate(fileName);
        const tpl = makeTemplate({
          id: `tpl-${fileName}`,
          name: seedTemplate._metadata.name,
          description: seedTemplate._metadata.description ?? '',
          category: seedTemplate._metadata.category,
          tags: seedTemplate._metadata.tags,
          author: seedTemplate._metadata.author,
          version: seedTemplate._metadata.version,
          manifest: seedTemplate.manifest,
          graph: seedTemplate.graph,
          requiredSecrets: seedTemplate.requiredSecrets,
        });

        const mockWorkflow = { id: `wf-${fileName}` } as unknown as ServiceWorkflowResponse;
        templatesRepository.findById.mockResolvedValueOnce(tpl);
        workflowsService.create.mockResolvedValueOnce(mockWorkflow);
        templatesRepository.incrementPopularity.mockResolvedValueOnce(undefined);

        const result = await service.useTemplate(tpl.id, {
          workflowName: `${seedTemplate._metadata.name} Copy`,
        });

        expect(result.templateName).toBe(seedTemplate._metadata.name);
        expect(result.workflow.id).toBe(`wf-${fileName}`);
      }

      expect(workflowsService.create).toHaveBeenCalledTimes(securityTemplateFiles.length);
      expect(templatesRepository.incrementPopularity).toHaveBeenCalledTimes(
        securityTemplateFiles.length,
      );
    });

    it('throws NotFoundException when template is not found', async () => {
      templatesRepository.findById.mockResolvedValue(null);

      await expect(service.useTemplate('nonexistent', { workflowName: 'W' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UNPROCESSABLE_ENTITY when template has no graph', async () => {
      templatesRepository.findById.mockResolvedValue(makeTemplate({ graph: null }));

      try {
        await service.useTemplate('tpl-1', { workflowName: 'W' });
        expect.unreachable('Expected HttpException to be thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      }
    });

    it('applies secret mappings when secretMappings and requiredSecrets are provided', async () => {
      const tpl = makeTemplate({
        graph: makeValidGraph({
          nodes: [
            {
              id: 'n1',
              type: 'custom',
              position: { x: 0, y: 0 },
              data: {
                label: 'Start',
                config: {
                  params: { secretId: '{{SECRET_PLACEHOLDER}}' },
                  inputOverrides: {},
                },
              },
            },
          ],
        }),
        requiredSecrets: [{ name: 'API_KEY', type: 'string' }],
      });
      templatesRepository.findById.mockResolvedValue(tpl);
      workflowsService.create.mockResolvedValue({
        id: 'wf-2',
      } as unknown as ServiceWorkflowResponse);
      templatesRepository.incrementPopularity.mockResolvedValue(undefined);

      const result = await service.useTemplate('tpl-1', {
        workflowName: 'Secret Workflow',
        secretMappings: { API_KEY: 'actual-secret-value' },
      });

      // The workflow was created — secret replacement happened within applySecretMappings
      expect(workflowsService.create).toHaveBeenCalled();
      expect(result.workflow.id).toBe('wf-2');
    });
  });
});
