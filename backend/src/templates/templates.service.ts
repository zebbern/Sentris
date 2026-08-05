import {
  BadRequestException,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  describeWorkflowRuntimeInputs,
  WorkflowRuntimeInputDefinitionsSchema,
  workflowRuntimeInputValueSchema,
  type WorkflowRuntimeInputDefinition,
} from '@sentris/shared';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import {
  TemplateValidationLedgerService,
  type TemplateValidationSummary,
} from './template-validation-ledger.service';
import {
  TemplateRevalidationService,
  type TemplateRevalidationJob,
  type TemplateRevalidationJobLog,
  type TemplateRevalidationJobStatus,
} from './template-revalidation.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowGraphSchema } from '../workflows/dto/workflow-graph.dto';
import type { AuthContext } from '../auth/types';
import type { Template, TemplateManifest } from '../database/schema/templates';

/**
 * Templates Service
 * Business logic for template operations
 *
 * Note: PR creation has been removed. The backend now serves templates
 * for browsing only. Users will create PRs through GitHub web flow.
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly sanitizationService: WorkflowSanitizationService,
    private readonly templatesRepository: TemplatesRepository,
    private readonly workflowsService: WorkflowsService,
    @Optional()
    private readonly templateValidationLedger?: TemplateValidationLedgerService,
    @Optional()
    private readonly templateRevalidationService?: TemplateRevalidationService,
  ) {}

  /**
   * List all templates with optional filters
   */
  async listTemplates(filters?: { category?: string; search?: string; tags?: string[] }) {
    const templates = await this.templatesRepository.findAll(filters);
    return templates.map((template) => this.withValidation(template));
  }

  /**
   * Get template by ID
   */
  async getTemplateById(id: string) {
    const template = await this.templatesRepository.findById(id);
    return template ? this.withValidation(template) : null;
  }

  async listTemplateCatalog(
    input: {
      category?: string;
      search?: string;
      tags?: string[];
      requiredComponentIds?: string[];
      limit?: number;
    } = {},
  ) {
    const { limit = 10, requiredComponentIds = [], ...filters } = input;
    const templates = await this.templatesRepository.findAll(filters);
    return templates
      .flatMap((template) => {
        try {
          const { graph, runtimeInputs } = this.buildTemplateGraph(template);
          const componentIds = [...new Set(graph.nodes.map((node) => node.type))];
          if (
            requiredComponentIds.some(
              (requiredComponentId) => !componentIds.includes(requiredComponentId),
            )
          ) {
            return [];
          }
          return [
            {
              id: template.id,
              name: template.name,
              description: template.description,
              category: template.category,
              tags: template.tags ?? [],
              isOfficial: template.isOfficial,
              isVerified: template.isVerified,
              nodeCount: graph.nodes.length,
              edgeCount: graph.edges.length,
              componentIds,
              runtimeInputs: describeWorkflowRuntimeInputs(runtimeInputs),
              requiredSecrets: (template.requiredSecrets ?? []).map((secret) => ({
                name: secret.name,
                type: secret.type,
                ...(secret.description ? { description: secret.description } : {}),
              })),
            },
          ];
        } catch (error: unknown) {
          this.logger.warn(
            `Skipping unusable template ${template.id} in catalog: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      })
      .slice(0, limit);
  }

  /**
   * Get user's submitted templates
   */
  async getMyTemplates(userId: string | undefined) {
    if (!userId) return [];
    return await this.templatesRepository.findSubmissionsByUser(userId);
  }

  /**
   * Get template categories
   */
  async getCategories() {
    return await this.templatesRepository.getCategories();
  }

  /**
   * Get template tags
   */
  async getTags() {
    return await this.templatesRepository.getTags();
  }

  /**
   * Validate and record a workflow as a pending template submission.
   *
   * This does not create a GitHub PR. The frontend GitHub web flow remains
   * responsible for upstream publication; the API keeps a durable, sanitized
   * submission record for review and future tooling.
   */
  async publishTemplate(params: {
    workflowId: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    submittedBy: string;
    organizationId?: string;
  }) {
    const authContext: AuthContext = {
      userId: params.submittedBy || null,
      organizationId: params.organizationId ?? null,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'template-publish',
    };
    const workflow = await this.workflowsService.findById(params.workflowId, authContext);
    const { sanitizedGraph, requiredSecrets, removedSecrets } =
      this.sanitizationService.sanitizeWorkflow(workflow.graph);
    const validation = this.sanitizationService.validateSanitizedGraph(sanitizedGraph);

    if (!validation.valid) {
      throw new HttpException(
        {
          message: 'Template validation failed',
          errors: validation.errors,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const manifest = this.sanitizationService.generateManifest({
      name: params.name,
      description: params.description,
      category: params.category,
      tags: params.tags,
      author: params.author,
      graph: sanitizedGraph,
      requiredSecrets,
    }) as TemplateManifest;
    const submission = await this.templatesRepository.createSubmission({
      templateName: params.name,
      description: params.description,
      category: params.category,
      repository: resolveSubmissionRepository(),
      branch: resolveSubmissionBranch(),
      path: buildTemplateSubmissionPath(params.name),
      submittedBy: params.submittedBy,
      organizationId: params.organizationId,
      manifest,
      graph: sanitizedGraph,
    });

    return {
      submission,
      validation,
      requiredSecrets,
      removedSecrets,
      manifest,
      graph: sanitizedGraph,
    };
  }

  /**
   * Start a targeted live revalidation audit for a template.
   */
  async revalidateTemplate(
    templateId: string,
    params: { requestedBy?: string; organizationId?: string } = {},
  ): Promise<TemplateRevalidationJob & { templateId: string; templateName: string }> {
    const template = await this.templatesRepository.findById(templateId);
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    if (!this.templateRevalidationService) {
      throw new ServiceUnavailableException('Template revalidation is not available');
    }

    const job = await this.templateRevalidationService.start({
      templateId,
      templateName: template.name,
      requestedBy: params.requestedBy,
      organizationId: params.organizationId,
    });

    return {
      ...job,
      templateId,
      templateName: template.name,
    };
  }

  /**
   * Get the latest known status for a targeted live revalidation audit.
   */
  getRevalidationJob(auditId: string): TemplateRevalidationJobStatus {
    if (!this.templateRevalidationService) {
      throw new ServiceUnavailableException('Template revalidation is not available');
    }

    return this.templateRevalidationService.getJob(auditId);
  }

  /**
   * List recent targeted live revalidation audits.
   */
  getRevalidationJobs(params: { limit?: number } = {}): TemplateRevalidationJobStatus[] {
    if (!this.templateRevalidationService) {
      throw new ServiceUnavailableException('Template revalidation is not available');
    }

    return this.templateRevalidationService.listJobs(params.limit);
  }

  /**
   * Get a bounded stdout/stderr tail for a targeted live revalidation audit.
   */
  getRevalidationJobLog(
    auditId: string,
    params: { stream: string; maxBytes?: number },
  ): TemplateRevalidationJobLog {
    if (!this.templateRevalidationService) {
      throw new ServiceUnavailableException('Template revalidation is not available');
    }

    return this.templateRevalidationService.getJobLog(auditId, params.stream, params.maxBytes);
  }

  private buildTemplateGraph(
    template: Template,
    params: {
      workflowName?: string;
      description?: string;
      runtimeInputDefaults?: Record<string, unknown>;
      secretMappings?: Record<string, string>;
    } = {},
  ) {
    if (!template.graph) {
      throw new HttpException(
        'Template does not contain workflow graph data',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let graphData: Record<string, unknown> = {
      ...template.graph,
      name: params.workflowName ?? template.name,
      ...(params.description !== undefined ? { description: params.description } : {}),
    };
    if (Array.isArray(graphData.nodes)) {
      graphData.nodes = (graphData.nodes as Record<string, unknown>[]).map((node, index) =>
        node.position && typeof node.position === 'object'
          ? node
          : { ...node, position: { x: 250, y: index * 150 } },
      );
    }
    if (params.secretMappings && template.requiredSecrets && template.requiredSecrets.length > 0) {
      graphData = this.applySecretMappings(
        graphData,
        params.secretMappings,
        template.requiredSecrets,
      );
    }

    const graph = WorkflowGraphSchema.parse(graphData);
    const entrypoint = graph.nodes.find(
      (node) => node.type === 'core.workflow.entrypoint' || node.type === 'entry-point',
    );
    const runtimeInputs = WorkflowRuntimeInputDefinitionsSchema.parse(
      entrypoint?.data.config.params.runtimeInputs ?? [],
    );
    const runtimeInputDefaults = params.runtimeInputDefaults ?? {};
    const definitionsById = new Map(
      runtimeInputs.map((definition: WorkflowRuntimeInputDefinition) => [
        definition.id,
        definition,
      ]),
    );

    for (const [inputId, value] of Object.entries(runtimeInputDefaults)) {
      const definition = definitionsById.get(inputId);
      if (!definition) {
        throw new BadRequestException(`Unknown template runtime input "${inputId}"`);
      }
      if (definition.type === 'secret') {
        throw new BadRequestException(
          `Secret runtime input "${inputId}" cannot be stored as a template default`,
        );
      }
      if (!workflowRuntimeInputValueSchema(definition.type).safeParse(value).success) {
        throw new BadRequestException(
          `Template runtime input "${inputId}" must be ${definition.type}`,
        );
      }
      definition.defaultValue = value;
    }
    if (entrypoint && Object.keys(runtimeInputDefaults).length > 0) {
      entrypoint.data.config.params.runtimeInputs = runtimeInputs;
    }
    return { graph: WorkflowGraphSchema.parse(graph), runtimeInputs };
  }

  /**
   * Materialize an active template as a validated graph without saving it.
   * This is the canonical preparation boundary shared by product flows that
   * need an exact template snapshot before deciding whether to persist it.
   */
  async materializeTemplateGraph(
    templateId: string,
    params: {
      workflowName?: string;
      description?: string;
      runtimeInputDefaults?: Record<string, unknown>;
      secretMappings?: Record<string, string>;
    } = {},
  ) {
    const template = await this.templatesRepository.findById(templateId);
    if (!template?.isActive) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }
    if (!template.graph) {
      throw new HttpException(
        'Template does not contain workflow graph data',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const { graph, runtimeInputs } = this.buildTemplateGraph(template, params);

    return {
      template,
      graph: WorkflowGraphSchema.parse(graph),
      runtimeInputs,
    };
  }

  /**
   * Use a template to create a new workflow
   *
   * Fetches the template by ID, creates a new workflow from its graph data,
   * names it with the provided workflowName, and increments the template's
   * popularity counter.
   */
  async useTemplate(
    templateId: string,
    params: {
      workflowName: string;
      secretMappings?: Record<string, string>;
      userId?: string;
      organizationId?: string;
    },
  ) {
    const { template, graph: workflowGraph } = await this.materializeTemplateGraph(templateId, {
      workflowName: params.workflowName,
      secretMappings: params.secretMappings,
    });

    const authContext: AuthContext = {
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'template',
    };

    this.logger.log(
      `Creating workflow "${params.workflowName}" from template "${template.name}" (${templateId})`,
    );

    const workflow = await this.workflowsService.create(workflowGraph, authContext);

    await this.templatesRepository.incrementPopularity(templateId);

    this.logger.log(
      `Created workflow ${workflow.id} from template ${templateId}, popularity incremented`,
    );

    return {
      workflow,
      templateId,
      templateName: template.name,
    };
  }

  /**
   * Get template submissions
   */
  async getSubmissions(userId: string) {
    return await this.templatesRepository.findSubmissionsByUser(userId);
  }

  private withValidation<T extends { name: string; updatedAt?: Date | string | null }>(
    template: T,
  ): T & { validation?: TemplateValidationSummary } {
    if (!this.templateValidationLedger) return template;

    return {
      ...template,
      validation: this.templateValidationLedger.getValidationForTemplate(template),
    };
  }

  private applySecretMappings(
    graph: Record<string, unknown>,
    secretMappings: Record<string, string>,
    _requiredSecrets: { name: string; type: string; description?: string; placeholder?: string }[],
  ): Record<string, unknown> {
    if (!secretMappings || Object.keys(secretMappings).length === 0) {
      return graph;
    }

    const result = structuredClone(graph);
    this.traverseAndApplySecrets(result, secretMappings);
    return result;
  }

  private traverseAndApplySecrets(obj: unknown, secretMappings: Record<string, string>): void {
    if (typeof obj !== 'object' || obj === null) return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.traverseAndApplySecrets(item, secretMappings);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    const secretKeys = ['secretId', 'secret_name', 'secretName', 'secretRef', 'secret_ref'];
    for (const key of secretKeys) {
      if (typeof record[key] === 'string') {
        record[key] = this.replaceSecretPlaceholderString(String(record[key]), secretMappings);
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        const replaced = this.replaceSecretPlaceholderString(value, secretMappings);
        if (replaced !== value) {
          record[key] = replaced;
        }
      } else if (typeof value === 'object' && value !== null) {
        this.traverseAndApplySecrets(value, secretMappings);
      }
    }
  }

  private replaceSecretPlaceholderString(
    value: string,
    secretMappings: Record<string, string>,
  ): string {
    if (/\{\{SECRET:[^}]+\}\}/.test(value)) {
      return value.replace(/\{\{SECRET:([^}]+)\}\}/g, (match, secretName: string) => {
        const mapped = secretMappings[secretName.trim()];
        return mapped ?? '';
      });
    }

    if (value.includes('{{SECRET_PLACEHOLDER}}')) {
      const firstAvailable = Object.values(secretMappings)[0];
      if (firstAvailable) {
        return value.replace(/\{\{SECRET_PLACEHOLDER\}\}/g, firstAvailable);
      }
    }

    return value;
  }
}

function resolveSubmissionRepository(): string {
  const repository = process.env.GITHUB_TEMPLATE_REPO?.trim();
  return repository && /^[^/]+\/[^/]+$/.test(repository)
    ? repository
    : 'local/template-submissions';
}

function resolveSubmissionBranch(): string {
  return process.env.GITHUB_TEMPLATE_BRANCH?.trim() || 'main';
}

function buildTemplateSubmissionPath(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `templates/${slug || 'template'}.jsonc`;
}
