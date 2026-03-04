import { promises as dns } from 'node:dns';
import { Injectable, Logger } from '@nestjs/common';

import type { NotificationChannelRecord } from '../../database/schema';
import type { RunLifecycleEvent } from '@sentris/shared';
import type { NotificationAdapterResult } from './notification.adapter';
import { NotificationAdapter } from './notification.adapter';

const ALLOWED_DOMAINS = ['hooks.slack.com', 'hooks.slack-gov.com'];
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BODY_BYTES = 2048;

/** Status label for human-readable Slack messages. */
const STATUS_EMOJI: Record<string, string> = {
  COMPLETED: ':white_check_mark:',
  FAILED: ':x:',
  CANCELLED: ':no_entry_sign:',
  TERMINATED: ':skull:',
  TIMED_OUT: ':hourglass:',
};

@Injectable()
export class SlackNotificationAdapter extends NotificationAdapter {
  private readonly logger = new Logger(SlackNotificationAdapter.name);

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

    const body = this.buildSlackPayload(channel, payload);

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
        error: `Slack responded with HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        responseStatus: response.status,
        responseBody: truncatedBody,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Slack webhook delivery failed for channel ${channel.id}: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Validates a webhook URL for SSRF protection:
   * 1. Must be HTTPS
   * 2. Hostname must be in the allowed domain list
   * 3. Resolved IP must not be private, loopback, or link-local
   */
  private async validateUrl(url: string): Promise<string | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Invalid URL';
    }

    if (parsed.protocol !== 'https:') {
      return 'Only HTTPS URLs are allowed';
    }

    if (!ALLOWED_DOMAINS.includes(parsed.hostname)) {
      return `Domain ${parsed.hostname} is not in the allowed list (${ALLOWED_DOMAINS.join(', ')})`;
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

  private buildSlackPayload(
    channel: NotificationChannelRecord,
    payload: RunLifecycleEvent,
  ): Record<string, unknown> {
    const emoji = STATUS_EMOJI[payload.status] ?? ':bell:';
    const statusLabel = payload.status.replace(/_/g, ' ');

    return {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} Workflow Run ${statusLabel}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Run ID:*\n\`${payload.runId}\`` },
            { type: 'mrkdwn', text: `*Status:*\n${statusLabel}` },
            { type: 'mrkdwn', text: `*Workflow ID:*\n\`${payload.workflowId}\`` },
            {
              type: 'mrkdwn',
              text: `*Completed At:*\n${payload.completedAt ?? 'N/A'}`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Channel: ${channel.name} | Organization: ${channel.organizationId}`,
            },
          ],
        },
      ],
    };
  }
}

/**
 * Check if an IPv4 address is private, loopback, or link-local.
 */
function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true; // Malformed — reject

  const [a, b] = parts;

  // 127.0.0.0/8 — Loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — Private
  if (a === 10) return true;
  // 172.16.0.0/12 — Private
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — Private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — Link-local
  if (a === 169 && b === 254) return true;
  // 0.0.0.0
  if (a === 0) return true;

  return false;
}

/**
 * Check if an IPv6 address is private, loopback, or link-local.
 */
function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // ::ffff:x.x.x.x — IPv4-mapped IPv6 address; delegate to IPv4 check
  if (normalized.startsWith('::ffff:')) {
    const ipv4 = normalized.slice(7);
    return isPrivateIp(ipv4);
  }
  // ::1 — Loopback
  if (normalized === '::1') return true;
  // fc00::/7 — Unique local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // fe80::/10 — Link-local
  if (normalized.startsWith('fe80')) return true;
  return false;
}
