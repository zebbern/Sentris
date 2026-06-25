import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray } from 'drizzle-orm';

import { getPostgresErrorCode, PG_ERROR } from '../common/postgres-error';
import { DRIZZLE_TOKEN } from '../database/database.module';
import { agentSkills, type AgentSkillRecord, type NewAgentSkillRecord } from '../database/schema';

import type { AgentSkillFileMap } from '../database/schema';

export interface AgentSkillUpdateData {
  name?: string;
  slug?: string;
  description?: string | null;
  content?: string;
  files?: AgentSkillFileMap;
  tags?: string[];
  enabled?: boolean;
}

@Injectable()
export class AgentSkillsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listByOrganization(organizationId: string): Promise<AgentSkillRecord[]> {
    return this.db
      .select()
      .from(agentSkills)
      .where(eq(agentSkills.organizationId, organizationId))
      .orderBy(agentSkills.name);
  }

  async listEnabledByOrganization(organizationId: string): Promise<AgentSkillRecord[]> {
    return this.db
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.organizationId, organizationId), eq(agentSkills.enabled, true)))
      .orderBy(agentSkills.name);
  }

  async findById(id: string, organizationId: string): Promise<AgentSkillRecord | null> {
    const rows = await this.db
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.id, id), eq(agentSkills.organizationId, organizationId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIds(ids: string[], organizationId: string): Promise<AgentSkillRecord[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(agentSkills)
      .where(and(inArray(agentSkills.id, ids), eq(agentSkills.organizationId, organizationId)));
  }

  async findBySlugs(slugs: string[], organizationId: string): Promise<AgentSkillRecord[]> {
    if (slugs.length === 0) return [];
    return this.db
      .select()
      .from(agentSkills)
      .where(and(inArray(agentSkills.slug, slugs), eq(agentSkills.organizationId, organizationId)));
  }

  async create(data: NewAgentSkillRecord): Promise<AgentSkillRecord> {
    try {
      const rows = await this.db.insert(agentSkills).values(data).returning();
      return rows[0]!;
    } catch (error) {
      if (getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION) {
        throw new ConflictException(`Agent skill slug "${data.slug}" already exists`);
      }
      throw error;
    }
  }

  async update(
    id: string,
    organizationId: string,
    data: AgentSkillUpdateData,
  ): Promise<AgentSkillRecord> {
    try {
      const rows = await this.db
        .update(agentSkills)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(agentSkills.id, id), eq(agentSkills.organizationId, organizationId)))
        .returning();
      if (!rows[0]) {
        throw new NotFoundException(`Agent skill ${id} not found`);
      }
      return rows[0];
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION) {
        throw new ConflictException('Agent skill slug already exists for this organization');
      }
      throw error;
    }
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const rows = await this.db
      .delete(agentSkills)
      .where(and(eq(agentSkills.id, id), eq(agentSkills.organizationId, organizationId)))
      .returning({ id: agentSkills.id });
    if (!rows[0]) {
      throw new NotFoundException(`Agent skill ${id} not found`);
    }
  }
}
