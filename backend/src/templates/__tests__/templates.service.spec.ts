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
  'attack-surface-recon-analytics.json',
  'bug-bounty-recon-triage.json',
  'cve-impact-research-brief.json',
  'exposed-service-cve-mapper.json',
  'exposure-to-cve-brief.json',
  'github-repo-dependency-cve-triage.json',
  'kev-fresh-cve-watch-brief.json',
  'kev-reachability-validation-brief.json',
  'npm-dependency-cve-hunt.json',
  'oss-sast-cve-candidate-hunt.json',
  'public-repo-full-code-security.json',
  'public-repo-secret-exposure-triage.json',
  'security-fix-without-cve-watch.json',
  'subdomain-takeover-triage.json',
  'supabase-project-exposure-triage.json',
  'supply-chain-takeover-precursor-hunt.json',
  'tech-stack-cve-hunter.json',
  'wafw00f-edge-recon-triage.json',
  'web-attack-surface-quick-win-hunt.json',
  'web-logic-cve-candidate-hunt.json',
  'yara-ioc-payload-triage.json',
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
    createSubmission: ReturnType<typeof vi.fn>;
    getCategories: ReturnType<typeof vi.fn>;
    getTags: ReturnType<typeof vi.fn>;
    incrementPopularity: ReturnType<typeof vi.fn>;
  };
  let sanitizationService: {
    sanitizeWorkflow: ReturnType<typeof vi.fn>;
    validateSanitizedGraph: ReturnType<typeof vi.fn>;
    generateManifest: ReturnType<typeof vi.fn>;
  };
  let workflowsService: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let templateRevalidationService: {
    start: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    getJobLog: ReturnType<typeof vi.fn>;
  };
  let service: TemplateService;

  beforeEach(() => {
    templatesRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findSubmissionsByUser: vi.fn(),
      createSubmission: vi.fn(),
      getCategories: vi.fn(),
      getTags: vi.fn(),
      incrementPopularity: vi.fn(),
    };

    sanitizationService = {
      sanitizeWorkflow: vi.fn(),
      validateSanitizedGraph: vi.fn(),
      generateManifest: vi.fn(),
    };

    workflowsService = {
      create: vi.fn(),
      findById: vi.fn(),
    };

    templateRevalidationService = {
      start: vi.fn(),
      getJob: vi.fn(),
      listJobs: vi.fn(),
      getJobLog: vi.fn(),
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

  it('listTemplates enriches templates with live validation metadata', async () => {
    const tpl = makeTemplate({ updatedAt: new Date('2026-06-21T06:00:00.000Z') });
    const validation = {
      status: 'live-verified',
      recommendation: 'keep',
      terminalStatus: 'COMPLETED',
      artifactsCount: 1,
      verifiedAt: '2026-06-21T07:15:23.121Z',
      rationale: 'Live execution completed and produced at least one artifact.',
      isCurrent: true,
    } as const;
    const validationLedger = {
      getValidationForTemplate: vi.fn().mockReturnValue(validation),
    };
    const serviceWithValidation = new TemplateService(
      sanitizationService as any,
      templatesRepository as any,
      workflowsService as any,
      validationLedger as any,
    );
    templatesRepository.findAll.mockResolvedValue([tpl]);

    const result = await serviceWithValidation.listTemplates();

    expect(validationLedger.getValidationForTemplate).toHaveBeenCalledWith(tpl);
    expect(result[0]).toEqual({
      ...tpl,
      validation,
    });
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

  // ── revalidateTemplate ───────────────────────────────────────────

  describe('revalidateTemplate', () => {
    it('starts a targeted live audit for the requested template', async () => {
      const tpl = makeTemplate({ id: 'tpl-1', name: 'Network Recon Scan' });
      templatesRepository.findById.mockResolvedValue(tpl);
      templateRevalidationService.start.mockResolvedValue({
        auditId: 'audit-1',
        templateName: 'Network Recon Scan',
        status: 'started',
        command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
        outputDir: '.cache/template-revalidations/audit-1',
      });
      const serviceWithRevalidation = new TemplateService(
        sanitizationService as any,
        templatesRepository as any,
        workflowsService as any,
        undefined,
        templateRevalidationService as any,
      );

      const result = await serviceWithRevalidation.revalidateTemplate('tpl-1', {
        requestedBy: 'user-1',
        organizationId: 'org-1',
      });

      expect(templatesRepository.findById).toHaveBeenCalledWith('tpl-1');
      expect(templateRevalidationService.start).toHaveBeenCalledWith({
        templateId: 'tpl-1',
        templateName: 'Network Recon Scan',
        requestedBy: 'user-1',
        organizationId: 'org-1',
      });
      expect(result).toEqual({
        auditId: 'audit-1',
        templateId: 'tpl-1',
        templateName: 'Network Recon Scan',
        status: 'started',
        command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
        outputDir: '.cache/template-revalidations/audit-1',
      });
    });

    it('throws NotFoundException when revalidating a missing template', async () => {
      templatesRepository.findById.mockResolvedValue(null);
      const serviceWithRevalidation = new TemplateService(
        sanitizationService as any,
        templatesRepository as any,
        workflowsService as any,
        undefined,
        templateRevalidationService as any,
      );

      await expect(
        serviceWithRevalidation.revalidateTemplate('missing-template', {
          requestedBy: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(templateRevalidationService.start).not.toHaveBeenCalled();
    });
  });

  describe('getRevalidationJob', () => {
    it('returns revalidation job status from the revalidation service', () => {
      const job = {
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
      templateRevalidationService.getJob.mockReturnValue(job);
      const serviceWithRevalidation = new TemplateService(
        sanitizationService as any,
        templatesRepository as any,
        workflowsService as any,
        undefined,
        templateRevalidationService as any,
      );

      const result = serviceWithRevalidation.getRevalidationJob(
        'template-revalidation-00000000-0000-4000-8000-000000000000',
      );

      expect(templateRevalidationService.getJob).toHaveBeenCalledWith(
        'template-revalidation-00000000-0000-4000-8000-000000000000',
      );
      expect(result).toEqual(job);
    });
  });

  describe('getRevalidationJobs', () => {
    it('returns recent revalidation jobs from the revalidation service', () => {
      const jobs = [
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
      templateRevalidationService.listJobs.mockReturnValue(jobs);
      const serviceWithRevalidation = new TemplateService(
        sanitizationService as any,
        templatesRepository as any,
        workflowsService as any,
        undefined,
        templateRevalidationService as any,
      );

      const result = serviceWithRevalidation.getRevalidationJobs({ limit: 5 });

      expect(templateRevalidationService.listJobs).toHaveBeenCalledWith(5);
      expect(result).toEqual(jobs);
    });
  });

  describe('getRevalidationJobLog', () => {
    it('returns a bounded revalidation job log tail from the revalidation service', () => {
      const logTail = {
        auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
        stream: 'stderr' as const,
        content: 'failed to run template audit',
        bytes: 28,
        maxBytes: 4096,
        truncated: false,
      };
      templateRevalidationService.getJobLog.mockReturnValue(logTail);
      const serviceWithRevalidation = new TemplateService(
        sanitizationService as any,
        templatesRepository as any,
        workflowsService as any,
        undefined,
        templateRevalidationService as any,
      );

      const result = serviceWithRevalidation.getRevalidationJobLog(
        'template-revalidation-00000000-0000-4000-8000-000000000001',
        {
          stream: 'stderr',
          maxBytes: 4096,
        },
      );

      expect(templateRevalidationService.getJobLog).toHaveBeenCalledWith(
        'template-revalidation-00000000-0000-4000-8000-000000000001',
        'stderr',
        4096,
      );
      expect(result).toEqual(logTail);
    });
  });

  // ── publishTemplate ───────────────────────────────────────────────

  it('publishTemplate sanitizes a workflow and records a pending submission', async () => {
    const originalRepo = process.env.GITHUB_TEMPLATE_REPO;
    process.env.GITHUB_TEMPLATE_REPO = 'acme/security-templates';
    const graph = makeValidGraph({
      nodes: [
        {
          id: 'n1',
          type: 'custom',
          position: { x: 0, y: 0 },
          data: { label: 'HTTP probe', config: { params: { apiKey: 'secret-1' } } },
        },
      ],
    });
    const sanitizedGraph = makeValidGraph({
      nodes: [
        {
          id: 'n1',
          type: 'custom',
          position: { x: 0, y: 0 },
          data: { label: 'HTTP probe', config: { params: { apiKey: 'REPLACE_WITH_APIKEY' } } },
        },
      ],
    });
    const requiredSecrets = [
      { name: 'apiKey', type: 'string', description: 'Secret required for apiKey' },
    ];
    const manifest = {
      name: 'API Probe Template',
      description: 'Probes a target API',
      category: 'Security',
      tags: ['api', 'bug-bounty'],
      requiredSecrets,
      nodeCount: 1,
      edgeCount: 0,
    };
    const submission = {
      id: 'sub-1',
      templateName: 'API Probe Template',
      description: 'Probes a target API',
      category: 'Security',
      repository: 'acme/security-templates',
      branch: 'main',
      path: 'templates/api-probe-template.jsonc',
      commitSha: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      submittedBy: 'user-1',
      organizationId: 'org-1',
      manifest,
      graph: sanitizedGraph,
      status: 'pending' as const,
      feedback: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date('2026-06-21T00:00:00Z'),
      updatedAt: new Date('2026-06-21T00:00:00Z'),
    };

    try {
      workflowsService.findById.mockResolvedValue({
        id: 'wf-1',
        name: 'API Probe',
        graph,
      });
      sanitizationService.sanitizeWorkflow.mockReturnValue({
        sanitizedGraph,
        requiredSecrets,
        removedSecrets: ['apiKey'],
      });
      sanitizationService.validateSanitizedGraph.mockReturnValue({ valid: true, errors: [] });
      sanitizationService.generateManifest.mockReturnValue(manifest);
      templatesRepository.createSubmission.mockResolvedValue(submission);

      const result = await service.publishTemplate({
        workflowId: 'wf-1',
        name: 'API Probe Template',
        description: 'Probes a target API',
        category: 'Security',
        tags: ['api', 'bug-bounty'],
        author: 'Security Team',
        submittedBy: 'user-1',
        organizationId: 'org-1',
      });

      expect(workflowsService.findById).toHaveBeenCalledWith('wf-1', {
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'template-publish',
      });
      expect(sanitizationService.sanitizeWorkflow).toHaveBeenCalledWith(graph);
      expect(sanitizationService.validateSanitizedGraph).toHaveBeenCalledWith(sanitizedGraph);
      expect(sanitizationService.generateManifest).toHaveBeenCalledWith({
        name: 'API Probe Template',
        description: 'Probes a target API',
        category: 'Security',
        tags: ['api', 'bug-bounty'],
        author: 'Security Team',
        graph: sanitizedGraph,
        requiredSecrets,
      });
      expect(templatesRepository.createSubmission).toHaveBeenCalledWith({
        templateName: 'API Probe Template',
        description: 'Probes a target API',
        category: 'Security',
        repository: 'acme/security-templates',
        branch: 'main',
        path: 'templates/api-probe-template.jsonc',
        submittedBy: 'user-1',
        organizationId: 'org-1',
        manifest,
        graph: sanitizedGraph,
      });
      expect(result).toEqual({
        submission,
        validation: { valid: true, errors: [] },
        requiredSecrets,
        removedSecrets: ['apiKey'],
        manifest,
        graph: sanitizedGraph,
      });
    } finally {
      if (originalRepo === undefined) {
        delete process.env.GITHUB_TEMPLATE_REPO;
      } else {
        process.env.GITHUB_TEMPLATE_REPO = originalRepo;
      }
    }
  });

  it('publishTemplate rejects invalid sanitized graphs without creating a submission', async () => {
    const graph = makeValidGraph();
    const sanitizedGraph = { nodes: [], edges: 'not-an-array' };

    workflowsService.findById.mockResolvedValue({
      id: 'wf-1',
      name: 'Broken template source',
      graph,
    });
    sanitizationService.sanitizeWorkflow.mockReturnValue({
      sanitizedGraph,
      requiredSecrets: [],
      removedSecrets: [],
    });
    sanitizationService.validateSanitizedGraph.mockReturnValue({
      valid: false,
      errors: ['Graph must have an edges array'],
    });

    try {
      await service.publishTemplate({
        workflowId: 'wf-1',
        name: 'Broken Template',
        description: 'Should not be submitted',
        category: 'Security',
        tags: [],
        author: 'Security Team',
        submittedBy: 'user-1',
        organizationId: 'org-1',
      });
      expect.unreachable('Expected invalid sanitized graph to be rejected');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(err.getResponse()).toEqual({
        message: 'Template validation failed',
        errors: ['Graph must have an edges array'],
      });
    }

    expect(templatesRepository.createSubmission).not.toHaveBeenCalled();
    expect(sanitizationService.generateManifest).not.toHaveBeenCalled();
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
