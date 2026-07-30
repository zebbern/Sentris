import { describe, expect, it } from 'bun:test';
import { Bug, BookOpen, Package, Shield, ShieldCheck, Box } from 'lucide-react';
import { getCategoryStyle } from '../types';

describe('getCategoryStyle', () => {
  it('matches publish Title Case to style keys', () => {
    expect(getCategoryStyle('Security').icon).toBe(Shield);
    expect(getCategoryStyle('Incident Response').accent).toContain('amber');
  });

  it('matches seed hyphenated categories', () => {
    expect(getCategoryStyle('bug-bounty').icon).toBe(Bug);
    expect(getCategoryStyle('cve-research').icon).toBe(BookOpen);
    expect(getCategoryStyle('dependency-security').icon).toBe(Package);
    expect(getCategoryStyle('security-posture').icon).toBe(ShieldCheck);
    expect(getCategoryStyle('container-security').icon).toBe(Box);
  });

  it('normalizes spaces and hyphens interchangeably', () => {
    expect(getCategoryStyle('Bug Bounty').icon).toBe(Bug);
    expect(getCategoryStyle('incident-response').accent).toContain('amber');
  });

  it('falls back to other for unknown categories', () => {
    expect(getCategoryStyle('unknown-vertical').accent).toContain('slate');
    expect(getCategoryStyle(null).accent).toContain('slate');
  });
});
