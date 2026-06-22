import { beforeEach, describe, expect, it, mock, afterEach } from 'bun:test';
import type { NotificationChannelRecord } from '../../database/schema';
import type { RunLifecycleEvent } from '@sentris/shared';

let mockResolve4Result: string[] = ['104.16.132.229'];
let mockResolve6Result: string[] | null = null;
let mockResolve4Error: Error | null = null;

mock.module('node:dns', () => ({
  promises: {
    resolve4: async (_hostname: string) => {
      if (mockResolve4Error) throw mockResolve4Error;
      return mockResolve4Result;
    },
    resolve6: async (_hostname: string) => {
      if (mockResolve6Result === null) throw new Error('no AAAA record');
      return mockResolve6Result;
    },
  },
}));

import { DiscordNotificationAdapter } from '../adapters/discord.adapter';

function makeChannel(
  overrides: Partial<NotificationChannelRecord> = {},
): NotificationChannelRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'ch-discord-1',
    organizationId: overrides.organizationId ?? 'org-1',
    name: overrides.name ?? 'Discord Alerts',
    type: overrides.type ?? 'discord',
    config: overrides.config ?? {
      webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnop',
    },
    status: overrides.status ?? 'active',
    events: overrides.events ?? ['run.completed'],
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

const testPayload: RunLifecycleEvent = {
  runId: 'run-abc',
  workflowId: 'wf-1',
  organizationId: 'org-1',
  status: 'COMPLETED',
  completedAt: '2026-01-15T12:00:00Z',
};

describe('DiscordNotificationAdapter', () => {
  let adapter: DiscordNotificationAdapter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    adapter = new DiscordNotificationAdapter();
    originalFetch = globalThis.fetch;
    mockResolve4Result = ['104.16.132.229'];
    mockResolve6Result = null;
    mockResolve4Error = null;
    delete process.env.SENTRIS_FRONTEND_BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs embed payload to Discord webhook URL', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = init?.body as string;
      return new Response('', { status: 204 });
    }) as unknown as typeof fetch;

    const result = await adapter.send(makeChannel(), testPayload);

    expect(result.success).toBe(true);
    expect(capturedUrl).toBe('https://discord.com/api/webhooks/1234567890/abcdefghijklmnop');
    const body = JSON.parse(capturedBody);
    expect(body.embeds).toBeDefined();
    expect(body.embeds[0].title).toContain('COMPLETED');
  });

  it('includes run link when SENTRIS_FRONTEND_BASE_URL is set', async () => {
    process.env.SENTRIS_FRONTEND_BASE_URL = 'http://localhost:5173';
    let capturedBody = '';

    globalThis.fetch = (async (_: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response('', { status: 204 });
    }) as unknown as typeof fetch;

    await adapter.send(makeChannel(), testPayload);

    const body = JSON.parse(capturedBody);
    const runField = body.embeds[0].fields.find(
      (field: { name: string }) => field.name === 'Open in Sentris',
    );
    expect(runField.value).toBe('http://localhost:5173/workflows/wf-1/runs/run-abc');
  });

  it('rejects invalid webhook URL format', async () => {
    const channel = makeChannel({
      config: { webhookUrl: 'https://example.com/hook' },
    });

    const result = await adapter.send(channel, testPayload);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid Discord webhook URL');
  });
});
