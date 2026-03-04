import { describe, expect, it } from 'bun:test';
import { createHmac } from 'crypto';

import { verifyJiraWebhookSignature } from '../jira-webhook-verify';

describe('verifyJiraWebhookSignature', () => {
  const secret = 'test-webhook-secret-abc123';
  const body = '{"webhookEvent":"jira:issue_updated"}';

  function computeSignature(payload: string, key: string): string {
    return createHmac('sha256', key).update(payload).digest('hex');
  }

  it('returns true for a valid signature', () => {
    const sig = computeSignature(body, secret);
    expect(verifyJiraWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('returns true when signature has sha256= prefix', () => {
    const sig = `sha256=${computeSignature(body, secret)}`;
    expect(verifyJiraWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    expect(verifyJiraWebhookSignature(body, 'bad-signature', secret)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const sig = computeSignature(body, 'wrong-secret');
    expect(verifyJiraWebhookSignature(body, sig, secret)).toBe(false);
  });

  it('returns false when signature is empty', () => {
    expect(verifyJiraWebhookSignature(body, '', secret)).toBe(false);
  });

  it('returns false when secret is empty', () => {
    const sig = computeSignature(body, secret);
    expect(verifyJiraWebhookSignature(body, sig, '')).toBe(false);
  });

  it('works with Buffer body', () => {
    const bufBody = Buffer.from(body);
    const sig = computeSignature(body, secret);
    expect(verifyJiraWebhookSignature(bufBody, sig, secret)).toBe(true);
  });
});
