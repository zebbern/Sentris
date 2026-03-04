import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  ticketingConnectionsTable,
  ticketLinksTable,
  type TicketingConnectionRecord,
  type TicketingConnectionInsert,
  type TicketLinkRecord,
  type TicketLinkInsert,
} from '../database/schema';

@Injectable()
export class TicketingRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  async findConnectionByOrg(
    organizationId: string,
    provider = 'jira',
  ): Promise<TicketingConnectionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketingConnectionsTable)
      .where(
        and(
          eq(ticketingConnectionsTable.organizationId, organizationId),
          eq(ticketingConnectionsTable.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async findConnectionByWebhookSecret(
    webhookSecret: string,
  ): Promise<TicketingConnectionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketingConnectionsTable)
      .where(eq(ticketingConnectionsTable.webhookSecret, webhookSecret))
      .limit(1);
    return record;
  }

  async createConnection(data: TicketingConnectionInsert): Promise<TicketingConnectionRecord> {
    const [record] = await this.db.insert(ticketingConnectionsTable).values(data).returning();
    return record;
  }

  async updateConnection(
    id: string,
    data: Partial<Omit<TicketingConnectionInsert, 'id'>>,
  ): Promise<TicketingConnectionRecord> {
    const [record] = await this.db
      .update(ticketingConnectionsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(ticketingConnectionsTable.id, id))
      .returning();
    return record;
  }

  async deleteConnection(organizationId: string, provider = 'jira'): Promise<void> {
    await this.db
      .delete(ticketingConnectionsTable)
      .where(
        and(
          eq(ticketingConnectionsTable.organizationId, organizationId),
          eq(ticketingConnectionsTable.provider, provider),
        ),
      );
  }

  // ---------------------------------------------------------------------------
  // Ticket links
  // ---------------------------------------------------------------------------

  async findTicketLinkByTriageId(
    findingTriageId: string,
    provider = 'jira',
  ): Promise<TicketLinkRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.findingTriageId, findingTriageId),
          eq(ticketLinksTable.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async findTicketLinkByExternalId(
    externalId: string,
    organizationId: string,
    provider = 'jira',
  ): Promise<TicketLinkRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          eq(ticketLinksTable.externalId, externalId),
          eq(ticketLinksTable.organizationId, organizationId),
          eq(ticketLinksTable.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async createTicketLink(data: TicketLinkInsert): Promise<TicketLinkRecord> {
    const [record] = await this.db.insert(ticketLinksTable).values(data).returning();
    return record;
  }

  async updateTicketLink(
    id: string,
    data: Partial<Omit<TicketLinkInsert, 'id'>>,
  ): Promise<TicketLinkRecord> {
    const [record] = await this.db
      .update(ticketLinksTable)
      .set(data)
      .where(eq(ticketLinksTable.id, id))
      .returning();
    return record;
  }

  async findTicketLinksByTriageIds(
    findingTriageIds: string[],
    provider = 'jira',
  ): Promise<TicketLinkRecord[]> {
    if (findingTriageIds.length === 0) return [];
    return this.db
      .select()
      .from(ticketLinksTable)
      .where(
        and(
          inArray(ticketLinksTable.findingTriageId, findingTriageIds),
          eq(ticketLinksTable.provider, provider),
        ),
      );
  }
}
