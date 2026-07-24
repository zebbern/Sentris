import { Injectable } from '@nestjs/common';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { ScopesService } from '../scopes/scopes.service';
import { type AssetType } from './asset-extractor';
import { AssetInventoryRepository } from './assets.repository';
import type { AssetResponse } from './dto/assets.dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly repository: AssetInventoryRepository,
    private readonly scopesService: ScopesService,
  ) {}

  async listAssets(
    auth: AuthContext | null,
    scopeId: string,
    opts: { assetType?: AssetType; limit?: number } = {},
  ): Promise<AssetResponse[]> {
    const organizationId = requireOrganizationId(auth);
    // Validate the scope belongs to the caller's organization (404s otherwise).
    await this.scopesService.getScope(auth, scopeId);
    const rows = await this.repository.listByScope(scopeId, organizationId, opts);
    return rows.map((record) => ({
      id: record.id,
      organizationId: record.organizationId,
      scopeId: record.scopeId,
      assetType: record.assetType,
      assetValue: record.assetValue,
      firstSeenAt: record.firstSeenAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      firstSeenRunId: record.firstSeenRunId,
      lastSeenRunId: record.lastSeenRunId,
      sourceComponentId: record.sourceComponentId,
      metadata: record.metadata ?? {},
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));
  }
}
