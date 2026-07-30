import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FINDING_TRIAGE_STATUSES, SEVERITY_VALUES } from '@sentris/shared';
import { z } from 'zod';

import { SecurityAnalyticsService } from '../analytics/security-analytics.service';
import { FINDING_TRIAGE_PROJECTION_EVENT } from './finding-triage.events';

const FindingTriageProjectionEventSchema = z.object({
  organizationId: z.string().min(1).max(191),
  findingOpensearchId: z.string().min(1).max(512),
  status: z.enum(FINDING_TRIAGE_STATUSES),
  assigneeUserId: z.string().max(191).nullable(),
  severityOverride: z.enum(SEVERITY_VALUES).nullable(),
  notes: z.string().max(10_000).nullable(),
  updatedAt: z.string().datetime(),
  projectionVersion: z.number().int().positive(),
  outbox: z
    .object({
      eventId: z.string().min(1),
      dedupeKey: z.string().min(1),
      attempt: z.number().int().positive(),
    })
    .optional(),
});

export type FindingTriageProjectionEvent = z.infer<typeof FindingTriageProjectionEventSchema>;

@Injectable()
export class FindingTriageProjectorService {
  constructor(private readonly securityAnalyticsService: SecurityAnalyticsService) {}

  @OnEvent(FINDING_TRIAGE_PROJECTION_EVENT, { async: true })
  async handleProjection(payload: unknown): Promise<void> {
    const event = FindingTriageProjectionEventSchema.parse(payload);
    await this.securityAnalyticsService.projectFindingTriage(
      event.organizationId,
      event.findingOpensearchId,
      {
        status: event.status,
        assigneeUserId: event.assigneeUserId,
        severityOverride: event.severityOverride,
        notes: event.notes,
        updatedAt: event.updatedAt,
        version: event.projectionVersion,
      },
    );
  }
}
