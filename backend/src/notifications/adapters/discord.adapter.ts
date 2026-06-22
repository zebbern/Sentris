import { promises as dns } from 'node:dns';
import { Injectable, Logger } from '@nestjs/common';

import type { NotificationChannelRecord } from '../../database/schema';
import type { RunLifecycleEvent } from '@sentris/shared';
import { isValidDiscordWebhookUrl } from '@sentris/shared';
import type { NotificationAdapterResult } from './notification.adapter';
import { NotificationAdapter } from './notification.adapter';
import { buildRunInspectorUrl } from './run-inspector-url';

const ALLOWED_DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BODY_BYTES = 2048;

const STATUS_COLORS: Record<string, number> = {
  COMPLETED: 0x57_f2_87,
  FAILED: 0xed_42_45,
  CANCELLED: 0x95_a5_a6,
  TERMINATED: 0x95_a5_a6,
  TIMED_OUT: 0xf1_c4_0f,
};

@Injectable()
export class DiscordNotificationAdapter extends NotificationAdapter {
  private readonly logger = new Logger(DiscordNotificationAdapter.name);

  async send(
    channel: NotificationChannelRecord,
    payload: RunLifecycleEvent,
  ): Promise<NotificationAdapterResult> {
    const config = channel.config as { webhookUrl?: string };
    const webhookUrl = config?.webhookUrl;

    if (!webhookUrl) {
      return { success: false, error: 'Missing webhookUrl in channel config' };
    }

    const ssrfError = await this.validateUrl(webhookUrl);
    if (ssrfError) {
      return { success: false, error: ssrfError };
    }

    const body = this.buildDiscordPayload(channel, payload);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseText = await response.text().catch(() => '');
      const truncatedBody =
        Buffer.byteLength(responseText) > MAX_RESPONSE_BODY_BYTES
          ? Buffer.from(responseText).subarray(0, MAX_RESPONSE_BODY_BYTES).toString() +
            '... [truncated]'
          : responseText;

      if (response.ok) {
        return {
          success: true,
          responseStatus: response.status,
          responseBody: truncatedBody,
        };
      }

      return {
        success: false,
        error: `Discord responded with HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        responseStatus: response.status,
        responseBody: truncatedBody,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Discord webhook delivery failed for channel ${channel.id}: ${message}`);
      return { success: false, error: message };
    }
  }

  private async validateUrl(url: string): Promise<string | null> {
    if (!isValidDiscordWebhookUrl(url)) {
      return 'Invalid Discord webhook URL format';
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Invalid URL';
    }

    if (!ALLOWED_DISCORD_HOSTS.has(parsed.hostname)) {
      return `Domain ${parsed.hostname} is not allowed for Discord webhooks`;
    }

    let hasResolved = false;

    try {
      const addresses = await dns.resolve4(parsed.hostname);
      hasResolved = true;
      for (const ip of addresses) {
        if (isPrivateIp(ip)) {
          return `Resolved IP ${ip} is a private/loopback address`;
        }
      }
    } catch {
      // Continue to IPv6
    }

    try {
      const addresses = await dns.resolve6(parsed.hostname);
      hasResolved = true;
      for (const ip of addresses) {
        if (isPrivateIpv6(ip)) {
          return `Resolved IPv6 ${ip} is a private/loopback address`;
        }
      }
    } catch {
      // IPv6 resolution may fail — that's fine if IPv4 succeeded
    }

    if (!hasResolved) {
      return 'DNS resolution failed for webhook URL';
    }

    return null;
  }

  private buildDiscordPayload(
    channel: NotificationChannelRecord,
    payload: RunLifecycleEvent,
  ): Record<string, unknown> {
    const statusLabel = payload.status.replace(/_/g, ' ');
    const runUrl = buildRunInspectorUrl(payload);
    const fields = [
      { name: 'Run ID', value: `\`${payload.runId}\``, inline: true },
      { name: 'Status', value: statusLabel, inline: true },
      { name: 'Workflow ID', value: `\`${payload.workflowId}\``, inline: true },
      {
        name: 'Completed At',
        value: payload.completedAt ?? 'N/A',
        inline: false,
      },
    ];

    if (runUrl) {
      fields.push({ name: 'Open in Sentris', value: runUrl, inline: false });
    }

    return {
      embeds: [
        {
          title: `Workflow Run ${statusLabel}`,
          color: STATUS_COLORS[payload.status] ?? 0x58_65_f2,
          fields,
          footer: {
            text: `${channel.name} • ${channel.organizationId}`,
          },
        },
      ],
    };
  }
}

function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;

  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIp(normalized.slice(7));
  }
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  return false;
}
