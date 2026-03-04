import { beforeEach, describe, expect, it, mock, afterEach } from 'bun:test';
import type { NotificationChannelRecord } from '../../database/schema';
import type { RunLifecycleEvent } from '@sentris/shared';

// ---------------------------------------------------------------------------
// dns mock — must precede adapter import
// ---------------------------------------------------------------------------

let mockResolve4Result: string[] = ['44.228.42.1'];
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

// ---------------------------------------------------------------------------
// Import adapter after mocking dns
// ---------------------------------------------------------------------------

import { SlackNotificationAdapter } from '../adapters/slack.adapter';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeChannel(
  overrides: Partial<NotificationChannelRecord> = {},
): NotificationChannelRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'ch-1',
    organizationId: overrides.organizationId ?? 'org-1',
    name: overrides.name ?? 'Slack Alerts',
    type: overrides.type ?? 'slack',
    config: overrides.config ?? {
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxxx1234',
    },
    status: overrides.status ?? 'active',
    events: overrides.events ?? ['run.failed'],
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

const testPayload: RunLifecycleEvent = {
  runId: 'run-abc',
  workflowId: 'wf-1',
  organizationId: 'org-1',
  status: 'FAILED',
  completedAt: '2026-01-15T12:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlackNotificationAdapter', () => {
  let adapter: SlackNotificationAdapter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    adapter = new SlackNotificationAdapter();
    originalFetch = globalThis.fetch;

    // Reset DNS mock state
    mockResolve4Result = ['44.228.42.1'];
    mockResolve6Result = null;
    mockResolve4Error = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Successful delivery ───────────────────────────────────────────

  describe('successful delivery', () => {
    it('POSTs Block Kit payload to webhook URL and returns success', async () => {
      let capturedUrl = '';
      let capturedBody = '';
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = init?.body as string;
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      const channel = makeChannel();
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(true);
      expect(capturedUrl).toBe('https://hooks.slack.com/services/T00/B00/xxxx1234');
      expect(capturedHeaders['Content-Type']).toBe('application/json');

      const body = JSON.parse(capturedBody);
      expect(body.blocks).toBeDefined();
      expect(body.blocks.length).toBeGreaterThanOrEqual(2);
    });

    it('includes run details in Block Kit payload', async () => {
      let capturedBody = '';

      globalThis.fetch = (async (_: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      const channel = makeChannel();
      await adapter.send(channel, testPayload);

      const body = JSON.parse(capturedBody);
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).toContain('run-abc');
      expect(bodyStr).toContain('wf-1');
      expect(bodyStr).toContain('FAILED');
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns failure for missing webhookUrl', async () => {
      const channel = makeChannel({ config: {} });
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing webhookUrl');
    });

    it('returns failure on non-2xx response', async () => {
      globalThis.fetch = (async () => {
        return new Response('channel_not_found', { status: 404 });
      }) as unknown as typeof fetch;

      const channel = makeChannel();
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('returns failure on network error', async () => {
      globalThis.fetch = (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as unknown as typeof fetch;

      const channel = makeChannel();
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('returns failure on abort (timeout)', async () => {
      globalThis.fetch = (async (_: string | URL | Request, init?: RequestInit) => {
        // Simulate abort
        if (init?.signal) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      const channel = makeChannel();
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('aborted');
    });
  });

  // ── SSRF validation ───────────────────────────────────────────────

  describe('SSRF validation', () => {
    it('rejects HTTP (non-HTTPS) URLs', async () => {
      const channel = makeChannel({
        config: { webhookUrl: 'http://hooks.slack.com/services/T/B/x' },
      });

      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    it('rejects non-Slack domains', async () => {
      const channel = makeChannel({
        config: { webhookUrl: 'https://evil.example.com/steal' },
      });

      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in the allowed list');
    });

    it('rejects when DNS resolves to 127.0.0.1 (loopback)', async () => {
      mockResolve4Result = ['127.0.0.1'];
      const channel = makeChannel();

      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('private');
    });

    it('rejects when DNS resolves to 10.0.0.1 (private)', async () => {
      mockResolve4Result = ['10.0.0.1'];
      const channel = makeChannel();

      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('private');
    });

    it('rejects when DNS resolves to 192.168.1.1 (private)', async () => {
      mockResolve4Result = ['192.168.1.1'];
      const channel = makeChannel();

      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('private');
    });

    it('accepts valid hooks.slack.com URL with public IP', async () => {
      mockResolve4Result = ['44.228.42.1'];

      globalThis.fetch = (async () => {
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      const channel = makeChannel();
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(true);
    });

    it('accepts hooks.slack-gov.com domain', async () => {
      mockResolve4Result = ['44.228.42.1'];

      globalThis.fetch = (async () => {
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      const channel = makeChannel({
        config: {
          webhookUrl: 'https://hooks.slack-gov.com/services/T/B/x',
        },
      });
      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(true);
    });

    it('rejects invalid URL', async () => {
      const channel = makeChannel({
        config: { webhookUrl: 'not-a-url' },
      });

      const result = await adapter.send(channel, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });
  });
});
