import { Injectable, Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraAccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
}

export interface JiraCreatedIssue {
  id: string;
  key: string;
  self: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

export interface JiraDynamicWebhook {
  id: string;
  url: string;
  events: string[];
  jqlFilter?: string;
  expirationDate?: string;
}

export interface CreateIssueInput {
  projectKey: string;
  issueTypeId: string;
  summary: string;
  description: string;
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = ['api.atlassian.com', 'auth.atlassian.com'];

function assertSafeUrl(url: string): void {
  const parsed = new URL(url);
  const isAllowed = ALLOWED_HOSTS.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith('.atlassian.net'),
  );
  if (!isAllowed) {
    throw new Error(`SSRF protection: URL host '${parsed.hostname}' is not in the Jira allowlist`);
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;
const WEBHOOK_LIST_PAGE_SIZE = 100;
const MAX_WEBHOOK_LIST_PAGES = 10;

@Injectable()
export class JiraAdapter {
  private readonly logger = new Logger(JiraAdapter.name);

  private baseUrl(cloudId: string): string {
    return `https://api.atlassian.com/ex/jira/${cloudId}`;
  }

  private headers(accessToken: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  /**
   * Fetch accessible Jira Cloud sites for the authenticated user.
   */
  async getAccessibleResources(accessToken: string): Promise<JiraAccessibleResource[]> {
    const url = 'https://api.atlassian.com/oauth/token/accessible-resources';
    assertSafeUrl(url);

    const response = await this.request(url, {
      method: 'GET',
      headers: this.headers(accessToken),
    });

    return response as JiraAccessibleResource[];
  }

  /**
   * List projects in the Jira Cloud site.
   */
  async listProjects(cloudId: string, accessToken: string): Promise<JiraProject[]> {
    const url = `${this.baseUrl(cloudId)}/rest/api/3/project/search?maxResults=100`;
    assertSafeUrl(url);

    const response = await this.request(url, {
      method: 'GET',
      headers: this.headers(accessToken),
    });

    return ((response as { values?: JiraProject[] }).values ?? []).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      avatarUrls: p.avatarUrls,
    }));
  }

  /**
   * List issue types available in a Jira Cloud project.
   */
  async listIssueTypes(
    cloudId: string,
    accessToken: string,
    projectKey: string,
  ): Promise<JiraIssueType[]> {
    // First get the project to resolve its ID
    const projectUrl = `${this.baseUrl(cloudId)}/rest/api/3/project/${encodeURIComponent(projectKey)}`;
    assertSafeUrl(projectUrl);

    const project = (await this.request(projectUrl, {
      method: 'GET',
      headers: this.headers(accessToken),
    })) as { id: string };

    const url = `${this.baseUrl(cloudId)}/rest/api/3/issuetype/project?projectId=${project.id}`;
    assertSafeUrl(url);

    const issueTypes = (await this.request(url, {
      method: 'GET',
      headers: this.headers(accessToken),
    })) as JiraIssueType[];

    return issueTypes.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description ?? '',
      iconUrl: it.iconUrl ?? '',
    }));
  }

  /**
   * Create a Jira issue.
   */
  async createIssue(
    cloudId: string,
    accessToken: string,
    input: CreateIssueInput,
  ): Promise<JiraCreatedIssue> {
    const url = `${this.baseUrl(cloudId)}/rest/api/3/issue`;
    assertSafeUrl(url);

    const body = {
      fields: {
        project: { key: input.projectKey },
        issuetype: { id: input.issueTypeId },
        summary: input.summary,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: input.description }],
            },
          ],
        },
      },
    };

    return (await this.request(url, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify(body),
    })) as JiraCreatedIssue;
  }

  /**
   * Transition a Jira issue to a new status by transition name.
   */
  async transitionIssue(
    cloudId: string,
    accessToken: string,
    issueKey: string,
    transitionName: string,
    resultingStatus?: string,
  ): Promise<boolean> {
    const transitions = await this.getTransitions(cloudId, accessToken, issueKey);
    const match = transitions.find((t) => t.name.toLowerCase() === transitionName.toLowerCase());

    if (!match) {
      if (resultingStatus) {
        const issue = await this.getIssue(cloudId, accessToken, issueKey);
        const fields = issue.fields as Record<string, unknown> | undefined;
        const status = fields?.status as { name?: unknown } | undefined;
        if (
          typeof status?.name === 'string' &&
          status.name.toLowerCase() === resultingStatus.toLowerCase()
        ) {
          this.logger.log(
            `Jira issue ${issueKey} is already at status '${resultingStatus}'; treating the transition as applied`,
          );
          return true;
        }
      }
      this.logger.warn(
        `No transition named '${transitionName}' found for issue ${issueKey}. ` +
          `Available: ${transitions.map((t) => t.name).join(', ')}`,
      );
      return false;
    }

    const url = `${this.baseUrl(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
    assertSafeUrl(url);

    await this.request(url, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({ transition: { id: match.id } }),
    });

    return true;
  }

  /**
   * Get available transitions for a Jira issue.
   */
  async getTransitions(
    cloudId: string,
    accessToken: string,
    issueKey: string,
  ): Promise<JiraTransition[]> {
    const url = `${this.baseUrl(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
    assertSafeUrl(url);

    const response = await this.request(url, {
      method: 'GET',
      headers: this.headers(accessToken),
    });

    return (response as { transitions: JiraTransition[] }).transitions ?? [];
  }

  /**
   * Get a Jira issue by key.
   */
  async getIssue(
    cloudId: string,
    accessToken: string,
    issueKey: string,
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}`;
    assertSafeUrl(url);

    const data = await this.request(url, {
      method: 'GET',
      headers: this.headers(accessToken),
    });
    return data as Record<string, unknown>;
  }

  /**
   * Register a webhook in Jira Cloud for `jira:issue_updated` events.
   *
   * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-webhooks/
   * @returns The Jira-assigned webhook ID (stored in connection metadata for cleanup).
   */
  async registerWebhook(
    cloudId: string,
    accessToken: string,
    callbackUrl: string,
  ): Promise<string> {
    const url = `${this.baseUrl(cloudId)}/rest/api/3/webhook`;
    assertSafeUrl(url);

    const body = {
      url: callbackUrl,
      webhooks: [
        {
          jqlFilter: '*',
          events: ['jira:issue_updated'],
        },
      ],
    };

    const response = (await this.request(url, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify(body),
    })) as { webhookRegistrationResult?: { createdWebhookId?: number }[] };

    const webhookId = response.webhookRegistrationResult?.[0]?.createdWebhookId?.toString() ?? '';

    if (!webhookId) {
      this.logger.warn('Jira webhook registration succeeded but no webhook ID was returned');
    }

    return webhookId;
  }

  /**
   * List this OAuth app's dynamic webhooks using a bounded, complete pagination pass.
   *
   * Registration recovery must see every matching callback before creating another
   * webhook. If Jira cannot make progress or the app owns more than the bounded
   * reconciliation window, fail closed and let the durable outbox retry.
   */
  async listWebhooks(cloudId: string, accessToken: string): Promise<JiraDynamicWebhook[]> {
    const webhooks: JiraDynamicWebhook[] = [];
    let startAt = 0;

    for (let pageNumber = 0; pageNumber < MAX_WEBHOOK_LIST_PAGES; pageNumber += 1) {
      const url =
        `${this.baseUrl(cloudId)}/rest/api/3/webhook` +
        `?startAt=${startAt}&maxResults=${WEBHOOK_LIST_PAGE_SIZE}`;
      assertSafeUrl(url);

      const page = (await this.request(url, {
        method: 'GET',
        headers: this.headers(accessToken),
      })) as {
        startAt?: number;
        maxResults?: number;
        total?: number;
        isLast?: boolean;
        values?: {
          id?: number | string;
          url?: string;
          events?: string[];
          jqlFilter?: string;
          expirationDate?: string;
        }[];
      };

      const values = page.values ?? [];
      for (const webhook of values) {
        if (webhook.id === undefined || typeof webhook.url !== 'string') {
          continue;
        }
        webhooks.push({
          id: String(webhook.id),
          url: webhook.url,
          events: Array.isArray(webhook.events) ? webhook.events : [],
          ...(typeof webhook.jqlFilter === 'string' ? { jqlFilter: webhook.jqlFilter } : {}),
          ...(typeof webhook.expirationDate === 'string'
            ? { expirationDate: webhook.expirationDate }
            : {}),
        });
      }

      const pageStart = Number.isSafeInteger(page.startAt) ? page.startAt! : startAt;
      const nextStart = pageStart + values.length;
      const hasTotal = Number.isSafeInteger(page.total) && page.total! >= 0;
      const total = hasTotal ? page.total! : undefined;
      if (page.isLast === true) {
        if (total !== undefined && nextStart < total) {
          throw new Error('Jira returned contradictory webhook pagination metadata');
        }
        return webhooks;
      }
      if (nextStart <= startAt) {
        throw new Error('Unable to make bounded progress while listing Jira webhooks');
      }
      if (page.isLast === false) {
        if (total !== undefined && nextStart >= total) {
          throw new Error('Jira returned contradictory webhook pagination metadata');
        }
        startAt = nextStart;
        continue;
      }
      if (total === undefined) {
        throw new Error('Jira omitted webhook pagination completeness metadata');
      }
      if (nextStart >= total) {
        return webhooks;
      }
      startAt = nextStart;
    }

    throw new Error(
      `Jira webhook listing exceeded the ${MAX_WEBHOOK_LIST_PAGES * WEBHOOK_LIST_PAGE_SIZE}-webhook reconciliation bound`,
    );
  }

  /**
   * Extend one dynamic webhook's Jira-managed 30-day lifetime.
   */
  async refreshWebhook(cloudId: string, accessToken: string, webhookId: string): Promise<string> {
    const numericWebhookId = Number(webhookId);
    if (!Number.isSafeInteger(numericWebhookId) || numericWebhookId < 1) {
      throw new Error(`Invalid Jira webhook ID '${webhookId}'`);
    }
    const url = `${this.baseUrl(cloudId)}/rest/api/3/webhook/refresh`;
    assertSafeUrl(url);

    const response = (await this.request(url, {
      method: 'PUT',
      headers: this.headers(accessToken),
      body: JSON.stringify({ webhookIds: [numericWebhookId] }),
    })) as { expirationDate?: unknown };
    if (typeof response.expirationDate !== 'string' || !response.expirationDate) {
      throw new Error('Jira webhook refresh did not return an expiration date');
    }
    return response.expirationDate;
  }

  /**
   * Delete a previously registered Jira webhook.
   */
  async deleteWebhook(cloudId: string, accessToken: string, webhookId: string): Promise<void> {
    const url = `${this.baseUrl(cloudId)}/rest/api/3/webhook`;
    assertSafeUrl(url);

    await this.request(url, {
      method: 'DELETE',
      headers: this.headers(accessToken),
      body: JSON.stringify({ webhookIds: [Number(webhookId)] }),
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async request(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Jira API request failed: ${message}`);
      throw new Error(`Jira API request failed: ${message}`);
    }

    if (response.status === 204) {
      return {};
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      const errorDetail = typeof body === 'object' && body !== null ? JSON.stringify(body) : text;
      this.logger.error(`Jira API error ${response.status}: ${errorDetail}`);
      throw new JiraApiError(response.status, errorDetail);
    }

    return body;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class JiraApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
  ) {
    super(`Jira API returned ${statusCode}: ${detail}`);
    this.name = 'JiraApiError';
  }
}
