import { describe, expect, it } from 'bun:test';
import {
  SECURITY_COMPONENT_IDS,
  createSecurityComponentFingerprint,
  renderSecurityComponentLedgerFreshness,
  shouldSkipSecurityComponentLiveAudit,
  summarizeSecurityComponentLedgerFreshness,
  SECURITY_COMPONENT_LIVE_FIXTURES,
} from '../security-component-audit-utils';

describe('security-component-audit-utils', () => {
  it('defines fixtures for every security component id', () => {
    for (const componentId of SECURITY_COMPONENT_IDS) {
      expect(SECURITY_COMPONENT_LIVE_FIXTURES[componentId]).toBeDefined();
    }
  });

  it('creates stable fingerprints for fixtures', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.subfinder.run'];
    const first = createSecurityComponentFingerprint('sentris.subfinder.run', fixture);
    const second = createSecurityComponentFingerprint('sentris.subfinder.run', fixture);
    expect(first).toBe(second);
    expect(first).toHaveLength(16);
  });

  it('reports missing ledger entries without failing freshness summary', () => {
    const summary = summarizeSecurityComponentLedgerFreshness(undefined, ['sentris.subfinder.run']);
    expect(summary.allCurrent).toBe(true);
    expect(summary.items[0]?.status).toBe('missing');
    expect(renderSecurityComponentLedgerFreshness(summary)).toContain('CURRENT');
  });

  it('skips credential-gated fixtures with missing secrets even when force is requested', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    delete process.env.VIRUSTOTAL_API_KEY;

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: undefined,
        componentId: 'security.virustotal.lookup',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped).toMatchObject({
        componentId: 'security.virustotal.lookup',
        fingerprint,
        tier: 'C',
        status: 'skipped',
        error: 'Requires VirusTotal API key',
      });
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('lets forced credential-gated fixtures run when all required secrets are present', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    process.env.VIRUSTOTAL_API_KEY = 'present';

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: undefined,
        componentId: 'security.virustotal.lookup',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped).toBeUndefined();
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('skips missing required secrets even without a custom skip reason', () => {
    const fixture = {
      tier: 'C' as const,
      inputs: {},
      params: {},
      requiresSecrets: ['CUSTOM_REQUIRED_SECRET'],
    };
    const fingerprint = createSecurityComponentFingerprint('sentris.subfinder.run', fixture);
    const originalValue = process.env.CUSTOM_REQUIRED_SECRET;
    delete process.env.CUSTOM_REQUIRED_SECRET;

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: undefined,
        componentId: 'sentris.subfinder.run',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped?.status).toBe('skipped');
      expect(skipped?.error).toBe('Missing required secrets: CUSTOM_REQUIRED_SECRET');
    } finally {
      if (originalValue === undefined) {
        delete process.env.CUSTOM_REQUIRED_SECRET;
      } else {
        process.env.CUSTOM_REQUIRED_SECRET = originalValue;
      }
    }
  });
});
