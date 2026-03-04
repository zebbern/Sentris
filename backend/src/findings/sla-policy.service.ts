import { Injectable, Logger } from '@nestjs/common';

import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { SlaPolicyRepository } from './sla-policy.repository';
import type { SlaPoliciesResponse, Severity, UpsertSlaPolicies } from '@sentris/shared';

@Injectable()
export class SlaPolicyService {
  private readonly logger = new Logger(SlaPolicyService.name);

  constructor(private readonly repository: SlaPolicyRepository) {}

  /**
   * Get all SLA policies for the authenticated user's organization.
   */
  async getPolicies(auth: AuthContext): Promise<SlaPoliciesResponse> {
    const organizationId = requireOrganizationId(auth);
    const records = await this.repository.findByOrganization(organizationId);

    return {
      policies: records.map((r) => ({
        id: r.id,
        severity: r.severity as Severity,
        deadlineHours: r.deadlineHours,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Replace all SLA policies for the authenticated user's organization.
   * Deletes existing and inserts new, all within a transaction.
   */
  async upsertPolicies(auth: AuthContext, input: UpsertSlaPolicies): Promise<SlaPoliciesResponse> {
    const organizationId = requireOrganizationId(auth);
    const records = await this.repository.upsertPolicies(organizationId, input.policies);

    return {
      policies: records.map((r) => ({
        id: r.id,
        severity: r.severity as Severity,
        deadlineHours: r.deadlineHours,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }
}
