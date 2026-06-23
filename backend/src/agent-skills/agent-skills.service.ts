import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import AdmZip from 'adm-zip';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { AgentSkillRecord } from '../database/schema';
import {
  discoverWorkspaceAgentSkills,
  mergeSkillFilesForResponse,
  normalizeSkillBundle,
  parseSkillBundlesFromZipEntries,
  readDiscoveredSkillBundle,
} from './agent-skill-bundle';
import type {
  AgentSkillBatchItem,
  AgentSkillResponse,
  CreateAgentSkillDto,
  DiscoveredAgentSkillResponse,
  ImportAgentSkillsResultResponse,
  ImportDiscoveredAgentSkillsDto,
  UpdateAgentSkillDto,
} from './dto/agent-skills.dto';
import { AgentSkillsRepository } from './agent-skills.repository';

@Injectable()
export class AgentSkillsService {
  constructor(private readonly repository: AgentSkillsRepository) {}

  private mapToResponse(record: AgentSkillRecord): AgentSkillResponse {
    const files = mergeSkillFilesForResponse(record);
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      slug: record.slug,
      description: record.description,
      content: record.content,
      files,
      fileCount: Object.keys(files).length,
      tags: record.tags ?? [],
      enabled: record.enabled,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async listSkills(auth: AuthContext | null, enabledOnly = false): Promise<AgentSkillResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const rows = enabledOnly
      ? await this.repository.listEnabledByOrganization(organizationId)
      : await this.repository.listByOrganization(organizationId);
    return rows.map((row) => this.mapToResponse(row));
  }

  async discoverSkills(auth: AuthContext | null): Promise<DiscoveredAgentSkillResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const discovered = await discoverWorkspaceAgentSkills();
    const existing = await this.repository.findBySlugs(
      discovered.map((item) => item.slug),
      organizationId,
    );
    const existingBySlug = new Map(existing.map((row) => [row.slug, row]));

    return discovered.map((item) => {
      const match = existingBySlug.get(item.slug);
      return {
        ...item,
        imported: Boolean(match),
        existingSkillId: match?.id,
      };
    });
  }

  async importDiscoveredSkills(
    auth: AuthContext | null,
    body: ImportDiscoveredAgentSkillsDto,
  ): Promise<ImportAgentSkillsResultResponse> {
    const organizationId = requireOrganizationId(auth);
    const overwrite = body.overwrite ?? false;
    const imported: AgentSkillResponse[] = [];
    const skipped: Array<{ slug: string; reason: string }> = [];

    for (const item of body.items) {
      try {
        const bundle = await readDiscoveredSkillBundle(item.sourceRoot, item.slug);
        const existingRows = await this.repository.findBySlugs([bundle.slug], organizationId);
        const existing = existingRows[0];

        if (existing && !overwrite) {
          skipped.push({ slug: bundle.slug, reason: 'Already imported' });
          continue;
        }

        const record = existing
          ? await this.repository.update(existing.id, organizationId, {
              name: bundle.name,
              slug: bundle.slug,
              description: bundle.description,
              content: bundle.content,
              files: bundle.files,
              tags: bundle.tags,
            })
          : await this.repository.create({
              organizationId,
              name: bundle.name,
              slug: bundle.slug,
              description: bundle.description,
              content: bundle.content,
              files: bundle.files,
              tags: bundle.tags,
              enabled: true,
              createdBy: auth?.userId ?? null,
            });

        imported.push(this.mapToResponse(record));
      } catch (error) {
        skipped.push({
          slug: item.slug,
          reason: error instanceof Error ? error.message : 'Import failed',
        });
      }
    }

    return { imported, skipped };
  }

  async importSkillZip(
    auth: AuthContext | null,
    zipBuffer: Buffer,
    overwrite = false,
  ): Promise<ImportAgentSkillsResultResponse> {
    const organizationId = requireOrganizationId(auth);
    const zip = new AdmZip(zipBuffer);
    const bundles = parseSkillBundlesFromZipEntries(
      zip.getEntries().map((entry) => ({
        entryName: entry.entryName,
        getData: () => entry.getData(),
      })),
    );

    if (bundles.length === 0) {
      throw new ConflictException('Zip did not contain any valid skill folders with SKILL.md');
    }

    const imported: AgentSkillResponse[] = [];
    const skipped: Array<{ slug: string; reason: string }> = [];

    for (const bundle of bundles) {
      try {
        const existingRows = await this.repository.findBySlugs([bundle.slug], organizationId);
        const existing = existingRows[0];
        if (existing && !overwrite) {
          skipped.push({ slug: bundle.slug, reason: 'Already imported' });
          continue;
        }

        const record = existing
          ? await this.repository.update(existing.id, organizationId, {
              name: bundle.name,
              slug: bundle.slug,
              description: bundle.description,
              content: bundle.content,
              files: bundle.files,
              tags: bundle.tags,
            })
          : await this.repository.create({
              organizationId,
              name: bundle.name,
              slug: bundle.slug,
              description: bundle.description,
              content: bundle.content,
              files: bundle.files,
              tags: bundle.tags,
              enabled: true,
              createdBy: auth?.userId ?? null,
            });

        imported.push(this.mapToResponse(record));
      } catch (error) {
        skipped.push({
          slug: bundle.slug,
          reason: error instanceof Error ? error.message : 'Import failed',
        });
      }
    }

    return { imported, skipped };
  }

  async getSkill(auth: AuthContext | null, id: string): Promise<AgentSkillResponse> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.repository.findById(id, organizationId);
    if (!record) {
      throw new NotFoundException(`Agent skill ${id} not found`);
    }
    return this.mapToResponse(record);
  }

  async createSkill(auth: AuthContext | null, body: CreateAgentSkillDto): Promise<AgentSkillResponse> {
    const organizationId = requireOrganizationId(auth);
    const bundle = normalizeSkillBundle({
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      content: body.content,
      files: body.files,
      tags: body.tags,
    });
    const record = await this.repository.create({
      organizationId,
      name: bundle.name,
      slug: bundle.slug,
      description: bundle.description,
      content: bundle.content,
      files: bundle.files,
      tags: bundle.tags,
      enabled: body.enabled ?? true,
      createdBy: auth?.userId ?? null,
    });
    return this.mapToResponse(record);
  }

  async updateSkill(
    auth: AuthContext | null,
    id: string,
    body: UpdateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    const organizationId = requireOrganizationId(auth);
    const existing = await this.repository.findById(id, organizationId);
    if (!existing) {
      throw new NotFoundException(`Agent skill ${id} not found`);
    }

    const updateData: {
      name?: string;
      slug?: string;
      description?: string | null;
      content?: string;
      files?: Record<string, string>;
      tags?: string[];
      enabled?: boolean;
    } = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    if (body.files !== undefined || body.content !== undefined) {
      const bundle = normalizeSkillBundle({
        slug: body.slug ?? existing.slug,
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        content: body.content ?? existing.content,
        files: body.files ?? mergeSkillFilesForResponse(existing),
        tags: body.tags ?? existing.tags ?? [],
      });
      updateData.name = bundle.name;
      updateData.slug = bundle.slug;
      updateData.description = bundle.description;
      updateData.content = bundle.content;
      updateData.files = bundle.files;
      updateData.tags = bundle.tags;
    }

    const record = await this.repository.update(id, organizationId, updateData);
    return this.mapToResponse(record);
  }

  async deleteSkill(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    await this.repository.delete(id, organizationId);
  }

  async batchGetSkills(
    organizationId: string,
    ids: string[],
  ): Promise<AgentSkillBatchItem[]> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const rows = await this.repository.findByIds(uniqueIds, organizationId);
    return rows
      .filter((row) => row.enabled)
      .map((row) => {
        const files = mergeSkillFilesForResponse(row);
        return {
          id: row.id,
          slug: row.slug,
          content: row.content,
          files,
        };
      });
  }
}
