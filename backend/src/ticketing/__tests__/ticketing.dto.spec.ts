import { describe, expect, it } from 'bun:test';

import {
  ReconcileTicketCreationResponseSchema,
  ReconcileTicketCreationSchema,
} from '../dto/ticketing.dto';

describe('ReconcileTicketCreationSchema', () => {
  it('accepts an externally verified Jira issue attachment request', () => {
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'attach',
        issueKey: 'SEC-42',
      }).success,
    ).toBe(true);
  });

  it('requires an explicit no-existing-issue confirmation before retry', () => {
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'clear_and_retry',
        confirmedNoIssueExists: false,
      }).success,
    ).toBe(false);
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'clear_and_retry',
        confirmedNoIssueExists: true,
      }).success,
    ).toBe(true);
  });

  it('rejects fields from the other reconciliation action', () => {
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'attach',
        issueKey: 'SEC-42',
        confirmedNoIssueExists: true,
      }).success,
    ).toBe(false);
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'clear_and_retry',
        confirmedNoIssueExists: true,
        issueKey: 'SEC-42',
      }).success,
    ).toBe(false);
  });

  it('describes both attached and asynchronously queued reconciliation responses', () => {
    const ticket = {
      id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
      findingTriageId: '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48',
      provider: 'jira',
      externalId: 'SEC-42',
      externalUrl: 'https://example.atlassian.net/browse/SEC-42',
      syncStatus: 'synced',
      reconciliationRequired: false,
      lastSyncedAt: '2026-07-26T12:00:00.000Z',
      createdAt: '2026-07-26T11:00:00.000Z',
    };

    expect(
      ReconcileTicketCreationResponseSchema.safeParse({
        action: 'attach',
        status: 'attached',
        findingTriageId: ticket.findingTriageId,
        ticket,
      }).success,
    ).toBe(true);
    expect(
      ReconcileTicketCreationResponseSchema.safeParse({
        action: 'clear_and_retry',
        status: 'retry_queued',
        findingTriageId: ticket.findingTriageId,
        ticket: null,
      }).success,
    ).toBe(true);
    expect(
      ReconcileTicketCreationResponseSchema.safeParse({
        action: 'attach',
        status: 'retry_queued',
        findingTriageId: ticket.findingTriageId,
        ticket: null,
      }).success,
    ).toBe(false);
  });
});
