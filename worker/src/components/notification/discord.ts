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
  type PortMeta,
} from '@sentris/component-sdk';

const DISCORD_CONTENT_MAX_LENGTH = 2000;
const DISCORD_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);
const DISCORD_WEBHOOK_PATH = /^\/api\/webhooks\/\d+\/[\w-]+$/;

const attachmentContentFormatSchema = z.enum(['text', 'base64', 'json']);

const inputSchema = inputs({});

const parameterSchema = parameters({
  username: param(z.string().trim().min(1).max(80).optional(), {
    label: 'Webhook username override',
    description: 'Optional display name for messages sent through this webhook.',
    editor: 'text',
    placeholder: 'Sentris Flow',
  }),
  attachmentFileName: param(z.string().trim().min(1).default('report.txt'), {
    label: 'Attachment file name',
    description:
      'Filename when using Attachment content input. For embed images, match attachment://filename in embeds.',
    editor: 'text',
    placeholder: 'report.json',
  }),
  attachmentContentFormat: param(attachmentContentFormatSchema.default('text'), {
    label: 'Attachment content format',
    editor: 'select',
    options: [
      { label: 'Text', value: 'text' },
      { label: 'Base64', value: 'base64' },
      { label: 'JSON', value: 'json' },
    ],
    description: 'How to decode Attachment content when not using a File Loader object.',
  }),
  attachmentMimeType: param(z.string().trim().min(1).default('application/octet-stream'), {
    label: 'Attachment MIME type',
    editor: 'text',
    description: 'MIME type for Attachment content when not provided by File Loader.',
  }),
  variables: param(
    z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
    {
      label: 'Template Variables',
      editor: 'variable-list',
      description: 'Define variables to use as {{name}} in content and embeds.',
    },
  ),
});

const outputSchema = outputs({
  ok: port(z.boolean(), {
    label: 'OK',
  }),
  error: port(z.string().optional(), {
    label: 'Error',
  }),
});

export type DiscordAttachmentContentFormat = z.infer<typeof attachmentContentFormatSchema>;

export interface DiscordAttachmentPart {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

const mapTypeToSchema = (
  type: string,
  label: string,
): { schema: z.ZodTypeAny; meta?: PortMeta } => {
  switch (type) {
    case 'string':
      return { schema: z.string().optional(), meta: { label } };
    case 'number':
      return { schema: z.number().optional(), meta: { label } };
    case 'boolean':
      return { schema: z.boolean().optional(), meta: { label } };
    case 'secret':
      return {
        schema: z.unknown().optional(),
        meta: {
          label,
          editor: 'secret',
          allowAny: true,
          reason: 'Discord templates can include secret values.',
          connectionType: { kind: 'primitive', name: 'secret' },
        },
      };
    case 'list':
      return { schema: z.array(z.string()).optional(), meta: { label } };
    default:
      return {
        schema: z.unknown().optional(),
        meta: {
          label,
          allowAny: true,
          reason: 'Discord templates can include arbitrary JSON values.',
          connectionType: { kind: 'primitive', name: 'json' },
        },
      };
  }
};

export function validateDiscordWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('Invalid Discord webhook URL.', {
      fieldErrors: { webhookUrl: ['Must be a valid HTTPS URL'] },
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Discord webhook URLs must use HTTPS.', {
      fieldErrors: { webhookUrl: ['Only HTTPS URLs are allowed'] },
    });
  }

  if (parsed.username || parsed.password) {
    throw new ValidationError('Discord webhook URLs must not include credentials.', {
      fieldErrors: { webhookUrl: ['Remove userinfo from the webhook URL'] },
    });
  }

  if (!ALLOWED_DISCORD_HOSTS.has(parsed.hostname)) {
    throw new ValidationError('Discord webhook URL hostname is not allowed.', {
      fieldErrors: {
        webhookUrl: ['Hostname must be discord.com or discordapp.com'],
      },
    });
  }

  if (!DISCORD_WEBHOOK_PATH.test(parsed.pathname)) {
    throw new ValidationError('Discord webhook URL path is invalid.', {
      fieldErrors: {
        webhookUrl: ['Path must match /api/webhooks/{id}/{token}'],
      },
    });
  }
}

function sanitizeAttachmentFileName(fileName: string): string {
  const baseName = fileName.split(/[/\\]/).pop()?.trim() ?? '';
  const sanitized = baseName.replace(/[^\w.\-()+\s]/g, '_').trim();
  if (!sanitized) {
    throw new ValidationError('Attachment file name is invalid.', {
      fieldErrors: { attachmentFileName: ['Provide a valid file name such as report.json'] },
    });
  }
  return sanitized;
}

function bufferFromAttachmentContent(
  content: unknown,
  format: DiscordAttachmentContentFormat,
): Buffer {
  if (format === 'base64') {
    if (typeof content !== 'string') {
      throw new ValidationError('Base64 attachment content must be a string.', {
        fieldErrors: { attachmentContent: ['Expected a base64-encoded string'] },
      });
    }
    return bufferFromBase64Content(content, 'attachmentContent');
  }

  if (format === 'json') {
    if (typeof content === 'string') {
      return Buffer.from(content, 'utf-8');
    }
    return Buffer.from(JSON.stringify(content ?? null, null, 2), 'utf-8');
  }

  if (typeof content === 'string') {
    return Buffer.from(content, 'utf-8');
  }

  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (content === undefined || content === null) {
    return Buffer.alloc(0);
  }

  return Buffer.from(
    typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content),
    'utf-8',
  );
}

function bufferFromBase64Content(content: string, fieldName: string): Buffer {
  const normalized = content.replace(/\s+/g, '');
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - (normalized.length % 4))}`;

  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new ValidationError('Base64 attachment content is invalid.', {
      fieldErrors: { [fieldName]: ['Provide valid base64-encoded content'] },
    });
  }

  const buffer = Buffer.from(padded, 'base64');
  const roundTrip = buffer.toString('base64').replace(/=+$/, '');
  const expected = normalized.replace(/=+$/, '');
  if (roundTrip !== expected) {
    throw new ValidationError('Base64 attachment content is invalid.', {
      fieldErrors: { [fieldName]: ['Provide valid base64-encoded content'] },
    });
  }

  return buffer;
}

function isFileContract(value: unknown): value is {
  name: string;
  content: string;
  mimeType?: string;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.content === 'string' && typeof record.name === 'string';
}

function isAttachmentDescriptor(value: unknown): value is {
  fileName?: string;
  name?: string;
  content: unknown;
  mimeType?: string;
  contentFormat?: DiscordAttachmentContentFormat;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    'content' in record && (typeof record.fileName === 'string' || typeof record.name === 'string')
  );
}

function attachmentFromFileContract(value: {
  name: string;
  content: string;
  mimeType?: string;
}): DiscordAttachmentPart {
  const buffer = bufferFromBase64Content(value.content, 'attachments');
  return {
    fileName: sanitizeAttachmentFileName(value.name),
    buffer,
    mimeType: value.mimeType?.trim() || 'application/octet-stream',
  };
}

function attachmentFromDescriptor(value: {
  fileName?: string;
  name?: string;
  content: unknown;
  mimeType?: string;
  contentFormat?: DiscordAttachmentContentFormat;
}): DiscordAttachmentPart {
  const fileName = sanitizeAttachmentFileName(value.fileName ?? value.name ?? 'attachment.bin');
  const format = value.contentFormat ?? 'text';
  const buffer = bufferFromAttachmentContent(value.content, format);
  return {
    fileName,
    buffer,
    mimeType: value.mimeType?.trim() || 'application/octet-stream',
  };
}

function validateAttachmentSize(part: DiscordAttachmentPart): void {
  if (part.buffer.byteLength > DISCORD_MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(`Attachment ${part.fileName} exceeds Discord limit of 25 MB.`, {
      fieldErrors: {
        attachments: [`${part.fileName} is ${part.buffer.byteLength} bytes (max 25 MB)`],
      },
    });
  }
}

export function normalizeDiscordAttachments(options: {
  attachments?: unknown;
  attachmentContent?: unknown;
  attachmentFileName: string;
  attachmentContentFormat: DiscordAttachmentContentFormat;
  attachmentMimeType: string;
}): DiscordAttachmentPart[] {
  const parts: DiscordAttachmentPart[] = [];

  const pushPart = (part: DiscordAttachmentPart) => {
    validateAttachmentSize(part);
    parts.push(part);
  };

  if (options.attachments !== undefined && options.attachments !== null) {
    const entries = Array.isArray(options.attachments)
      ? options.attachments
      : [options.attachments];

    for (const entry of entries) {
      if (isFileContract(entry)) {
        pushPart(attachmentFromFileContract(entry));
        continue;
      }
      if (isAttachmentDescriptor(entry)) {
        pushPart(attachmentFromDescriptor(entry));
        continue;
      }
      throw new ValidationError('Unsupported attachment input shape.', {
        fieldErrors: {
          attachments: [
            'Connect File Loader file output or provide { fileName, content, mimeType?, contentFormat? }',
          ],
        },
      });
    }
  }

  if (
    options.attachmentContent !== undefined &&
    options.attachmentContent !== null &&
    !(typeof options.attachmentContent === 'string' && options.attachmentContent.trim() === '')
  ) {
    pushPart({
      fileName: sanitizeAttachmentFileName(options.attachmentFileName),
      buffer: bufferFromAttachmentContent(
        options.attachmentContent,
        options.attachmentContentFormat,
      ),
      mimeType: options.attachmentMimeType.trim() || 'application/octet-stream',
    });
  }

  return parts;
}

function parseEmbeds(
  embeds: unknown,
  contextData: Record<string, unknown>,
  logger: { warn: (message: string) => void },
): unknown[] | undefined {
  if (embeds === undefined || embeds === null) {
    return undefined;
  }

  if (typeof embeds === 'string') {
    if (!embeds.trim()) {
      return undefined;
    }
    try {
      const interpolated = interpolate(embeds, contextData);
      const parsed = JSON.parse(interpolated);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      logger.warn('[Discord] Failed to parse embeds JSON after interpolation');
      return undefined;
    }
  }

  if (Array.isArray(embeds)) {
    try {
      const str = JSON.stringify(embeds);
      const interpolated = interpolate(str, contextData);
      return JSON.parse(interpolated) as unknown[];
    } catch {
      throw new ValidationError('Discord embeds must be serializable JSON.', {
        fieldErrors: { embeds: ['Provide serializable Discord embed JSON'] },
      });
    }
  }

  if (typeof embeds === 'object') {
    try {
      const str = JSON.stringify(embeds);
      const interpolated = interpolate(str, contextData);
      const parsed = JSON.parse(interpolated);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      throw new ValidationError('Discord embeds must be serializable JSON.', {
        fieldErrors: { embeds: ['Provide serializable Discord embed JSON'] },
      });
    }
  }

  return undefined;
}

export function buildDiscordWebhookRequest(
  payload: Record<string, unknown>,
  attachmentParts: DiscordAttachmentPart[],
): { body: string | FormData; headers?: Record<string, string> } {
  if (attachmentParts.length === 0) {
    return {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const form = new FormData();
  const payloadWithAttachments = {
    ...payload,
    attachments: attachmentParts.map((part, index) => ({
      id: index,
      filename: part.fileName,
    })),
  };
  form.set('payload_json', JSON.stringify(payloadWithAttachments));

  attachmentParts.forEach((part, index) => {
    form.set(`files[${index}]`, new Blob([part.buffer], { type: part.mimeType }), part.fileName);
  });

  return { body: form };
}

const discordRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 5,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['AuthenticationError', 'ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.notification.discord',
  label: 'Discord Webhook',
  category: 'notification',
  runner: { kind: 'inline' },
  retryPolicy: discordRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Send Discord messages through an Incoming Webhook with {{variable}} support, optional file attachments, and embed images via attachment://filename.',
  ui: {
    slug: 'discord-webhook',
    version: '1.1.0',
    type: 'output',
    category: 'notification',
    description:
      'Post text, embeds, and optional file attachments to Discord. Use attachment://filename in embeds for inline images.',
    icon: 'MessageSquare',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const inputShape: Record<string, z.ZodTypeAny> = {
      webhookUrl: port(z.unknown(), {
        label: 'Webhook URL',
        description:
          'Select a stored secret in the Value field below, or connect the Secret Loader "Secret Value" output. Do not wire JSON or report outputs here.',
        editor: 'secret',
        allowAny: true,
        reason: 'Discord webhook URLs are secrets.',
        connectionType: { kind: 'primitive', name: 'secret' },
      }),
      content: port(z.string().optional(), {
        label: 'Message Content',
        description: 'Plain text message (supports {{variables}}).',
        connectionType: { kind: 'primitive', name: 'text' },
      }),
      embeds: port(z.unknown().optional(), {
        label: 'Embeds (JSON)',
        allowAny: true,
        reason: 'Discord embeds can be raw JSON or string templates.',
        connectionType: { kind: 'primitive', name: 'json' },
      }),
      attachments: port(z.unknown().optional(), {
        label: 'Attachments',
        description:
          'File Loader file object or array of { fileName, content, mimeType? }. For embed images use attachment://filename in embeds.',
        allowAny: true,
        reason: 'Discord attachments accept File Loader objects or structured file descriptors.',
        connectionType: { kind: 'primitive', name: 'json' },
      }),
      attachmentContent: port(z.unknown().optional(), {
        label: 'Attachment Content',
        description:
          'Raw report payload when not using File Loader. Pair with Attachment file name parameter.',
        allowAny: true,
        reason: 'Attachment content can be text, JSON, or base64 depending on format parameter.',
        connectionType: { kind: 'primitive', name: 'text' },
      }),
    };

    if (params.variables && Array.isArray(params.variables)) {
      for (const v of params.variables) {
        if (!v || !v.name) continue;
        const { schema, meta } = mapTypeToSchema(v.type || 'json', v.name);
        inputShape[v.name] = port(schema, meta ?? { label: v.name });
      }
    }

    return { inputs: inputs(inputShape) };
  },
  async execute({ inputs, params }, context) {
    const { webhookUrl, content, embeds, attachments, attachmentContent, ...variableInputs } =
      inputs as Record<string, unknown>;
    const contextData = { ...params, ...variableInputs, content, embeds };

    if (!webhookUrl) {
      throw new ConfigurationError('Discord webhook URL is required.', {
        configKey: 'webhookUrl',
      });
    }

    const url = typeof webhookUrl === 'string' ? webhookUrl : String(webhookUrl);
    validateDiscordWebhookUrl(url);

    const finalContent =
      typeof content === 'string' ? interpolate(content, contextData).trim() : '';
    const finalEmbeds = parseEmbeds(embeds, contextData, context.logger);
    const attachmentParts = normalizeDiscordAttachments({
      attachments,
      attachmentContent,
      attachmentFileName: params.attachmentFileName,
      attachmentContentFormat: params.attachmentContentFormat,
      attachmentMimeType: params.attachmentMimeType,
    });

    if (
      !finalContent &&
      (!finalEmbeds || finalEmbeds.length === 0) &&
      attachmentParts.length === 0
    ) {
      throw new ValidationError('Discord message must include content, embeds, or attachments.', {
        fieldErrors: {
          content: ['Provide message content, embeds JSON, or file attachments'],
        },
      });
    }

    if (finalContent.length > DISCORD_CONTENT_MAX_LENGTH) {
      throw new ValidationError(
        `Discord content exceeds ${DISCORD_CONTENT_MAX_LENGTH} characters.`,
        {
          fieldErrors: {
            content: [`Maximum length is ${DISCORD_CONTENT_MAX_LENGTH} characters`],
          },
        },
      );
    }

    const payload: Record<string, unknown> = {};
    if (finalContent) {
      payload.content = finalContent;
    }
    if (finalEmbeds && finalEmbeds.length > 0) {
      payload.embeds = finalEmbeds;
    }
    if (params.username?.trim()) {
      payload.username = params.username.trim();
    }

    const request = buildDiscordWebhookRequest(payload, attachmentParts);

    context.logger.info(
      `[Discord] Sending webhook message${attachmentParts.length > 0 ? ` with ${attachmentParts.length} attachment(s)` : ''}...`,
    );

    const response = await context.http.fetch(url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });

    if (response.ok) {
      return outputSchema.parse({ ok: true });
    }

    const responseBody = await response.text();
    const errorMessage = responseBody.trim() || `HTTP ${response.status}`;
    context.logger.error(`[Discord] Webhook failed (${response.status}): ${errorMessage}`);
    return outputSchema.parse({ ok: false, error: errorMessage });
  },
});

componentRegistry.register(definition);

export { definition };
