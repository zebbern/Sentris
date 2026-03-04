import type {
  TicketingConnectionStatus,
  TicketLinkResponse,
  ConfigureTicketing,
} from '@sentris/shared';
import { httpGet, httpPost, httpPut, httpDel } from './client';

const BASE = '/ticketing';

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface ConnectResponse {
  authorizationUrl: string;
  state: string;
}

export const ticketingApi = {
  /** Get the org's Jira connection status. */
  getConnectionStatus: () => httpGet<TicketingConnectionStatus>(`${BASE}/connection`),

  /** Initiate Jira OAuth 2.0 (3LO) flow — returns authorizationUrl to redirect to. */
  connect: (redirectUri: string) => httpPost<ConnectResponse>(`${BASE}/connect`, { redirectUri }),

  /** Exchange OAuth callback code+state via backend. */
  handleCallback: async (code: string, state: string): Promise<void> => {
    await httpGet<Record<string, unknown>>(
      `${BASE}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
  },

  /** Disconnect Jira (removes tokens, preserves ticket_links). */
  disconnect: () => httpDel(`${BASE}/disconnect`),

  /** Update project/issue type/status mapping config. */
  configure: (config: ConfigureTicketing) =>
    httpPut<TicketingConnectionStatus>(`${BASE}/config`, config),

  /** List available Jira projects (proxied). */
  getProjects: () => httpGet<JiraProject[]>(`${BASE}/projects`),

  /** List issue types for a Jira project (proxied). */
  getIssueTypes: (projectKey: string) =>
    httpGet<JiraIssueType[]>(`${BASE}/issue-types/${encodeURIComponent(projectKey)}`),

  /** Get linked ticket for a finding. */
  getFindingTicket: (findingId: string) =>
    httpGet<TicketLinkResponse>(`/findings/${encodeURIComponent(findingId)}/ticket`),
};
