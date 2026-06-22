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
const ALLOWED_DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);
const DISCORD_WEBHOOK_PATH = /^\/api\/webhooks\/\d+\/[\w-]+$/;

const inputSchema = inputs({});

const parameterSchema = parameters({
  username: param(z.string().trim().min(1).max(80).optional(), {
    label: 'Webhook username override',
    description: 'Optional display name for messages sent through this webhook.',
    editor: 'text',
    placeholder: 'Sentris Flow',
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
    const str = JSON.stringify(embeds);
    const interpolated = interpolate(str, contextData);
    return JSON.parse(interpolated) as unknown[];
  }

  if (typeof embeds === 'object') {
    const str = JSON.stringify(embeds);
    const interpolated = interpolate(str, contextData);
    const parsed = JSON.parse(interpolated);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  return undefined;
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
  docs: 'Send Discord messages through an Incoming Webhook with {{variable}} support in content and embeds JSON.',
  ui: {
    slug: 'discord-webhook',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: 'Post plain text or rich embeds to a Discord channel via webhook.',
    icon: 'MessageSquare',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const inputShape: Record<string, z.ZodTypeAny> = {
      webhookUrl: port(z.unknown(), {
        label: 'Webhook URL',
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
    const { webhookUrl, content, embeds, ...variableInputs } = inputs as Record<string, unknown>;
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

    if (!finalContent && (!finalEmbeds || finalEmbeds.length === 0)) {
      throw new ValidationError('Discord message must include content or embeds.', {
        fieldErrors: {
          content: ['Provide message content or embeds JSON'],
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

    const body: Record<string, unknown> = {};
    if (finalContent) {
      body.content = finalContent;
    }
    if (finalEmbeds && finalEmbeds.length > 0) {
      body.embeds = finalEmbeds;
    }
    if (params.username?.trim()) {
      body.username = params.username.trim();
    }

    context.logger.info('[Discord] Sending webhook message...');

    const response = await context.http.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
