import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { FindingTriageRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import { SecurityAnalyticsService } from '../analytics/security-analytics.service';
import { OrgMembersService } from '../org/org-members.service';
import { FindingTriageRepository } from './finding-triage.repository';
import { validateTransition } from './triage-state-machine';
import type { FindingTriageStatus } from './dto/triage-update.dto';
import type { BulkTriageResponse } from './dto/bulk-triage.dto';
import type { TriageHistoryResponse } from './dto/triage-history.dto';

interface TriageUpdateInput {
  status?: FindingTriageStatus;
  assigneeUserId?: string;
  severityOverride?: string | null;
  notes?: string | null;
  comment?: string;
}

/** Payload emitted on the `finding.triage.changed` event. */
export interface FindingTriageChangedEvent {
  findingTriageId: string;
  findingOpensearchId: string;
  organizationId: string;
  status: string;
  previousStatus: string;
  /** Origin of the change — used for circular-sync prevention. */
  source: string;
}

export interface TriageResponseDto {
  id: string;
  findingOpensearchId: string;
  status: string;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  slaDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriageData {
  status: string;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  updatedAt: string;
}

@Injectable()
export class FindingTriageService {
  private readonly logger = new Logger(FindingTriageService.name);

  constructor(
    private readonly repository: FindingTriageRepository,
    private readonly auditLogService: AuditLogService,
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly orgMembersService: OrgMembersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Update (or create) triage state for a single finding.
   *
   * @param source Origin of the change (default `'user'`). Pass `'jira_webhook'`
   *   for changes originating from an inbound Jira webhook so the ticketing
   *   listener can skip re-syncing to avoid infinite loops.
   */
  async upsertTriage(
    auth: AuthContext,
    findingOpensearchId: string,
    input: TriageUpdateInput,
    source = 'user',
  ): Promise<TriageResponseDto> {
    const organizationId = requireOrganizationId(auth);
    const userId = auth.userId!;

    await this.assertFindingExists(organizationId, findingOpensearchId);

    const existing = await this.repository.findByOrgAndFindingId(
      organizationId,
      findingOpensearchId,
    );
    const currentStatus: FindingTriageStatus = (existing?.status as FindingTriageStatus) ?? 'new';

    if (input.status && input.status !== currentStatus) {
      const result = validateTransition(currentStatus, input.status);
      if (!result.valid) {
        throw new UnprocessableEntityException({
          message: `Invalid status transition from '${currentStatus}' to '${input.status}'`,
          currentStatus,
          validTransitions: result.allowedTransitions,
        });
      }
    }

    if (input.assigneeUserId) {
      const members = await this.orgMembersService.listMembers(organizationId);
      if (!members.some((m) => m.userId === input.assigneeUserId)) {
        throw new BadRequestException('Assignee must be a member of the organization');
      }
    }

    const record = await this.repository.upsert(organizationId, findingOpensearchId, {
      status: input.status,
      assigneeUserId: input.assigneeUserId,
      severityOverride: input.severityOverride,
      notes: input.notes,
    });

    const events = this.buildEvents(existing, input, record.id, userId);
    if (events.length > 0) {
      await this.repository.addEvents(events);
    }

    this.auditLogService.record(auth, {
      action: 'findings.triage',
      resourceType: 'finding_triage',
      resourceId: findingOpensearchId,
      resourceName: null,
      metadata: {
        findingOpensearchId,
        changes: Object.fromEntries(
          events.map((e) => [e.fieldChanged, { old: e.oldValue, new: e.newValue }]),
        ),
      },
    });

    try {
      this.eventEmitter.emit('finding.triage.changed', {
        findingTriageId: record.id,
        findingOpensearchId,
        organizationId,
        status: record.status,
        previousStatus: currentStatus,
        source,
        userId: auth.userId,
      } satisfies FindingTriageChangedEvent & { userId: string | null });
    } catch (err) {
      this.logger.warn(`Failed to emit finding.triage.changed event: ${err}`);
    }

    return this.toResponse(record);
  }

  /**
   * Bulk update triage state for multiple findings.
   */
  async bulkTriage(
    auth: AuthContext,
    findingIds: string[],
    input: Pick<TriageUpdateInput, 'status' | 'assigneeUserId' | 'comment'>,
  ): Promise<BulkTriageResponse> {
    const organizationId = requireOrganizationId(auth);
    const userId = auth.userId!;

    const existingRecords =
      findingIds.length > 0 ? await this.repository.findByIds(organizationId, findingIds) : [];
    const existingMap = new Map(existingRecords.map((r) => [r.findingOpensearchId, r]));

    const results: { findingId: string; success: boolean; error?: string }[] = [];
    const allEvents: {
      findingTriageId: string;
      eventType: string;
      fieldChanged: string | null;
      oldValue: string | null;
      newValue: string | null;
      userId: string;
      comment: string | null;
    }[] = [];

    for (const findingId of findingIds) {
      // Validate finding exists in OpenSearch
      try {
        await this.assertFindingExists(organizationId, findingId);
      } catch (err) {
        if (err instanceof NotFoundException) {
          results.push({ findingId, success: false, error: `Finding ${findingId} not found` });
          continue;
        }
        throw err;
      }

      const existing = existingMap.get(findingId) ?? null;
      const currentStatus: FindingTriageStatus = (existing?.status as FindingTriageStatus) ?? 'new';

      if (input.status && input.status !== currentStatus) {
        const result = validateTransition(currentStatus, input.status);
        if (!result.valid) {
          results.push({
            findingId,
            success: false,
            error: `Invalid transition from '${currentStatus}' to '${input.status}'`,
          });
          continue;
        }
      }

      const record = await this.repository.upsert(organizationId, findingId, {
        status: input.status,
        assigneeUserId: input.assigneeUserId,
      });

      const events = this.buildEvents(existing, input, record.id, userId);
      allEvents.push(...events);
      results.push({ findingId, success: true });

      try {
        this.eventEmitter.emit('finding.triage.changed', {
          findingTriageId: record.id,
          findingOpensearchId: findingId,
          organizationId,
          status: record.status,
          previousStatus: currentStatus,
          source: 'user',
          userId,
        });
      } catch (err) {
        this.logger.warn(`Failed to emit finding.triage.changed event for ${findingId}: ${err}`);
      }
    }

    if (allEvents.length > 0) {
      await this.repository.addEvents(allEvents);
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    this.auditLogService.record(auth, {
      action: 'findings.bulk_triage',
      resourceType: 'finding_triage',
      resourceId: null,
      resourceName: null,
      metadata: {
        findingIds,
        status: input.status ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        successCount,
        failureCount,
      },
    });

    return { results, successCount, failureCount };
  }

  /**
   * Get triage event history for a finding.
   */
  async getHistory(
    auth: AuthContext,
    findingOpensearchId: string,
    limit: number,
  ): Promise<TriageHistoryResponse> {
    const organizationId = requireOrganizationId(auth);
    const triage = await this.repository.findByOrgAndFindingId(organizationId, findingOpensearchId);

    if (!triage) {
      return { events: [] };
    }

    const events = await this.repository.listEvents(triage.id, limit);

    return {
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        fieldChanged: e.fieldChanged,
        oldValue: e.oldValue,
        newValue: e.newValue,
        userId: e.userId,
        comment: e.comment,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Get a triage record by organization and finding OpenSearch ID.
   */
  async getTriageRecord(
    organizationId: string,
    findingOpensearchId: string,
  ): Promise<FindingTriageRecord | null> {
    return (
      (await this.repository.findByOrgAndFindingId(organizationId, findingOpensearchId)) ?? null
    );
  }

  /**
   * Merge triage state into OpenSearch finding items via batch PG lookup.
   */
  async enrichWithTriageState<T extends { id: string }>(
    organizationId: string,
    items: T[],
  ): Promise<(T & { triage: TriageData | null })[]> {
    if (items.length === 0) return [];

    const findingIds = items.map((item) => item.id);
    const records = await this.repository.findByIds(organizationId, findingIds);
    const recordMap = new Map(records.map((r) => [r.findingOpensearchId, r]));

    return items.map((item) => {
      const record = recordMap.get(item.id);
      return {
        ...item,
        triage: record
          ? {
              status: record.status,
              assigneeUserId: record.assigneeUserId,
              severityOverride: record.severityOverride,
              notes: record.notes,
              updatedAt: record.updatedAt.toISOString(),
            }
          : null,
      };
    });
  }

  /**
   * Get OpenSearch IDs matching the given triage statuses.
   */
  async getTriageByStatus(
    organizationId: string,
    statuses: FindingTriageStatus[],
  ): Promise<string[]> {
    return this.repository.findByStatus(organizationId, statuses);
  }

  /**
   * Get all OpenSearch IDs that have any triage record.
   * Used for triageStatus=new filter (findings NOT in PG).
   */
  async getAllTriagedIds(organizationId: string): Promise<string[]> {
    return this.repository.getAllTriagedIds(organizationId);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async assertFindingExists(
    organizationId: string,
    findingOpensearchId: string,
  ): Promise<void> {
    if (!this.securityAnalyticsService.isAvailable()) {
      this.logger.warn(
        `OpenSearch unavailable — skipping finding existence check for ${findingOpensearchId}`,
      );
      return;
    }

    try {
      const result = await this.securityAnalyticsService.query(organizationId, {
        query: { ids: { values: [findingOpensearchId] } },
        size: 1,
      });

      if (result.total === 0) {
        throw new NotFoundException(`Finding '${findingOpensearchId}' not found`);
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.warn(`OpenSearch query failed during finding check: ${error}`);
    }
  }

  private buildEvents(
    existing: FindingTriageRecord | null,
    input: TriageUpdateInput,
    triageId: string,
    userId: string,
  ): {
    findingTriageId: string;
    eventType: string;
    fieldChanged: string | null;
    oldValue: string | null;
    newValue: string | null;
    userId: string;
    comment: string | null;
  }[] {
    const events: {
      findingTriageId: string;
      eventType: string;
      fieldChanged: string | null;
      oldValue: string | null;
      newValue: string | null;
      userId: string;
      comment: string | null;
    }[] = [];

    const comment = input.comment ?? null;

    if (input.status !== undefined) {
      const oldStatus = existing?.status ?? 'new';
      if (input.status !== oldStatus) {
        events.push({
          findingTriageId: triageId,
          eventType: 'status_change',
          fieldChanged: 'status',
          oldValue: oldStatus,
          newValue: input.status,
          userId,
          comment,
        });
      }
    }

    if (input.assigneeUserId !== undefined) {
      const oldAssignee = existing?.assigneeUserId ?? null;
      if (input.assigneeUserId !== oldAssignee) {
        events.push({
          findingTriageId: triageId,
          eventType: 'assignment_change',
          fieldChanged: 'assignee_user_id',
          oldValue: oldAssignee,
          newValue: input.assigneeUserId,
          userId,
          comment,
        });
      }
    }

    if (input.severityOverride !== undefined) {
      const oldSeverity = existing?.severityOverride ?? null;
      if (input.severityOverride !== oldSeverity) {
        events.push({
          findingTriageId: triageId,
          eventType: 'severity_override',
          fieldChanged: 'severity_override',
          oldValue: oldSeverity,
          newValue: input.severityOverride,
          userId,
          comment,
        });
      }
    }

    if (input.notes !== undefined) {
      const oldNotes = existing?.notes ?? null;
      if (input.notes !== oldNotes) {
        events.push({
          findingTriageId: triageId,
          eventType: existing?.notes ? 'note_updated' : 'note_added',
          fieldChanged: 'notes',
          oldValue: oldNotes,
          newValue: input.notes,
          userId,
          comment,
        });
      }
    }

    return events;
  }

  private toResponse(record: FindingTriageRecord): TriageResponseDto {
    return {
      id: record.id,
      findingOpensearchId: record.findingOpensearchId,
      status: record.status,
      assigneeUserId: record.assigneeUserId,
      severityOverride: record.severityOverride,
      notes: record.notes,
      slaDeadline: record.slaDeadline?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
