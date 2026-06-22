import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  ValidationError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  DEFAULT_SENSITIVE_HEADERS,
  type ExecutionContext,
  type HttpInstrumentationOptions,
} from '@sentris/component-sdk';
import {
  normalizeAllFindings,
  formatFindingsSummaryText,
  severityCounts,
  SEVERITY_ORDER,
  type Finding,
  type FindingSeverity,
} from '@sentris/shared';

import {
  buildDiscordWebhookRequest,
  normalizeDiscordAttachments,
  validateDiscordWebhookUrl,
} from './discord.js';

const DISCORD_CONTENT_MAX_LENGTH = 2000;
const DISCORD_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const inputSchema = inputs({
  after: port(z.unknown().optional(), {
    label: 'Run after',
    description:
      'Connect any output from the last upstream node (e.g. Saved, report, or OK) so this step runs after scanners finish. The value is not used; the report is built from internal run APIs.',
    allowAny: true,
    reason:
      'Dependency-only gate so the scheduler waits for upstream nodes without mapping data to the webhook.',
    connectionType: { kind: 'any' },
  }),
  webhookUrl: port(z.unknown(), {
    label: 'Webhook URL',
    description:
      'Select a stored secret in the Value field, or connect the Secret Loader "Secret Value" output. Do not wire JSON or report outputs here.',
    editor: 'secret',
    allowAny: true,
    reason: 'Discord webhook URLs are secrets.',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
});

const parameterSchema = parameters({
  includeSummary: param(z.boolean().default(true), {
    label: 'Include run summary',
    editor: 'boolean',
    description: 'Include run status, duration, and node pass/fail counts.',
  }),
  includeFindings: param(z.boolean().default(true), {
    label: 'Include findings',
    editor: 'boolean',
    description: 'Include top findings normalized from completed node outputs.',
  }),
  includeArtifacts: param(z.boolean().default(false), {
    label: 'Include artifacts list',
    editor: 'boolean',
    description: 'List run artifacts in the Discord embed.',
  }),
  attachFindingsJson: param(z.boolean().default(true), {
    label: 'Attach findings JSON',
    editor: 'boolean',
    description: 'Attach findings.json when findings bundle is enabled.',
  }),
  attachFirstArtifact: param(z.boolean().default(false), {
    label: 'Attach first artifact',
    editor: 'boolean',
    description: 'Attach the first run artifact when under Discord size limits.',
  }),
  findingsLimit: param(z.number().int().min(1).max(100).default(25), {
    label: 'Findings limit',
    editor: 'number',
    description: 'Maximum findings to include in the message and attachment.',
  }),
  username: param(z.string().trim().min(1).max(80).optional(), {
    label: 'Webhook username override',
    editor: 'text',
    placeholder: 'Sentris Flow',
  }),
  contentTemplate: param(z.string().optional(), {
    label: 'Content template override',
    editor: 'textarea',
    description: 'Optional plain-text override. Default builds a summary automatically.',
  }),
});

const outputSchema = outputs({
  ok: port(z.boolean(), { label: 'OK' }),
  error: port(z.string().optional(), { label: 'Error' }),
  findingsCount: port(z.number(), { label: 'Findings Count' }),
});

function resolveApiBaseUrl(): string {
  const raw =
    process.env.SENTRIS_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3211';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function getInternalApiHostname(): string | undefined {
  try {
    return new URL(resolveApiBaseUrl()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function internalFetchOptions(): HttpInstrumentationOptions {
  const hostname = getInternalApiHostname();
  return {
    sensitiveHeaders: Array.from(
      new Set([...DEFAULT_SENSITIVE_HEADERS, 'x-internal-token', 'x-organization-id']),
    ),
    ...(hostname ? { ssrfGuard: { allowedInternalHosts: [hostname] } } : {}),
  };
}

function internalHeaders(organizationId: string | null | undefined): Record<string, string> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to fetch run report data.',
      { configKey: 'INTERNAL_SERVICE_TOKEN' },
    );
  }
  if (!organizationId) {
    throw new ConfigurationError(
      'organizationId is required to fetch run report data from internal APIs.',
      { configKey: 'organizationId' },
    );
  }

  return {
    'X-Internal-Token': internalToken,
    'X-Organization-Id': organizationId,
  };
}

async function fetchInternalJson<T>(context: ExecutionContext, path: string): Promise<T> {
  const response = await context.http.fetch(
    `${resolveApiBaseUrl()}${path}`,
    {
      method: 'GET',
      headers: internalHeaders(context.organizationId),
    },
    internalFetchOptions(),
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Internal API ${path} failed with HTTP ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  return (await response.json()) as T;
}

interface RunSummaryResponse {
  id: string;
  workflowId: string;
  status: string;
  endTime?: string | null;
  duration?: number;
}

interface NodeIoResponse {
  nodes: {
    nodeRef: string;
    componentId: string;
    status?: string;
    outputs: Record<string, unknown> | null;
  }[];
}

interface ArtifactsResponse {
  artifacts: {
    id: string;
    name: string;
    size: number;
    mimeType?: string;
  }[];
}

function deriveNodeStatusCounts(nodes: { status?: string }[] | undefined) {
  const counts = { passed: 0, failed: 0, skipped: 0, running: 0, total: 0 };
  for (const node of nodes ?? []) {
    counts.total += 1;
    switch (node.status) {
      case 'completed':
        counts.passed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

function buildSummaryEmbed(
  run: RunSummaryResponse,
  nodeCounts: ReturnType<typeof deriveNodeStatusCounts>,
  runUrl: string | null,
) {
  const fields = [
    { name: 'Status', value: run.status.replace(/_/g, ' '), inline: true },
    { name: 'Run ID', value: `\`${run.id}\``, inline: true },
    { name: 'Workflow ID', value: `\`${run.workflowId}\``, inline: true },
    {
      name: 'Nodes',
      value: `${nodeCounts.passed} passed / ${nodeCounts.failed} failed / ${nodeCounts.skipped} skipped`,
      inline: false,
    },
  ];

  if (run.endTime) {
    fields.push({
      name: 'Completed At',
      value: new Date(run.endTime).toISOString(),
      inline: false,
    });
  }

  if (runUrl) {
    fields.push({ name: 'Open in Sentris', value: runUrl, inline: false });
  }

  return {
    title: 'Run Summary',
    color: 0x58_65_f2,
    fields,
  };
}

function buildFindingsEmbed(findings: Finding[]) {
  const counts = severityCounts(findings);
  const lines = (['critical', 'high', 'medium', 'low', 'info'] as FindingSeverity[])
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${severity}: ${counts[severity]}`);

  return {
    title: `Findings (${findings.length})`,
    color: 0xed_42_45,
    description: [lines.join(' • ') || 'No findings', '', formatFindingsSummaryText(findings, 8)]
      .join('\n')
      .slice(0, 4096),
  };
}

function buildArtifactsEmbed(artifacts: ArtifactsResponse['artifacts']) {
  const lines =
    artifacts.length === 0
      ? 'No artifacts saved for this run.'
      : artifacts
          .slice(0, 10)
          .map((artifact) => `• ${artifact.name} (${artifact.size} bytes)`)
          .join('\n');

  return {
    title: `Artifacts (${artifacts.length})`,
    color: 0x57_f2_87,
    description: lines.slice(0, 4096),
  };
}

const runReportRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 5,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['AuthenticationError', 'ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.notification.run-report-discord',
  label: 'Run Report → Discord',
  category: 'notification',
  runner: { kind: 'inline' },
  retryPolicy: runReportRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Fetch run summary, findings, and artifacts via internal APIs and post a curated Discord report. Wire Run after from the final upstream node, set Webhook URL via secret, then place as the last step.',
  ui: {
    slug: 'run-report-discord',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description:
      'Export run summary/findings/artifacts bundles to Discord. Connect Run after from the last scanner or artifact node; set Webhook URL via secret.',
    icon: 'Send',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
  },
  async execute({ inputs, params }, context) {
    const webhookUrlRaw = inputs.webhookUrl;
    if (!webhookUrlRaw) {
      throw new ConfigurationError('Discord webhook URL is required.', {
        configKey: 'webhookUrl',
      });
    }

    const webhookUrl = typeof webhookUrlRaw === 'string' ? webhookUrlRaw : String(webhookUrlRaw);
    validateDiscordWebhookUrl(webhookUrl);

    const runId = context.runId;
    const [run, nodeIo, artifactsResponse] = await Promise.all([
      fetchInternalJson<RunSummaryResponse>(context, `/internal/runs/${runId}`),
      fetchInternalJson<NodeIoResponse>(context, `/internal/runs/${runId}/node-io`),
      fetchInternalJson<ArtifactsResponse>(context, `/internal/runs/${runId}/artifacts`),
    ]);

    const completedNodes = nodeIo.nodes.filter((node) => node.status === 'completed');
    const findings = normalizeAllFindings(completedNodes)
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      .slice(0, params.findingsLimit);

    const nodeCounts = deriveNodeStatusCounts(nodeIo.nodes);
    const frontendBase = process.env.SENTRIS_FRONTEND_BASE_URL?.trim().replace(/\/+$/, '');
    const runUrl = frontendBase
      ? `${frontendBase}/workflows/${run.workflowId}/runs/${runId}`
      : null;

    const embeds: Record<string, unknown>[] = [];
    if (params.includeSummary) {
      embeds.push(buildSummaryEmbed(run, nodeCounts, runUrl));
    }
    if (params.includeFindings) {
      embeds.push(buildFindingsEmbed(findings));
    }
    if (params.includeArtifacts) {
      embeds.push(buildArtifactsEmbed(artifactsResponse.artifacts));
    }

    const content =
      params.contentTemplate?.trim() ||
      `Run report for \`${runId}\` — ${findings.length} finding(s), ${artifactsResponse.artifacts.length} artifact(s).`;

    if (content.length > DISCORD_CONTENT_MAX_LENGTH) {
      throw new ValidationError(
        `Discord content exceeds ${DISCORD_CONTENT_MAX_LENGTH} characters.`,
        {
          fieldErrors: { content: [`Maximum length is ${DISCORD_CONTENT_MAX_LENGTH} characters`] },
        },
      );
    }

    const attachmentParts = normalizeDiscordAttachments({
      attachmentContent:
        params.includeFindings && params.attachFindingsJson
          ? { runId, findings, counts: severityCounts(findings) }
          : undefined,
      attachmentFileName: 'findings.json',
      attachmentContentFormat: 'json',
      attachmentMimeType: 'application/json',
    });

    if (params.attachFirstArtifact && artifactsResponse.artifacts.length > 0) {
      const firstArtifact = artifactsResponse.artifacts[0];
      if (firstArtifact.size <= DISCORD_MAX_ATTACHMENT_BYTES) {
        const downloadResponse = await context.http.fetch(
          `${resolveApiBaseUrl()}/internal/runs/${runId}/artifacts/${firstArtifact.id}/download`,
          {
            method: 'GET',
            headers: internalHeaders(context.organizationId),
          },
          internalFetchOptions(),
        );
        if (downloadResponse.ok) {
          const buffer = Buffer.from(await downloadResponse.arrayBuffer());
          if (buffer.byteLength <= DISCORD_MAX_ATTACHMENT_BYTES) {
            attachmentParts.push({
              fileName: firstArtifact.name,
              buffer,
              mimeType: firstArtifact.mimeType ?? 'application/octet-stream',
            });
          }
        }
      }
    }

    const payload: Record<string, unknown> = {
      content,
      embeds,
    };
    if (params.username?.trim()) {
      payload.username = params.username.trim();
    }

    const request = buildDiscordWebhookRequest(payload, attachmentParts);
    const response = await context.http.fetch(webhookUrl, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Discord responded with HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        findingsCount: findings.length,
      };
    }

    return {
      ok: true,
      error: undefined,
      findingsCount: findings.length,
    };
  },
});

componentRegistry.register(definition);

export { definition };
