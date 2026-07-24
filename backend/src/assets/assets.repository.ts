import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { assetInventory, type AssetRecord, type NewAssetRecord } from '../database/schema';
import type { AssetType } from './asset-extractor';

@Injectable()
export class AssetInventoryRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async upsertMany(records: NewAssetRecord[]): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();
    for (const record of records) {
      await this.db
        .insert(assetInventory)
        .values(record)
        .onConflictDoUpdate({
          target: [
            assetInventory.organizationId,
            assetInventory.scopeId,
            assetInventory.assetType,
            assetInventory.assetValue,
          ],
          set: {
            lastSeenAt: now,
            lastSeenRunId: record.lastSeenRunId ?? null,
            sourceComponentId: record.sourceComponentId ?? null,
            metadata: record.metadata ?? {},
            updatedAt: now,
          },
        });
    }
  }

  async listByScope(
    scopeId: string,
    organizationId: string,
    opts: { assetType?: AssetType; limit?: number } = {},
  ): Promise<AssetRecord[]> {
    const conditions = [
      eq(assetInventory.organizationId, organizationId),
      eq(assetInventory.scopeId, scopeId),
    ];
    if (opts.assetType) {
      conditions.push(eq(assetInventory.assetType, opts.assetType));
    }

    const query = this.db
      .select()
      .from(assetInventory)
      .where(and(...conditions))
      .orderBy(desc(assetInventory.lastSeenAt));

    return opts.limit ? query.limit(opts.limit) : query;
  }
}
