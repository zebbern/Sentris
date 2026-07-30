import { describe, expect, it } from 'bun:test';

import {
  JiraStatusMappingSchema,
  ReconcileTicketCreationResponseSchema,
  ReconcileTicketCreationSchema,
  TicketLinkResponseSchema,
  TicketingConnectionStatusSchema,
} from '../ticketing.js';

describe('Jira status mapping', () => {
  it('separates the outbound transition name from the resulting inbound Jira status', () => {
    expect(
      JiraStatusMappingSchema.parse({
        fixed: {
          transitionName: 'Resolve issue',
          resultingStatus: 'Done',
        },
      }),
    ).toEqual({
      fixed: {
        transitionName: 'Resolve issue',
        resultingStatus: 'Done',
      },
    });
  });

  it('continues to accept legacy string mappings', () => {
    expect(JiraStatusMappingSchema.parse({ fixed: 'Done' })).toEqual({ fixed: 'Done' });
  });
});

describe('ticket reconciliation contracts', () => {
  const findingTriageId = '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48';

  it('represents unresolved links without a fake external URL', () => {
    expect(
      TicketLinkResponseSchema.parse({
        id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
        findingTriageId,
        provider: 'jira',
        externalId: null,
        externalUrl: null,
        syncStatus: 'unknown',
        reconciliationRequired: true,
        lastSyncedAt: null,
        createdAt: '2026-07-26T11:00:00.000Z',
      }),
    ).toMatchObject({
      externalId: null,
      externalUrl: null,
      syncStatus: 'unknown',
      reconciliationRequired: true,
    });
  });

  it('uses action-discriminated reconciliation requests', () => {
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'attach',
        issueKey: 'sec-42',
      }).success,
    ).toBe(true);
    expect(
      ReconcileTicketCreationSchema.safeParse({
        action: 'attach',
        issueKey: 'SEC-42',
        confirmedNoIssueExists: true,
      }).success,
    ).toBe(false);
  });

  it('uses action-discriminated reconciliation responses', () => {
    expect(
      ReconcileTicketCreationResponseSchema.safeParse({
        action: 'attach',
        status: 'retry_queued',
        findingTriageId,
        ticket: null,
      }).success,
    ).toBe(false);
  });
});

describe('ticketing connection contracts', () => {
  it('represents a connected but unconfigured Jira account with config null, never an empty object', () => {
    const base = {
      id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-1',
      createdAt: '2026-07-26T11:00:00.000Z',
      webhookRegistration: null,
    };

    expect(TicketingConnectionStatusSchema.safeParse({ ...base, config: null }).success).toBe(true);
    expect(TicketingConnectionStatusSchema.safeParse({ ...base, config: {} }).success).toBe(false);
  });

  it('exposes pending, registered, and dead webhook registration states', () => {
    const parsed = TicketingConnectionStatusSchema.parse({
      id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-1',
      config: null,
      createdAt: '2026-07-26T11:00:00.000Z',
      webhookRegistration: {
        status: 'dead',
        version: 4,
        lastError: 'Jira API returned 503',
      },
    });

    expect(parsed.webhookRegistration).toEqual({
      status: 'dead',
      version: 4,
      lastError: 'Jira API returned 503',
    });
  });
});
