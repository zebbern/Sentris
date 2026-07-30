import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  normalizeJiraStatusMappingEntry,
  type JiraStatusMapping,
  type TicketingConnectionConfig,
} from '@sentris/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { AuthContext } from '../../auth/types';
import { DRIZZLE_TOKEN } from '../../database/database.module';
import { findingTriageTable } from '../../database/schema/finding-triage';
import { FindingTriageService } from '../../findings/finding-triage.service';
import {
  FINDING_TRIAGE_STATUSES,
  type FindingTriageStatus,
} from '../../findings/dto/triage-update.dto';
import { TicketingRepository } from '../ticketing.repository';
import { TicketingService } from '../ticketing.service';
import { validateTransition } from '../../findings/triage-state-machine';
import { verifyJiraWebhookSignature } from './jira-webhook-verify';

// ---------------------------------------------------------------------------
// Jira webhook payload types (only the fields we care about)
// ---------------------------------------------------------------------------

interface JiraChangelogItem {
  field: string;
  fromString: string | null;
  toString: string | null;
}

interface JiraWebhookPayload {
  webhookEvent?: string;
  issue?: {
    key?: string;
    fields?: {
      status?: { name?: string; id?: string };
    };
  };
  changelog?: {
    items?: JiraChangelogItem[];
  };
}

const TRIAGE_FANOUT_CONCURRENCY = 25;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraWebhookService {
  private readonly logger = new Logger(JiraWebhookService.name);

  constructor(
    private readonly ticketingRepository: TicketingRepository,
    private readonly findingTriageService: FindingTriageService,
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
    private readonly ticketingService: TicketingService,
  ) {}

  /**
   * Process an inbound Jira webhook delivery.
   *
   * Flow:
   *  1. Validate the request via URL-secret lookup (and optional HMAC).
   *  2. Parse the Jira event — only `jira:issue_updated` with a status changelog.
   *  3. Load all tenant links for the issue and fetch Jira's current status once.
   *  4. Reverse-map that authoritative status and converge every linked finding
   *     with `source: 'jira_webhook'` to prevent circular outbound sync.
   */
  async handleWebhook(
    secret: string,
    rawBody: string | Buffer,
    signature: string | undefined,
    parsedBody: JiraWebhookPayload,
  ): Promise<{ status: string }> {
    // ----- 1. Look up connection by webhookSecret (URL secret) -----
    const connection = await this.ticketingRepository.findConnectionByWebhookSecret(secret);
    if (!connection) {
      this.logger.warn('Jira webhook received with unknown secret — ignoring');
      return { status: 'ignored' };
    }

    // If an HMAC signature header is present, verify it (future-proofing).
    if (signature && connection.webhookSecret) {
      const isValid = verifyJiraWebhookSignature(rawBody, signature, connection.webhookSecret);
      if (!isValid) {
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    // ----- 2. Parse webhook event -----
    const eventType = parsedBody.webhookEvent;
    if (eventType !== 'jira:issue_updated') {
      this.logger.debug(`Ignoring Jira webhook event type: ${eventType}`);
      return { status: 'ignored' };
    }

    const JIRA_ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
    const issueKey = parsedBody.issue?.key;
    if (!issueKey || !JIRA_ISSUE_KEY_RE.test(issueKey)) {
      this.logger.warn('Jira webhook payload missing or invalid issue key format');
      return { status: 'ignored' };
    }

    const statusChange = parsedBody.changelog?.items?.find((item) => item.field === 'status');
    if (!statusChange) {
      this.logger.debug(`No status change in Jira webhook for ${issueKey} — skipping`);
      return { status: 'ignored' };
    }

    if (!statusChange.toString) {
      this.logger.warn(`Jira webhook status change for ${issueKey} has no toString value`);
      return { status: 'ignored' };
    }

    // ----- 3. Look up every organization-scoped ticket link for this issue -----
    const links = await this.ticketingRepository.findTicketLinksByExternalId(
      issueKey,
      connection.organizationId,
      'jira',
    );
    if (links.length === 0) {
      this.logger.debug(
        `No ticket_link found for Jira issue ${issueKey} in org ${connection.organizationId}`,
      );
      return { status: 'ignored' };
    }

    // ----- 4. Resolve the authoritative current status once per delivery -----
    const currentIssue = await this.ticketingService.getCurrentJiraIssue(
      connection.organizationId,
      issueKey,
    );
    const authoritativeStatus = this.issueStatusName(currentIssue);
    if (!authoritativeStatus) {
      throw new Error(`Jira issue ${issueKey} did not include a current status`);
    }
    this.logger.log(
      `Jira webhook: reconciling issue ${issueKey} at authoritative status "${authoritativeStatus}" ` +
        `(org=${connection.organizationId}, links=${links.length})`,
    );

    // ----- 5. Reverse-map Jira status → FindingTriageStatus candidates -----
    const config = connection.config as TicketingConnectionConfig | null;
    const mappedStatuses = this.reverseMapStatuses(config?.statusMapping, authoritativeStatus);

    if (mappedStatuses.length === 0) {
      this.logger.warn(
        `No reverse mapping for Jira status "${authoritativeStatus}" — marking ticket links as error`,
      );
      await this.ticketingRepository.updateTicketLinksByIds(
        links.map((link) => link.id),
        connection.organizationId,
        { syncStatus: 'error' },
      );
      return { status: 'unmapped_status' };
    }

    // ----- 6. Load every linked triage target in one tenant-scoped query -----
    const targetRows = await this.findTriageTargets(
      links.map((link) => link.findingTriageId),
      connection.organizationId,
    );
    const targetsById = new Map(targetRows.map((target) => [target.id, target]));
    const systemAuth: AuthContext = {
      userId: 'system:jira-webhook',
      organizationId: connection.organizationId,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'system',
    };

    const syncedLinkIds: string[] = [];
    const invalidMappingLinkIds: string[] = [];
    const retryableFailureLinkIds: string[] = [];
    const failures: unknown[] = [];
    let changedCount = 0;
    const work = links.map((link) => ({
      link,
      target: targetsById.get(link.findingTriageId),
    }));

    for (let index = 0; index < work.length; index += TRIAGE_FANOUT_CONCURRENCY) {
      const batch = work.slice(index, index + TRIAGE_FANOUT_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async ({ link, target }) => {
          if (!target) {
            throw new Error(`Finding triage ${link.findingTriageId} is unavailable`);
          }

          const resolution = this.resolveTargetStatus(target.status, mappedStatuses);
          if (!resolution.status) {
            this.logger.warn(
              `Jira webhook: no valid transition from finding status "${target.status}" ` +
                `for authoritative Jira status "${authoritativeStatus}" ` +
                `(issue=${issueKey}, triage=${target.id}, candidates=${mappedStatuses.join(',')})`,
            );
            return { linkId: link.id, outcome: 'invalid_mapping' as const, changed: false };
          }
          if (resolution.validCandidateCount > 1) {
            this.logger.warn(
              `Jira webhook: multiple valid mappings from finding status "${target.status}" ` +
                `for Jira status "${authoritativeStatus}"; choosing "${resolution.status}" ` +
                `(issue=${issueKey}, triage=${target.id})`,
            );
          }

          if (target.status !== resolution.status) {
            await this.findingTriageService.upsertTriage(
              systemAuth,
              target.findingOpensearchId,
              { status: resolution.status },
              'jira_webhook',
            );
          }
          return {
            linkId: link.id,
            outcome: 'synced' as const,
            changed: target.status !== resolution.status,
          };
        }),
      );

      results.forEach((result, resultIndex) => {
        const linkId = batch[resultIndex]!.link.id;
        if (result.status === 'fulfilled') {
          if (result.value.outcome === 'synced') {
            syncedLinkIds.push(result.value.linkId);
            if (result.value.changed) changedCount++;
          } else {
            invalidMappingLinkIds.push(result.value.linkId);
          }
        } else {
          retryableFailureLinkIds.push(linkId);
          failures.push(result.reason);
        }
      });
    }

    // ----- 7. Repair link state in set-based writes -----
    if (syncedLinkIds.length > 0) {
      await this.ticketingRepository.updateTicketLinksByIds(
        syncedLinkIds,
        connection.organizationId,
        {
          syncStatus: 'synced',
          lastSyncedAt: new Date(),
        },
      );
    }
    const errorLinkIds = [...invalidMappingLinkIds, ...retryableFailureLinkIds];
    if (errorLinkIds.length > 0) {
      await this.ticketingRepository.updateTicketLinksByIds(
        errorLinkIds,
        connection.organizationId,
        { syncStatus: 'error' },
      );
    }
    if (failures.length > 0) {
      const firstFailure = failures[0];
      this.logger.error(
        `Failed to converge ${failures.length} Jira-linked finding(s) for ${issueKey}: ${firstFailure}`,
      );
      throw firstFailure;
    }
    if (invalidMappingLinkIds.length > 0) {
      this.logger.warn(
        `Jira webhook: ${invalidMappingLinkIds.length} linked finding(s) could not converge ` +
          `to Jira status "${authoritativeStatus}" for ${issueKey}`,
      );
      return { status: 'error' };
    }

    this.logger.log(
      `Jira webhook: reconciled ${issueKey} → ${links.length} finding(s) ` +
        `at Jira status "${authoritativeStatus}"`,
    );
    return { status: changedCount > 0 ? 'synced' : 'no_change' };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Return every finding status mapped to the Jira status in canonical triage
   * order so ambiguous aliases are resolved deterministically per target.
   */
  private reverseMapStatuses(
    statusMapping: JiraStatusMapping | undefined,
    jiraStatus: string,
  ): FindingTriageStatus[] {
    if (!statusMapping) return [];

    const jiraLower = jiraStatus.toLowerCase();
    return FINDING_TRIAGE_STATUSES.filter((findingStatus) => {
      const mappingEntry = statusMapping[findingStatus];
      if (!mappingEntry) return false;
      const { resultingStatus } = normalizeJiraStatusMappingEntry(mappingEntry);
      return resultingStatus.toLowerCase() === jiraLower;
    });
  }

  private resolveTargetStatus(
    currentStatus: string,
    mappedStatuses: readonly FindingTriageStatus[],
  ): {
    status: FindingTriageStatus | null;
    validCandidateCount: number;
  } {
    if (!FINDING_TRIAGE_STATUSES.includes(currentStatus as FindingTriageStatus)) {
      return { status: null, validCandidateCount: 0 };
    }

    const current = currentStatus as FindingTriageStatus;
    if (mappedStatuses.includes(current)) {
      return { status: current, validCandidateCount: 1 };
    }

    const validCandidates = mappedStatuses.filter(
      (candidate) => validateTransition(current, candidate).valid,
    );
    return {
      status: validCandidates[0] ?? null,
      validCandidateCount: validCandidates.length,
    };
  }

  private issueStatusName(issue: Record<string, unknown>): string | null {
    const fields = issue.fields;
    if (!fields || typeof fields !== 'object') return null;
    const status = (fields as Record<string, unknown>).status;
    if (!status || typeof status !== 'object') return null;
    const name = (status as Record<string, unknown>).name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  }

  private async findTriageTargets(
    findingTriageIds: string[],
    organizationId: string,
  ): Promise<{ id: string; status: string; findingOpensearchId: string }[]> {
    if (findingTriageIds.length === 0) return [];
    return this.db
      .select({
        id: findingTriageTable.id,
        status: findingTriageTable.status,
        findingOpensearchId: findingTriageTable.findingOpensearchId,
      })
      .from(findingTriageTable)
      .where(
        and(
          inArray(findingTriageTable.id, findingTriageIds),
          eq(findingTriageTable.organizationId, organizationId),
        ),
      );
  }
}
