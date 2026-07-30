import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { FindingTriageRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import { SecurityAnalyticsService } from '../analytics/security-analytics.service';
import { findingsUnavailable } from '../analytics/findings-unavailable';
import { OrgMembersService } from '../org/org-members.service';
import {
  FindingTriageRepository,
  FindingTriageWriteConflictError,
} from './finding-triage.repository';
import { validateTransition } from './triage-state-machine';
import type { FindingTriageStatus } from './dto/triage-update.dto';
import type { BulkTriageResponse } from './dto/bulk-triage.dto';
import type { TriageHistoryResponse } from './dto/triage-history.dto';
import type { OutboxExecutor } from '../outbox/enqueue-outbox-event';

interface TriageUpdateInput {
  status?: FindingTriageStatus;
  assigneeUserId?: string | null;
  severityOverride?: string | null;
  notes?: string | null;
  comment?: string;
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
  projectionVersion: number;
}

export interface TriageData {
  status: string;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  updatedAt: string;
  projectionVersion: number;
}

export type FindingProjectionHealthReason =
  | 'not_reconciled'
  | 'reconciliation_in_progress'
  | 'reconciliation_failed'
  | 'authoritative_updates_pending'
  | 'watermark_missing'
  | 'observation_index_rebuilt'
  | 'watermark_mismatch'
  | 'projection_events_pending'
  | 'health_check_failed';

export interface FindingProjectionHealth {
  availability: 'available' | 'degraded';
  completedAt: string | null;
  reconciledThrough: string | null;
  reason: FindingProjectionHealthReason | null;
}

@Injectable()
export class FindingTriageService {
  private readonly logger = new Logger(FindingTriageService.name);

  constructor(
    private readonly repository: FindingTriageRepository,
    private readonly auditLogService: AuditLogService,
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly orgMembersService: OrgMembersService,
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

    if (input.assigneeUserId !== undefined && input.assigneeUserId !== null) {
      const members = await this.orgMembersService.listMembers(organizationId);
      if (!members.some((m) => m.userId === input.assigneeUserId)) {
        throw new BadRequestException('Assignee must be a member of the organization');
      }
    }

    const { record } = await this.commitWithRetry(
      organizationId,
      findingOpensearchId,
      input,
      source,
      userId,
      existing,
      async (executor, events) => {
        await this.auditLogService.recordDurableWithExecutor(executor, auth, {
          action: 'findings.triage',
          resourceType: 'finding_triage',
          resourceId: findingOpensearchId,
          resourceName: null,
          metadata: {
            findingOpensearchId,
            changes: Object.fromEntries(
              events.map((event) => [
                event.fieldChanged,
                { old: event.oldValue, new: event.newValue },
              ]),
            ),
          },
        });
      },
    );

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

    if (input.assigneeUserId !== undefined && input.assigneeUserId !== null) {
      const members = await this.orgMembersService.listMembers(organizationId);
      if (!members.some((member) => member.userId === input.assigneeUserId)) {
        throw new BadRequestException('Assignee must be a member of the organization');
      }
    }

    const existingRecords =
      findingIds.length > 0 ? await this.repository.findByIds(organizationId, findingIds) : [];
    const existingMap = new Map(existingRecords.map((r) => [r.findingOpensearchId, r]));

    const results: { findingId: string; success: boolean; error?: string }[] = [];
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

      try {
        await this.commitWithRetry(
          organizationId,
          findingId,
          input,
          'user',
          userId,
          existing,
          async (executor, events) => {
            await this.auditLogService.recordDurableWithExecutor(executor, auth, {
              action: 'findings.bulk_triage',
              resourceType: 'finding_triage',
              resourceId: findingId,
              resourceName: null,
              metadata: {
                findingOpensearchId: findingId,
                requestedStatus: input.status ?? null,
                requestedAssigneeUserId: input.assigneeUserId ?? null,
                changes: Object.fromEntries(
                  events.map((event) => [
                    event.fieldChanged,
                    { old: event.oldValue, new: event.newValue },
                  ]),
                ),
              },
            });
          },
        );
        results.push({ findingId, success: true });
      } catch (error) {
        if (error instanceof ConflictException || error instanceof BadRequestException) {
          results.push({
            findingId,
            success: false,
            error: error.message,
          });
          continue;
        }
        throw error;
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

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
              projectionVersion: record.projectionVersion,
            }
          : null,
      };
    });
  }

  async getProjectionHealth(organizationId: string): Promise<FindingProjectionHealth> {
    try {
      if (!(await this.repository.hasTriageRecords(organizationId))) {
        return {
          availability: 'available',
          completedAt: null,
          reconciledThrough: null,
          reason: null,
        };
      }

      const state = await this.repository.getProjectionReconciliationState(organizationId);
      if (!state?.lastCompletedAt || !state.reconciledThrough) {
        return this.degradedProjectionHealth(state, 'not_reconciled');
      }
      if (state.cursor || state.cycleStartedAt || state.cycleCutoff) {
        return this.degradedProjectionHealth(state, 'reconciliation_in_progress');
      }
      if (state.failed > 0) {
        return this.degradedProjectionHealth(state, 'reconciliation_failed');
      }
      if (
        await this.repository.hasAuthoritativeChangesAfter(organizationId, state.reconciledThrough)
      ) {
        return this.degradedProjectionHealth(state, 'authoritative_updates_pending');
      }

      const watermark =
        await this.securityAnalyticsService.getFindingTriageProjectionWatermark(organizationId);
      if (!watermark) {
        return this.degradedProjectionHealth(state, 'watermark_missing');
      }
      if (!watermark.matchesCurrentObservationIndex) {
        return this.degradedProjectionHealth(state, 'observation_index_rebuilt');
      }
      if (
        watermark.completedAt !== state.lastCompletedAt.toISOString() ||
        watermark.reconciledThrough !== state.reconciledThrough.toISOString() ||
        watermark.checked !== state.checked ||
        watermark.repaired !== state.repaired ||
        watermark.failed !== state.failed
      ) {
        return this.degradedProjectionHealth(state, 'watermark_mismatch');
      }

      return {
        availability: 'available',
        completedAt: state.lastCompletedAt.toISOString(),
        reconciledThrough: state.reconciledThrough.toISOString(),
        reason: null,
      };
    } catch (error) {
      this.logger.warn(
        `Unable to establish finding projection health for ${organizationId}: ${error}`,
      );
      return {
        availability: 'degraded',
        completedAt: null,
        reconciledThrough: null,
        reason: 'health_check_failed',
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private degradedProjectionHealth(
    state:
      | {
          lastCompletedAt: Date | null;
          reconciledThrough: Date | null;
        }
      | null
      | undefined,
    reason: FindingProjectionHealthReason,
  ): FindingProjectionHealth {
    return {
      availability: 'degraded',
      completedAt: state?.lastCompletedAt?.toISOString() ?? null,
      reconciledThrough: state?.reconciledThrough?.toISOString() ?? null,
      reason,
    };
  }

  private async commitWithRetry(
    organizationId: string,
    findingOpensearchId: string,
    input: TriageUpdateInput,
    source: string,
    userId: string,
    initialExisting: FindingTriageRecord | null,
    onCommitted: (
      executor: OutboxExecutor,
      events: ReturnType<FindingTriageService['buildEvents']>,
    ) => Promise<void>,
  ): Promise<{
    record: FindingTriageRecord;
    events: ReturnType<FindingTriageService['buildEvents']>;
  }> {
    let existing = initialExisting;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const currentStatus: FindingTriageStatus = (existing?.status as FindingTriageStatus) ?? 'new';
      if (input.status && input.status !== currentStatus) {
        const transition = validateTransition(currentStatus, input.status);
        if (!transition.valid) {
          throw new UnprocessableEntityException({
            message: `Invalid status transition from '${currentStatus}' to '${input.status}'`,
            currentStatus,
            validTransitions: transition.allowedTransitions,
          });
        }
      }

      const triageId = existing?.id ?? randomUUID();
      const events = this.buildEvents(existing, input, triageId, userId);
      if (events.length === 0) {
        if (existing) return { record: existing, events };
        throw new BadRequestException('Triage update does not change state');
      }

      try {
        const record = await this.repository.transaction(async (executor) => {
          const committedRecord = await this.repository.commitChange(
            {
              organizationId,
              findingOpensearchId,
              triageId,
              expectedVersion: existing?.projectionVersion ?? 0,
              previousStatus: currentStatus,
              source,
              userId,
              data: {
                status: input.status,
                assigneeUserId: input.assigneeUserId,
                severityOverride: input.severityOverride,
                notes: input.notes,
              },
              events: events.map(
                ({ findingTriageId: _findingTriageId, userId: _userId, ...event }) => event,
              ),
            },
            executor,
          );
          await onCommitted(executor, events);
          return committedRecord;
        });
        return { record, events };
      } catch (error) {
        if (!(error instanceof FindingTriageWriteConflictError) || attempt === 1) {
          if (error instanceof FindingTriageWriteConflictError) {
            throw new ConflictException('Finding triage changed concurrently; retry the update');
          }
          throw error;
        }
        existing = await this.repository.findByOrgAndFindingId(organizationId, findingOpensearchId);
      }
    }

    throw new ConflictException('Finding triage changed concurrently; retry the update');
  }

  private async assertFindingExists(
    organizationId: string,
    findingOpensearchId: string,
  ): Promise<void> {
    if (!this.securityAnalyticsService.isAvailable()) {
      throw findingsUnavailable('Finding data is unavailable');
    }

    try {
      const result = await this.securityAnalyticsService.queryFindings(organizationId, {
        query: { ids: { values: [findingOpensearchId] } },
        size: 1,
      });

      if (result.total === 0) {
        throw new NotFoundException(`Finding '${findingOpensearchId}' not found`);
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.warn(`OpenSearch query failed during finding check: ${error}`);
      throw findingsUnavailable('Finding data is unavailable');
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
      projectionVersion: record.projectionVersion,
    };
  }
}
