import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { TemplatesConfig } from '../config';
import type { TemplateManifest } from '../database/schema/templates';
import { TemplatesRepository } from './templates.repository';
import { WorkflowSanitizationService } from './workflow-sanitization.service';

const CommunityAuthorSchema = z.object({
  displayName: z.string().min(1),
  githubLogin: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
});

const CommunityCatalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  author: CommunityAuthorSchema,
  bannerUrl: z.string().url().optional(),
  stats: z
    .object({
      nodeCount: z.number().int().nonnegative().optional(),
      setupLevel: z.enum(['no-setup', 'needs-secrets', 'needs-tools']).optional(),
    })
    .optional(),
  license: z.string().min(1).optional(),
  reviewed: z.boolean().optional(),
  templatePath: z.string().min(1),
  htmlUrl: z.string().url(),
});

const CommunityCatalogSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  templates: z.array(CommunityCatalogEntrySchema),
});

type CommunityCatalogEntry = z.infer<typeof CommunityCatalogEntrySchema>;

interface TemplateJson {
  _metadata: {
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    author?: string;
    version?: string;
  };
  manifest?: Record<string, unknown>;
  graph: Record<string, unknown>;
  requiredSecrets?: { name: string; type: string; description?: string }[];
}

/**
 * Imports a published community template from the public GitHub catalog on main.
 * Re-fetches index + template.json server-side; never trusts a FE-supplied graph.
 */
@Injectable()
export class CommunityImportService {
  private readonly logger = new Logger(CommunityImportService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly templatesRepository: TemplatesRepository,
    private readonly sanitizationService: WorkflowSanitizationService,
  ) {}

  async importCommunityTemplate(params: { id?: string; templatePath?: string }) {
    const entry = await this.resolveCatalogEntry(params);
    this.assertSafeTemplatePath(entry.templatePath);

    const rawUrl = this.buildRawTemplateUrl(entry.templatePath);
    const content = await this.fetchText(rawUrl, 'community template');
    const template = this.parseTemplateJson(content, entry.templatePath);

    const { sanitizedGraph } = this.sanitizationService.sanitizeWorkflow(template.graph);
    const validation = this.validateImportedGraph(sanitizedGraph);
    if (!validation.valid) {
      throw new HttpException(
        {
          message: 'Community template graph failed validation',
          errors: validation.errors,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const author =
      template._metadata.author?.trim() ||
      entry.author.displayName ||
      entry.author.githubLogin ||
      'community';

    const manifest: TemplateManifest = (template.manifest as TemplateManifest) || {
      name: template._metadata.name,
      description: template._metadata.description ?? entry.description,
      version: template._metadata.version,
      author,
      category: template._metadata.category ?? entry.category,
      tags: template._metadata.tags ?? entry.tags,
    };

    const { owner, repo, branch } = this.resolveRepoFromIndexUrl();
    const persisted = await this.templatesRepository.upsert({
      name: template._metadata.name || entry.name,
      description: template._metadata.description ?? entry.description,
      category: template._metadata.category || entry.category || 'other',
      tags: template._metadata.tags || entry.tags || [],
      author,
      repository: `${owner}/${repo}`,
      path: entry.templatePath,
      branch,
      version: template._metadata.version,
      manifest,
      graph: sanitizedGraph,
      requiredSecrets: template.requiredSecrets ?? [],
      isOfficial: false,
      isVerified: entry.reviewed === true,
      isActive: true,
    });

    this.logger.log(
      `Imported community template "${persisted.name}" (${persisted.id}) from ${entry.templatePath}`,
    );

    return persisted;
  }

  private async resolveCatalogEntry(params: {
    id?: string;
    templatePath?: string;
  }): Promise<CommunityCatalogEntry> {
    const indexUrl = this.getIndexUrl();
    this.assertAllowedRawGithubUrl(indexUrl);

    const indexText = await this.fetchText(indexUrl, 'community catalog index');
    let parsed: unknown;
    try {
      parsed = JSON.parse(indexText);
    } catch {
      throw new HttpException('Community catalog index is not valid JSON', HttpStatus.BAD_GATEWAY);
    }

    const catalog = CommunityCatalogSchema.safeParse(parsed);
    if (!catalog.success) {
      throw new HttpException(
        'Community catalog index failed schema validation',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const entry = catalog.data.templates.find((item) => {
      if (params.id && item.id === params.id) return true;
      if (params.templatePath && item.templatePath === params.templatePath) return true;
      return false;
    });

    if (!entry) {
      throw new NotFoundException('Community template not found in published catalog');
    }

    return entry;
  }

  private parseTemplateJson(content: string, path: string): TemplateJson {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new BadRequestException(`Community template is not valid JSON: ${path}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException(`Community template has invalid shape: ${path}`);
    }

    const template = parsed as TemplateJson;
    if (!template._metadata?.name) {
      throw new BadRequestException(`Community template missing _metadata.name: ${path}`);
    }
    if (!template.graph || typeof template.graph !== 'object') {
      throw new BadRequestException(`Community template missing graph: ${path}`);
    }

    return template;
  }

  private validateImportedGraph(graph: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!graph.nodes || !Array.isArray(graph.nodes)) {
      errors.push('Graph must have a nodes array');
    }
    if (!graph.edges || !Array.isArray(graph.edges)) {
      errors.push('Graph must have an edges array');
    }

    if (Array.isArray(graph.nodes)) {
      for (const node of graph.nodes) {
        if (typeof node !== 'object' || node === null) {
          errors.push('All nodes must be objects');
          continue;
        }
        if (!('id' in node)) {
          errors.push('Node missing required field: id');
        }
        if (!('type' in node) && !('componentId' in node)) {
          errors.push(`Node ${(node as { id?: string }).id || 'unknown'} missing type/componentId`);
        }
      }
    }

    const graphStr = JSON.stringify(graph);
    for (const pattern of ['{{secret:', '{{secrets.', 'connectionType.secret']) {
      if (graphStr.includes(pattern)) {
        errors.push(`Graph still contains secret references: ${pattern}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private getIndexUrl(): string {
    return this.configService.get<TemplatesConfig>('templates')!.community.indexUrl;
  }

  private resolveRepoFromIndexUrl(): { owner: string; repo: string; branch: string } {
    const indexUrl = this.getIndexUrl();
    const url = new URL(indexUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 3) {
      throw new BadRequestException('Invalid community catalog index URL');
    }
    return { owner: parts[0], repo: parts[1], branch: parts[2] };
  }

  private buildRawTemplateUrl(templatePath: string): string {
    const { owner, repo, branch } = this.resolveRepoFromIndexUrl();
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${templatePath}`;
  }

  private assertSafeTemplatePath(templatePath: string): void {
    if (
      !templatePath.startsWith('community/template/') ||
      templatePath.includes('..') ||
      templatePath.includes('\\') ||
      !templatePath.endsWith('.json')
    ) {
      throw new BadRequestException('Invalid community templatePath');
    }
  }

  private assertAllowedRawGithubUrl(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid community catalog URL');
    }

    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com') {
      throw new BadRequestException('Community catalog URL host is not allowed');
    }
  }

  private async fetchText(url: string, label: string): Promise<string> {
    this.assertAllowedRawGithubUrl(url);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn(`Failed to fetch ${label}: ${url}`, error);
      throw new HttpException(`Failed to fetch ${label}`, HttpStatus.BAD_GATEWAY);
    }

    if (response.status === 404) {
      throw new NotFoundException(`${label} not found`);
    }
    if (!response.ok) {
      throw new HttpException(
        `Failed to fetch ${label}: ${response.status}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    return response.text();
  }
}
