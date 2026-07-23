import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { ScopeRecord } from '../database/schema';
import type { CreateScopeDto, ScopeResponse, UpdateScopeDto } from './dto/scopes.dto';
import { ScopesRepository, type ScopeUpdateData } from './scopes.repository';

@Injectable()
export class ScopesService {
  constructor(private readonly repository: ScopesRepository) {}

  private mapToResponse(record: ScopeRecord): ScopeResponse {
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      description: record.description,
      domains: record.domains ?? [],
      repos: record.repos ?? [],
      ipRanges: record.ipRanges ?? [],
      runtimeValues: record.runtimeValues ?? {},
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async listScopes(auth: AuthContext | null): Promise<ScopeResponse[]> {
    const organizationId = requireOrganizationId(auth);
    const rows = await this.repository.listByOrganization(organizationId);
    return rows.map((row) => this.mapToResponse(row));
  }

  async getScope(auth: AuthContext | null, id: string): Promise<ScopeResponse> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.repository.findById(id, organizationId);
    if (!record) {
      throw new NotFoundException(`Scope ${id} not found`);
    }
    return this.mapToResponse(record);
  }

  async createScope(auth: AuthContext | null, body: CreateScopeDto): Promise<ScopeResponse> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.repository.create({
      organizationId,
      name: body.name,
      description: body.description ?? null,
      domains: body.domains,
      repos: body.repos,
      ipRanges: body.ipRanges,
      runtimeValues: body.runtimeValues,
      createdBy: auth?.userId ?? null,
    });
    return this.mapToResponse(record);
  }

  async updateScope(
    auth: AuthContext | null,
    id: string,
    body: UpdateScopeDto,
  ): Promise<ScopeResponse> {
    const organizationId = requireOrganizationId(auth);

    const updateData: ScopeUpdateData = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.domains !== undefined) updateData.domains = body.domains;
    if (body.repos !== undefined) updateData.repos = body.repos;
    if (body.ipRanges !== undefined) updateData.ipRanges = body.ipRanges;
    if (body.runtimeValues !== undefined) updateData.runtimeValues = body.runtimeValues;

    const record = await this.repository.update(id, organizationId, updateData);
    return this.mapToResponse(record);
  }

  async deleteScope(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = requireOrganizationId(auth);
    await this.repository.delete(id, organizationId);
  }
}
