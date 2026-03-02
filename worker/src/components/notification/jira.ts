import { z } from 'zod';
import {
  componentRegistry,
  type ComponentRetryPolicy,
  ValidationError,
  ConfigurationError,
  AuthenticationError,
  NetworkError,
  fromHttpResponse,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@sentris/component-sdk';

const inputSchema = inputs({
  summary: port(z.string().min(1), {
    label: 'Summary',
    description: 'Issue summary/title',
    connectionType: { kind: 'primitive', name: 'text' },
    valuePriority: 'manual-first',
  }),
  description: port(z.string().optional().default(''), {
    label: 'Description',
    description: 'Issue description (plain text — will be converted to ADF)',
    connectionType: { kind: 'primitive', name: 'text' },
    valuePriority: 'manual-first',
  }),
  customFields: port(z.record(z.string(), z.unknown()).optional(), {
    label: 'Custom Fields',
    description: 'Optional custom fields as key-value pairs',
    connectionType: { kind: 'primitive', name: 'json' },
    valuePriority: 'manual-first',
  }),
});

const parameterSchema = parameters({
  jiraUrl: param(z.string().url(), {
    label: 'Jira URL',
    description: 'Atlassian Jira Cloud URL (e.g., https://your-domain.atlassian.net)',
    editor: 'text',
  }),
  email: param(z.string().email(), {
    label: 'Email',
    description: 'Atlassian account email for API authentication',
    editor: 'text',
  }),
  apiToken: param(z.string().min(1), {
    label: 'API Token',
    description:
      'Atlassian API token (generate at https://id.atlassian.com/manage-profile/security/api-tokens)',
    editor: 'secret',
  }),
  projectKey: param(z.string().min(1).max(10), {
    label: 'Project Key',
    description: 'Jira project key (e.g., SEC, VULN, OPS)',
    editor: 'text',
  }),
  issueType: param(z.string().default('Task'), {
    label: 'Issue Type',
    description: 'Jira issue type name (e.g., Task, Bug, Story, Epic)',
    editor: 'text',
  }),
  priority: param(z.string().optional(), {
    label: 'Priority',
    description:
      'Issue priority name (e.g., Highest, High, Medium, Low, Lowest). Leave empty for project default.',
    editor: 'text',
  }),
  labels: param(z.string().optional(), {
    label: 'Labels',
    description: 'Comma-separated labels to apply to the issue (e.g., security,automated)',
    editor: 'text',
  }),
  assignee: param(z.string().optional(), {
    label: 'Assignee Account ID',
    description: 'Atlassian account ID of the assignee. Leave empty for unassigned.',
    editor: 'text',
  }),
});

const outputSchema = outputs({
  ticketKey: port(z.string(), {
    label: 'Ticket Key',
    description: 'Created Jira issue key (e.g., SEC-123)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  ticketUrl: port(z.string().url(), {
    label: 'Ticket URL',
    description: 'Full URL to the created Jira issue',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  ticketId: port(z.string(), {
    label: 'Ticket ID',
    description: 'Jira issue ID (numeric)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  response: port(z.unknown(), {
    label: 'Raw Response',
    description: 'Full Jira API response body',
    connectionType: { kind: 'primitive', name: 'json' },
    allowAny: true,
    reason: 'Jira API responses vary by instance configuration',
  }),
});

/**
 * Convert a plain text string to Atlassian Document Format (ADF).
 * Jira REST API v3 requires `description` in ADF, not plain text.
 */
function textToAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  };
}

// Ticket creation is not idempotent — retry must be disabled
const jiraRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1,
  nonRetryableErrorTypes: ['AuthenticationError', 'ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'sentris.jira.create-ticket',
  label: 'Jira — Create Ticket',
  category: 'notification',
  runner: { kind: 'inline' },
  retryPolicy: jiraRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Creates a Jira issue via the Jira Cloud REST API v3. Useful for automatically generating tickets from security scan findings, vulnerability reports, or workflow events.',
  ui: {
    slug: 'jira-create-ticket',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: 'Create Jira tickets in your Atlassian Cloud projects.',
    icon: 'ticket',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
  },
  resolvePorts() {
    return { inputs: inputSchema, outputs: outputSchema };
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);

    const { summary, description, customFields } = parsedInputs;
    const { jiraUrl, email, apiToken, projectKey, issueType, priority, labels, assignee } =
      parsedParams;

    // Validate required inputs
    if (!summary || summary.trim().length === 0) {
      throw new ValidationError('Summary is required and must not be empty.', {
        fieldErrors: { summary: ['Summary is required'] },
      });
    }

    // Validate configuration
    if (!jiraUrl) {
      throw new ConfigurationError('Jira URL is required.', { configKey: 'jiraUrl' });
    }
    if (!email || !apiToken) {
      throw new ConfigurationError('Email and API Token are required for authentication.', {
        configKey: 'apiToken',
      });
    }
    if (!projectKey) {
      throw new ConfigurationError('Project Key is required.', { configKey: 'projectKey' });
    }

    // Normalize Jira URL — strip trailing slashes
    const baseUrl = jiraUrl.replace(/\/+$/, '');
    const apiUrl = `${baseUrl}/rest/api/3/issue`;

    // Build Basic Auth header
    const b64 = btoa(`${email}:${apiToken}`);

    // Convert description to ADF (Atlassian Document Format)
    const descriptionText = description || 'No description provided';
    const adfDescription = textToAdf(descriptionText);

    // Build Jira API request body
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      issuetype: { name: issueType },
      summary,
      description: adfDescription,
    };

    if (priority) {
      fields.priority = { name: priority };
    }

    if (labels) {
      const parsedLabels = labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      if (parsedLabels.length > 0) {
        fields.labels = parsedLabels;
      }
    }

    if (assignee) {
      fields.assignee = { accountId: assignee };
    }

    // Spread custom fields into the fields object
    if (customFields) {
      Object.assign(fields, customFields);
    }

    const body = { fields };

    context.logger.info(`[Jira] Creating ticket in project ${projectKey} (type: ${issueType})...`);
    context.emitProgress(`Creating Jira ticket in ${projectKey}...`);

    let response: Response;
    try {
      response = await context.http.fetch(
        apiUrl,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${b64}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        },
        { sensitiveHeaders: ['Authorization'] },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      context.logger.error(`[Jira] Request failed: ${message}`);
      throw new NetworkError(`Failed to call Jira API: ${message}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');

      if (response.status === 401 || response.status === 403) {
        context.logger.error(
          `[Jira] Authentication failed (${response.status}): ${errorText.slice(0, 500)}`,
        );
        throw new AuthenticationError(
          `Jira authentication failed (${response.status}). Verify your email and API token are correct.`,
        );
      }

      if (response.status === 400) {
        context.logger.error(`[Jira] Validation error: ${errorText.slice(0, 500)}`);
        throw new ValidationError(`Jira rejected the request (400): ${errorText.slice(0, 500)}`, {
          details: { responseBody: errorText.slice(0, 1000) },
        });
      }

      context.logger.error(`[Jira] API error (${response.status}): ${errorText.slice(0, 500)}`);
      throw fromHttpResponse(response, errorText.slice(0, 500));
    }

    // Parse successful response
    let result: Record<string, unknown>;
    try {
      result = (await response.json()) as Record<string, unknown>;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      context.logger.error(`[Jira] Failed to parse response JSON: ${message}`);
      throw new ValidationError(`Unable to parse Jira API response: ${message}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }

    const ticketKey = result.key as string;
    const ticketId = String(result.id);
    const ticketUrl = `${baseUrl}/browse/${ticketKey}`;

    context.logger.info(`[Jira] Created ticket: ${ticketKey} — ${ticketUrl}`);

    return {
      ticketKey,
      ticketUrl,
      ticketId,
      response: result,
    };
  },
});

componentRegistry.register(definition);

export { definition };
