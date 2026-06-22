import { describe, expect, it } from 'bun:test';
import {
  SECURITY_COMPONENT_IDS,
  createSecurityComponentFingerprint,
  renderSecurityComponentLedgerFreshness,
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
});
