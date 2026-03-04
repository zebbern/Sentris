import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { AuthContext } from '../../auth/types';
import { DRIZZLE_TOKEN } from '../../database/database.module';
import { findingTriageTable } from '../../database/schema/finding-triage';
import type { TicketingConnectionConfig } from '../../database/schema/ticketing';
import { FindingTriageService } from '../../findings/finding-triage.service';
import {
  FINDING_TRIAGE_STATUSES,
  type FindingTriageStatus,
} from '../../findings/dto/triage-update.dto';
import { TicketingRepository } from '../ticketing.repository';
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
  ) {}

  /**
   * Process an inbound Jira webhook delivery.
   *
   * Flow:
   *  1. Validate the request via URL-secret lookup (and optional HMAC).
   *  2. Parse the Jira event — only `jira:issue_updated` with a status changelog.
   *  3. Reverse-map the Jira status to a `FindingTriageStatus`.
   *  4. Upsert the finding triage with `source: 'jira_webhook'` to prevent
   *     the ticketing listener from re-syncing outbound.
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

    const newJiraStatus = statusChange.toString;
    if (!newJiraStatus) {
      this.logger.warn(`Jira webhook status change for ${issueKey} has no toString value`);
      return { status: 'ignored' };
    }

    this.logger.log(
      `Jira webhook: issue ${issueKey} status changed to "${newJiraStatus}" (org=${connection.organizationId})`,
    );

    // ----- 3. Look up ticket_links by externalId -----
    const link = await this.ticketingRepository.findTicketLinkByExternalId(
      issueKey,
      connection.organizationId,
    );
    if (!link) {
      this.logger.debug(
        `No ticket_link found for Jira issue ${issueKey} in org ${connection.organizationId}`,
      );
      return { status: 'ignored' };
    }

    // ----- 4. Reverse-map Jira status → FindingTriageStatus -----
    const config = connection.config as TicketingConnectionConfig | null;
    const mappedStatus = this.reverseMapStatus(config?.statusMapping, newJiraStatus);

    if (!mappedStatus) {
      this.logger.warn(
        `No reverse mapping for Jira status "${newJiraStatus}" — marking ticket_link as error`,
      );
      await this.ticketingRepository.updateTicketLink(link.id, { syncStatus: 'error' });
      return { status: 'unmapped_status' };
    }

    // ----- 5. Idempotency check: skip if status already matches -----
    const currentTriageStatus = await this.findCurrentTriageStatus(link.findingTriageId);
    if (currentTriageStatus === mappedStatus) {
      this.logger.debug(
        `Finding triage already at status "${mappedStatus}" — idempotent no-op for ${issueKey}`,
      );
      return { status: 'no_change' };
    }

    // ----- 6. Upsert triage with source='jira_webhook' -----
    const findingOpensearchId = await this.getFindingOpensearchId(link.findingTriageId);
    if (!findingOpensearchId) {
      this.logger.warn(
        `Cannot resolve findingOpensearchId for triage ${link.findingTriageId} — skipping`,
      );
      await this.ticketingRepository.updateTicketLink(link.id, { syncStatus: 'error' });
      return { status: 'error' };
    }

    const systemAuth: AuthContext = {
      userId: 'system:jira-webhook',
      organizationId: connection.organizationId,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'system',
    };

    try {
      await this.findingTriageService.upsertTriage(
        systemAuth,
        findingOpensearchId,
        { status: mappedStatus },
        'jira_webhook',
      );
    } catch (err) {
      this.logger.error(
        `Failed to upsert triage for finding ${findingOpensearchId} from Jira webhook: ${err}`,
      );
      await this.ticketingRepository.updateTicketLink(link.id, { syncStatus: 'error' });
      return { status: 'error' };
    }

    // ----- 7. Update ticket_link sync status -----
    await this.ticketingRepository.updateTicketLink(link.id, {
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
    });

    this.logger.log(`Jira webhook: synced ${issueKey} → finding triage status "${mappedStatus}"`);
    return { status: 'synced' };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Invert the `statusMapping` (FindingTriageStatus → Jira status name)
   * and look up the FindingTriageStatus for a given Jira status.
   *
   * If multiple finding statuses map to the same Jira status (e.g. fixed→Done,
   * verified→Done), the *first* matching entry wins.
   */
  private reverseMapStatus(
    statusMapping: Record<string, string> | undefined,
    jiraStatus: string,
  ): FindingTriageStatus | null {
    if (!statusMapping) return null;

    const jiraLower = jiraStatus.toLowerCase();
    for (const [findingStatus, jiraName] of Object.entries(statusMapping)) {
      if (jiraName.toLowerCase() === jiraLower) {
        if (FINDING_TRIAGE_STATUSES.includes(findingStatus as FindingTriageStatus)) {
          return findingStatus as FindingTriageStatus;
        }
      }
    }
    return null;
  }

  private async findCurrentTriageStatus(findingTriageId: string): Promise<string | null> {
    const rows = await this.db
      .select({ status: findingTriageTable.status })
      .from(findingTriageTable)
      .where(eq(findingTriageTable.id, findingTriageId))
      .limit(1);
    return rows[0]?.status ?? null;
  }

  private async getFindingOpensearchId(findingTriageId: string): Promise<string | null> {
    const rows = await this.db
      .select({ findingOpensearchId: findingTriageTable.findingOpensearchId })
      .from(findingTriageTable)
      .where(eq(findingTriageTable.id, findingTriageId))
      .limit(1);
    return rows[0]?.findingOpensearchId ?? null;
  }
}
