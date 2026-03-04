import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { slaPoliciesTable, type SlaPolicyRecord } from '../database/schema';

@Injectable()
export class SlaPolicyRepository {
  private readonly logger = new Logger(SlaPolicyRepository.name);

  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

  /**
   * Fetch all SLA policies for an organization.
   */
  async findByOrganization(organizationId: string): Promise<SlaPolicyRecord[]> {
    return this.db
      .select()
      .from(slaPoliciesTable)
      .where(eq(slaPoliciesTable.organizationId, organizationId))
      .limit(10);
  }

  /**
   * Replace all SLA policies for an organization atomically.
   * Deletes existing policies, then inserts new ones within a transaction.
   */
  async upsertPolicies(
    organizationId: string,
    policies: { severity: string; deadlineHours: number }[],
  ): Promise<SlaPolicyRecord[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(slaPoliciesTable).where(eq(slaPoliciesTable.organizationId, organizationId));

      if (policies.length === 0) {
        return [];
      }

      const now = new Date();
      return tx
        .insert(slaPoliciesTable)
        .values(
          policies.map((p) => ({
            organizationId,
            severity: p.severity,
            deadlineHours: p.deadlineHours,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning();
    });
  }
}
