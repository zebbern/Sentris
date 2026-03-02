import { describe, expect, it } from 'bun:test';

import { normalizeRole, hasAdminRole } from '../auth';

describe('normalizeRole', () => {
  it('uppercases standard roles', () => {
    expect(normalizeRole('admin')).toBe('ADMIN');
    expect(normalizeRole('user')).toBe('USER');
    expect(normalizeRole('MEMBER')).toBe('MEMBER');
  });

  it('strips ORG: prefix', () => {
    expect(normalizeRole('org:admin')).toBe('ADMIN');
    expect(normalizeRole('ORG:ADMIN')).toBe('ADMIN');
    expect(normalizeRole('org:user')).toBe('USER');
  });

  it('strips ORG_ prefix', () => {
    expect(normalizeRole('org_admin')).toBe('ADMIN');
    expect(normalizeRole('ORG_ADMIN')).toBe('ADMIN');
    expect(normalizeRole('org_member')).toBe('MEMBER');
  });

  it('handles empty string', () => {
    expect(normalizeRole('')).toBe('');
  });

  it('handles whitespace-only input', () => {
    expect(normalizeRole('  ')).toBe('  ');
  });

  it('preserves role without known prefix', () => {
    expect(normalizeRole('VIEWER')).toBe('VIEWER');
    expect(normalizeRole('custom_role')).toBe('CUSTOM_ROLE');
  });
});

describe('hasAdminRole', () => {
  it('returns true when array contains ADMIN', () => {
    expect(hasAdminRole(['ADMIN', 'USER'])).toBe(true);
  });

  it('returns true for org:admin prefixed role', () => {
    expect(hasAdminRole(['org:admin'])).toBe(true);
  });

  it('returns true for ORG_ADMIN prefixed role', () => {
    expect(hasAdminRole(['ORG_ADMIN'])).toBe(true);
  });

  it('returns false when array has no admin role', () => {
    expect(hasAdminRole(['USER', 'MEMBER'])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasAdminRole([])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasAdminRole(['admin'])).toBe(true);
    expect(hasAdminRole(['Admin'])).toBe(true);
  });
});
