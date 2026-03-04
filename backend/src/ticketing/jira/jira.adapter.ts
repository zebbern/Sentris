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
  ): Promise<boolean> {
    const transitions = await this.getTransitions(cloudId, accessToken, issueKey);
    const match = transitions.find((t) => t.name.toLowerCase() === transitionName.toLowerCase());

    if (!match) {
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
      webhooks: [
        {
          jqlFilter: '*',
          events: ['jira:issue_updated'],
          url: callbackUrl,
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
